import { logger } from "@/config/logger.js";
import { getPrismaClient } from "@/services/prisma.service.js";

/**
 * THE BRUTE-FORCE COUNTER — one durable, GLOBAL store for every secret an attacker can guess.
 *
 * Both callers (a password on `/auth/signin`, a TOTP code on `/auth/mfa/verify-login`) used to keep
 * their own `Map` in the process. That is enforced **once per instance**: at `max-instances = 3` a
 * "5 attempts per 15 minutes" rule was really up to 15, and a scale-to-zero service forgets every
 * count it ever kept the moment it goes cold. Neither is catastrophic on its own — bcrypt at cost 12
 * and a 12-character password policy make online guessing hopeless either way — but the fix costs one
 * indexed query against a database that is ALREADY on the login path, which makes "correct" and
 * "cheap" the same choice. It is the same reasoning that made the password-reset cooldown DB-backed
 * (`appConfig.passwordReset.resendCooldownSeconds`) while the per-IP limiter stayed in memory.
 *
 * What deliberately did NOT change: the thresholds, the windows, the status code, the messages, the
 * audit events. This is the same policy with a store that tells the truth.
 */

/** Which secret is being guessed. The value is stored, so these strings are a contract, not a label. */
export const AuthAttemptScope = {
  LOGIN: "LOGIN",
  MFA: "MFA",
} as const;
export type AuthAttemptScopeType =
  (typeof AuthAttemptScope)[keyof typeof AuthAttemptScope];

/** What a caller needs to decide whether to refuse, and for how long. */
export interface AttemptState {
  attempts: number;
  /** Whole minutes left in the window, rounded UP — never 0 while a lockout is live, so the message
   *  can never read "try again in 0 minutes". */
  remainingMinutes: number;
}

const MINUTE_MS = 60_000;

const minutesLeft = (resetAt: Date, now: number): number =>
  Math.ceil((resetAt.getTime() - now) / MINUTE_MS);

/**
 * The live count for a subject, or `null` when there is none (never attempted, window lapsed).
 *
 * ⚠️ **A failure here reads as "no attempts", not as a lockout** — it FAILS OPEN, deliberately. This
 * counter is a speed bump in front of a credential check that needs the same database anyway: if
 * Postgres is unreachable the login cannot succeed regardless, so refusing on a read error would
 * turn a blip into an outage for the honest user while denying an attacker nothing they could have
 * gained. The failure is logged, so it is never silent.
 */
export async function attemptState(
  scope: AuthAttemptScopeType,
  subject: string,
): Promise<AttemptState | null> {
  const now = Date.now();
  try {
    const prismaClient = await getPrismaClient();
    const row = await prismaClient.authAttempt.findUnique({
      where: { uq_auth_attempts_scope_subject: { scope, subject } },
      select: { attempts: true, resetAt: true },
    });
    // A row past its `resetAt` is treated as absent rather than deleted here: the next failure
    // overwrites it, and the cleanup job sweeps what nobody comes back for. A read never writes.
    if (!row || row.resetAt.getTime() <= now) {
      return null;
    }
    return { attempts: row.attempts, remainingMinutes: minutesLeft(row.resetAt, now) };
  } catch (error) {
    logger.error("auth throttle: could not read the attempt counter", { error, scope });
    return null;
  }
}

/**
 * Record one failed attempt and hand back the state AFTER it.
 *
 * Two statements, in this order, because the increment has to be ATOMIC: a conditional read-then-
 * write would let two simultaneous guesses both read `4` and both write `5`. `updateMany` scoped to
 * a LIVE window increments in the database; it matches nothing when the row is absent or lapsed,
 * and only then does the upsert start a fresh window. The upsert's own `update` branch covers the
 * race where another request created the row in between.
 */
export async function recordFailedAttempt(
  scope: AuthAttemptScopeType,
  subject: string,
  windowMs: number,
): Promise<AttemptState | null> {
  const now = new Date();
  const resetAt = new Date(now.getTime() + windowMs);
  try {
    const prismaClient = await getPrismaClient();
    const live = await prismaClient.authAttempt.updateMany({
      where: { scope, subject, resetAt: { gt: now } },
      data: { attempts: { increment: 1 } },
    });
    if (live.count > 0) {
      return attemptState(scope, subject);
    }
    const row = await prismaClient.authAttempt.upsert({
      where: { uq_auth_attempts_scope_subject: { scope, subject } },
      create: { scope, subject, attempts: 1, firstAttemptAt: now, resetAt },
      update: { attempts: 1, firstAttemptAt: now, resetAt },
      select: { attempts: true, resetAt: true },
    });
    return {
      attempts: row.attempts,
      remainingMinutes: minutesLeft(row.resetAt, now.getTime()),
    };
  } catch (error) {
    // Same stance as the read: a counter that cannot be written must not fail the request that was
    // trying to write it. The authentication result itself is unaffected — this only forgets a guess.
    logger.error("auth throttle: could not record a failed attempt", { error, scope });
    return null;
  }
}

/** Forget a subject's failures — called on a SUCCESSFUL authentication, so an honest user who
 *  mistyped four times starts clean rather than carrying a near-lockout for the next quarter hour. */
export async function clearAttempts(
  scope: AuthAttemptScopeType,
  subject: string,
): Promise<void> {
  try {
    const prismaClient = await getPrismaClient();
    await prismaClient.authAttempt.deleteMany({ where: { scope, subject } });
  } catch (error) {
    logger.error("auth throttle: could not clear the attempt counter", { error, scope });
  }
}
