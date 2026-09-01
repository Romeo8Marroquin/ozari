import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/config/logger.js", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const { getPrismaClient } = vi.hoisted(() => ({ getPrismaClient: vi.fn() }));
vi.mock("@/services/prisma.service.js", () => ({ getPrismaClient }));

import { logger } from "@/config/logger.js";
import {
  AuthAttemptScope,
  attemptState,
  clearAttempts,
  recordFailedAttempt,
} from "./authThrottle.service.js";

const WINDOW_MS = 15 * 60 * 1000;
const SUBJECT = "sha-of-an-email";

/**
 * A fake of the ONE table this service touches, behaving the way Postgres does on the two paths that
 * matter: `updateMany` matches only a LIVE window (which is what makes the increment atomic), and
 * `upsert` starts or replaces a row. Keyed like the unique index.
 */
const fakeStore = (seed?: { attempts: number; resetAt: Date }) => {
  const rows = new Map<string, { attempts: number; resetAt: Date }>();
  if (seed) rows.set(`${AuthAttemptScope.LOGIN}|${SUBJECT}`, { ...seed });
  const key = (scope: string, subject: string): string => `${scope}|${subject}`;
  const client = {
    authAttempt: {
      findUnique: vi.fn(
        async ({
          where,
        }: {
          where: { uq_auth_attempts_scope_subject: { scope: string; subject: string } };
        }) => rows.get(key(
          where.uq_auth_attempts_scope_subject.scope,
          where.uq_auth_attempts_scope_subject.subject,
        )) ?? null,
      ),
      updateMany: vi.fn(
        async ({
          where,
        }: {
          where: { scope: string; subject: string; resetAt: { gt: Date } };
        }) => {
          const row = rows.get(key(where.scope, where.subject));
          if (!row || row.resetAt.getTime() <= where.resetAt.gt.getTime()) {
            return { count: 0 };
          }
          row.attempts += 1;
          return { count: 1 };
        },
      ),
      upsert: vi.fn(
        async ({
          where,
          create,
        }: {
          where: { uq_auth_attempts_scope_subject: { scope: string; subject: string } };
          create: { attempts: number; resetAt: Date };
        }) => {
          const id = key(
            where.uq_auth_attempts_scope_subject.scope,
            where.uq_auth_attempts_scope_subject.subject,
          );
          const row = { attempts: create.attempts, resetAt: create.resetAt };
          rows.set(id, row);
          return row;
        },
      ),
      deleteMany: vi.fn(async ({ where }: { where: { scope: string; subject: string } }) => {
        rows.delete(key(where.scope, where.subject));
        return { count: 1 };
      }),
    },
  };
  getPrismaClient.mockResolvedValue(client);
  return { client, rows };
};

beforeEach(() => vi.clearAllMocks());

describe("attemptState", () => {
  it("reads NOTHING for a subject that has never failed", async () => {
    fakeStore();
    await expect(attemptState(AuthAttemptScope.LOGIN, SUBJECT)).resolves.toBeNull();
  });

  it("treats a LAPSED window as absent, without writing anything", async () => {
    // The row is left for the cleanup job; a read never deletes, so a burst of requests against an
    // expired lockout cannot turn into a burst of writes.
    const { client } = fakeStore({ attempts: 5, resetAt: new Date(Date.now() - 1000) });
    await expect(attemptState(AuthAttemptScope.LOGIN, SUBJECT)).resolves.toBeNull();
    expect(client.authAttempt.deleteMany).not.toHaveBeenCalled();
  });

  it("reports the live count and rounds the remaining minutes UP", async () => {
    // Rounding up is what keeps a live lockout from ever announcing "try again in 0 minutes".
    fakeStore({ attempts: 3, resetAt: new Date(Date.now() + 61_000) });
    await expect(attemptState(AuthAttemptScope.LOGIN, SUBJECT)).resolves.toEqual({
      attempts: 3,
      remainingMinutes: 2,
    });
  });

  it("FAILS OPEN when the store cannot be read, and says so in the log", async () => {
    // The credential check needs the same database anyway: refusing here would turn a blip into an
    // outage for the honest user while denying an attacker nothing.
    getPrismaClient.mockRejectedValue(new Error("db is down"));
    await expect(attemptState(AuthAttemptScope.LOGIN, SUBJECT)).resolves.toBeNull();
    expect(logger.error).toHaveBeenCalled();
  });
});

describe("recordFailedAttempt", () => {
  it("starts a window on the first failure", async () => {
    const { client } = fakeStore();
    await expect(
      recordFailedAttempt(AuthAttemptScope.LOGIN, SUBJECT, WINDOW_MS),
    ).resolves.toEqual({ attempts: 1, remainingMinutes: 15 });
    expect(client.authAttempt.upsert).toHaveBeenCalled();
  });

  it("increments IN THE DATABASE while the window is live", async () => {
    // Atomicity is the point: a read-then-write would let two simultaneous guesses both read 4 and
    // both write 5, so a lockout could be walked past by racing it.
    const { client } = fakeStore({ attempts: 2, resetAt: new Date(Date.now() + WINDOW_MS) });
    await expect(
      recordFailedAttempt(AuthAttemptScope.LOGIN, SUBJECT, WINDOW_MS),
    ).resolves.toMatchObject({ attempts: 3 });
    expect(client.authAttempt.updateMany).toHaveBeenCalled();
    expect(client.authAttempt.upsert).not.toHaveBeenCalled();
  });

  it("REPLACES a lapsed window instead of resuming it", async () => {
    fakeStore({ attempts: 5, resetAt: new Date(Date.now() - 1000) });
    await expect(
      recordFailedAttempt(AuthAttemptScope.LOGIN, SUBJECT, WINDOW_MS),
    ).resolves.toMatchObject({ attempts: 1 });
  });

  it("FAILS OPEN when the store cannot be written", async () => {
    getPrismaClient.mockRejectedValue(new Error("db is down"));
    await expect(
      recordFailedAttempt(AuthAttemptScope.LOGIN, SUBJECT, WINDOW_MS),
    ).resolves.toBeNull();
    expect(logger.error).toHaveBeenCalled();
  });
});

describe("clearAttempts", () => {
  it("forgets a subject's failures", async () => {
    const { client } = fakeStore({ attempts: 4, resetAt: new Date(Date.now() + WINDOW_MS) });
    await clearAttempts(AuthAttemptScope.LOGIN, SUBJECT);
    expect(client.authAttempt.deleteMany).toHaveBeenCalledWith({
      where: { scope: AuthAttemptScope.LOGIN, subject: SUBJECT },
    });
  });

  it("never throws when the store is unreachable — a successful login must still complete", async () => {
    getPrismaClient.mockRejectedValue(new Error("db is down"));
    await expect(clearAttempts(AuthAttemptScope.LOGIN, SUBJECT)).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalled();
  });
});
