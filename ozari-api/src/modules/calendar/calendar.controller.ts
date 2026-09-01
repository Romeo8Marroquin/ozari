import crypto from "node:crypto";
import type { Request, Response } from "express";
import jwt from "jsonwebtoken";
import { appConfig } from "@/config/app.js";
import { i18next } from "@/config/i18n.js";
import { logger } from "@/config/logger.js";
import { getAppHost } from "@/config/environment.js";
import { getPrismaClient } from "@/services/prisma.service.js";
import { decryptKms, encryptKms } from "@helpers/encryption.js";
import { type CustomRequest } from "@models/common/customRequestModel.js";
import { CalendarProviderEnum } from "@models/enums/calendarProviderEnum.js";
import { HttpEnum } from "@models/enums/httpEnum.js";
import { sendOzariError } from "@models/http/ozariErrorModel.js";
import { sendOzariSuccess } from "@models/http/ozariSuccessModel.js";
import { loadOrderTimingPreferences } from "../orders/orders.service.js";
import { buildIcs, calendarEntriesFor } from "./calendar.service.js";
import { loadCalendarReminderMinutes } from "./calendar.sync.js";
import {
  buildGoogleAuthUrl,
  exchangeGoogleCode,
  fetchGoogleAccountEmail,
  isGoogleConfigured,
  revokeGoogleGrant,
} from "./google.service.js";
import type {
  CalendarAuthorizeEnvelopeModel,
  CalendarOrderModel,
  CalendarStatusEnvelopeModel,
} from "./calendar.models.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The API's own public origin, as the caller actually reached it.
 *
 * Two URLs are built from it and both must be exact: the OAuth redirect (Google matches it byte for
 * byte against the console registration, on BOTH the consent and the exchange) and the feed URL an
 * admin pastes into a calendar app. Deriving it from the request means those two agree by
 * construction and no environment variable has to be kept in step with a console setting — and
 * `req.protocol` is honest behind the proxy because the app trusts one hop.
 *
 * `API_PUBLIC_URL` overrides it when set, for the deployment that fronts the API under a name the
 * request cannot see — which is exactly staging's shape: the Cloudflare Worker in front of Cloud Run
 * rewrites the `Host` to the `run.app` name (DEPLOYMENT.md §3c), so the request genuinely cannot see
 * the brand host an admin should be pasting into their calendar app.
 *
 * An EMPTY value counts as unset. Both Cloud Build's `--set-env-vars` and Terraform do a full
 * replacement of the env list, so an optional var is carried as an empty string in every deployment
 * that hasn't set it — and `??` would treat that empty string as a deliberate origin, producing a
 * redirect URI of `/api/calendar/…` with no host at all. That fails as a `redirect_uri_mismatch` on
 * Google's side, i.e. somewhere we cannot report it. Same reasoning as `googleCredentials()`.
 */
export const publicBaseUrl = (req: Request): string => {
  const override = process.env["API_PUBLIC_URL"]?.trim();
  return override
    ? override.replace(/\/+$/, "")
    : `${req.protocol}://${req.get("host") ?? ""}`;
};

/** Where the admin is sent back to after consent — their own settings screen, with a marker the UI
 *  turns into a toast. A redirect, not a JSON response: the browser arrives here from Google's
 *  page, so there is nothing on the other end to read a body. */
const settingsRedirect = (outcome: "conectado" | "error"): string =>
  `${getAppHost()}/panel/ajustes?calendario=${outcome}`;

/** The OAuth `state`: a short-lived signed token carrying WHO is connecting.
 *
 *  It has to carry the identity because the consent redirect is a plain top-level navigation — our
 *  refresh cookie is scoped to `/api/auth` and the access token lives in sessionStorage, so nothing
 *  else on that request says who the user is. Signed and expiring, because it is a bearer credential
 *  travelling in a URL through a third party. */
function signState(userId: number): string {
  const secret = process.env["JWT_SECRET"];
  if (!secret) {
    throw new Error("JWT secrets are not configured");
  }
  return jwt.sign({ userId, purpose: "calendar-connect" }, secret, {
    algorithm: appConfig.mfaToken.algorithm,
    audience: appConfig.mfaToken.audience,
    issuer: appConfig.mfaToken.issuer,
    expiresIn: appConfig.calendar.stateTtlSeconds,
  });
}

/** Verifies a `state` and returns the user it was minted for, or `null` for anything unverifiable —
 *  wrong signature, wrong purpose, expired, or absent. */
export function readState(state: string | undefined): number | null {
  const secret = process.env["JWT_SECRET"];
  if (!state || !secret) {
    return null;
  }
  try {
    const payload = jwt.verify(state, secret, {
      algorithms: [appConfig.mfaToken.algorithm],
      audience: appConfig.mfaToken.audience,
      issuer: appConfig.mfaToken.issuer,
    }) as { userId?: number; purpose?: string };
    // The purpose check keeps a token minted for one flow from being replayed into another — an
    // access token is signed with the same secret and would otherwise verify here.
    if (payload.purpose !== "calendar-connect" || typeof payload.userId !== "number") {
      return null;
    }
    return payload.userId;
  } catch {
    return null;
  }
}

/**
 * `GET /calendar` — everything the settings screen renders, in one call.
 *
 * It never returns a token or a refresh token. The one secret it does hand back is the FEED URL,
 * because the whole point of a feed is that the admin copies it into another app — and it is stored
 * encrypted (rather than only hashed) precisely so it can be shown again on a second device.
 */
export const getCalendarStatus = async (
  req: CustomRequest,
  res: Response,
): Promise<void> => {
  try {
    const userId = req.user?.userId ?? 0;
    const prismaClient = await getPrismaClient();
    const [connection, feed, reminderMinutes] = await Promise.all([
      prismaClient.calendarConnection.findFirst({
        where: { userId, provider: CalendarProviderEnum.GOOGLE },
      }),
      prismaClient.calendarFeed.findFirst({ where: { userId } }),
      loadCalendarReminderMinutes(prismaClient),
    ]);

    const response: CalendarStatusEnvelopeModel = {
      calendar: {
        google: {
          connected: connection !== null,
          isActive: connection?.isActive ?? false,
          ...(connection?.accountEmailKms
            ? { accountEmail: decryptKms(connection.accountEmailKms) }
            : {}),
        },
        feed: {
          isActive: feed?.isActive ?? false,
          ...(feed ? { url: feedUrl(req, decryptKms(feed.tokenKms)) } : {}),
        },
        reminderMinutes,
        googleAvailable: isGoogleConfigured(),
      },
    };
    sendOzariSuccess(res, HttpEnum.OK, i18next.t("calendar.status.success"), response);
  } catch (error) {
    logger.error(i18next.t("calendar.logs.statusError"), { error });
    sendOzariError(
      res,
      HttpEnum.INTERNAL_SERVER_ERROR,
      i18next.t("calendar.status.error"),
    );
  }
};

/** The absolute URL a calendar app subscribes to. `webcal://` is deliberately NOT used: it is not a
 *  registered scheme, Android has no handler for it, and every calendar that accepts a subscription
 *  accepts `https://`. The UI offers the plain URL and lets the app do the rest. */
function feedUrl(req: Request, token: string): string {
  return `${publicBaseUrl(req)}${appConfig.basePath}/calendar/feed/${token}.ics`;
}

/** `GET /calendar/google/authorize` — hands back the consent URL rather than redirecting, so the
 *  caller keeps its session and can open it in whatever way suits (a new tab, the same one). */
export const authorizeGoogleCalendar = (req: CustomRequest, res: Response): void => {
  if (!isGoogleConfigured()) {
    // A deliberate 503 rather than a 500: the deployment is missing credentials, which is a
    // configuration state the UI can explain, not a bug it should apologise for.
    sendOzariError(
      res,
      HttpEnum.SERVICE_UNAVAILABLE,
      i18next.t("calendar.google.notConfigured"),
    );
    return;
  }
  const response: CalendarAuthorizeEnvelopeModel = {
    authorizeUrl: buildGoogleAuthUrl(signState(req.user?.userId ?? 0), publicBaseUrl(req)),
  };
  sendOzariSuccess(res, HttpEnum.OK, i18next.t("calendar.google.authorizeSuccess"), response);
};

/**
 * `GET /calendar/google/callback` — where Google returns the browser after consent.
 *
 * **Every outcome is a REDIRECT, never a JSON error.** The person on this request is looking at a
 * browser tab, not at an API client: an error object rendered as raw text on our API's domain is a
 * dead end, so a failure hands them back to the settings screen with a marker it can explain.
 */
export const googleCalendarCallback = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const userId = readState(req.query["state"] as string | undefined);
  const code = req.query["code"] as string | undefined;
  if (!userId || !code || !isGoogleConfigured()) {
    logger.warn(i18next.t("calendar.logs.callbackRejected"));
    res.redirect(settingsRedirect("error"));
    return;
  }
  try {
    const tokens = await exchangeGoogleCode(code, publicBaseUrl(req));
    if (!tokens.refreshToken) {
      // Without a refresh token the grant dies in an hour. It happens when Google has already
      // granted this app before and `prompt=consent` was lost — better to fail loudly here than to
      // store a connection that stops working after lunch.
      throw new Error("google returned no refresh token");
    }
    const accountEmail = await fetchGoogleAccountEmail(tokens.accessToken);
    const prismaClient = await getPrismaClient();
    const secrets = {
      refreshTokenKms: encryptKms(tokens.refreshToken),
      accessTokenKms: encryptKms(tokens.accessToken),
      accessTokenExpiresAt: tokens.expiresAt,
      ...(accountEmail ? { accountEmailKms: encryptKms(accountEmail) } : {}),
      isActive: true,
    };
    await prismaClient.calendarConnection.upsert({
      where: {
        uq_calendar_connections_user_provider: {
          userId,
          provider: CalendarProviderEnum.GOOGLE,
        },
      },
      // Re-connecting REPLACES the grant rather than adding a second one: an account can only have
      // one live consent, and keeping the old refresh token would leave a revoked one behind.
      update: secrets,
      create: { userId, provider: CalendarProviderEnum.GOOGLE, ...secrets },
    });
    logger.info(i18next.t("calendar.logs.connected", { userId }));
    res.redirect(settingsRedirect("conectado"));
  } catch (error) {
    logger.error(i18next.t("calendar.logs.callbackError"), { error });
    res.redirect(settingsRedirect("error"));
  }
};

/**
 * `DELETE /calendar/google` — disconnect.
 *
 * The row is HARD-deleted (NO-TRASH: nothing references a connection, and a disabled row holding a
 * live refresh token is a credential nobody is watching), and the grant is revoked with Google so it
 * disappears from the user's own third-party access list too. The revoke is best-effort: our copy
 * goes either way, and a network failure must not leave the admin unable to disconnect.
 *
 * Events already written are deliberately LEFT in the calendar. They are appointments the person
 * still has to keep, and silently emptying somebody's week because they unlinked an integration
 * would be a far worse surprise than a few entries that stop updating.
 */
export const disconnectGoogleCalendar = async (
  req: CustomRequest,
  res: Response,
): Promise<void> => {
  try {
    const userId = req.user?.userId ?? 0;
    const prismaClient = await getPrismaClient();
    const connection = await prismaClient.calendarConnection.findFirst({
      where: { userId, provider: CalendarProviderEnum.GOOGLE },
    });
    if (connection) {
      await prismaClient.calendarConnection.delete({ where: { id: connection.id } });
      try {
        await revokeGoogleGrant(decryptKms(connection.refreshTokenKms));
      } catch (error) {
        logger.warn(i18next.t("calendar.logs.revokeFailed"), { error });
      }
    }
    logger.info(i18next.t("calendar.logs.disconnected", { userId }));
    sendOzariSuccess(res, HttpEnum.OK, i18next.t("calendar.google.disconnected"), {});
  } catch (error) {
    logger.error(i18next.t("calendar.logs.disconnectError"), { error });
    sendOzariError(
      res,
      HttpEnum.INTERNAL_SERVER_ERROR,
      i18next.t("calendar.google.disconnectError"),
    );
  }
};

/**
 * `POST /calendar/feed` — mint (or REGENERATE) the subscription URL.
 *
 * Regenerating is the revoke: the new token replaces the old one, so every subscription made with
 * the previous URL stops resolving immediately. That is the only way to take back a URL that has
 * been pasted into somebody else's phone.
 */
export const createCalendarFeed = async (
  req: CustomRequest,
  res: Response,
): Promise<void> => {
  try {
    const userId = req.user?.userId ?? 0;
    const token = crypto.randomBytes(appConfig.calendar.feedTokenBytes).toString("hex");
    const record = {
      // SHA for the lookup (a unique index on a hash, like `email_sha`), encrypted for redisplay —
      // an admin adding the calendar to a second phone needs the same URL again.
      tokenSha: crypto.createHash("sha256").update(token).digest("hex"),
      tokenKms: encryptKms(token),
      isActive: true,
    };
    const prismaClient = await getPrismaClient();
    await prismaClient.calendarFeed.upsert({
      where: { userId },
      update: record,
      create: { userId, ...record },
    });
    sendOzariSuccess(res, HttpEnum.OK, i18next.t("calendar.feed.created"), {
      url: feedUrl(req, token),
    });
  } catch (error) {
    logger.error(i18next.t("calendar.logs.feedError"), { error });
    sendOzariError(
      res,
      HttpEnum.INTERNAL_SERVER_ERROR,
      i18next.t("calendar.feed.error"),
    );
  }
};

/** `DELETE /calendar/feed` — stop publishing. Hard delete, same reasoning as the connection: a
 *  disabled row holding a live token is a credential nobody is watching. */
export const deleteCalendarFeed = async (
  req: CustomRequest,
  res: Response,
): Promise<void> => {
  try {
    const userId = req.user?.userId ?? 0;
    const prismaClient = await getPrismaClient();
    await prismaClient.calendarFeed.deleteMany({ where: { userId } });
    sendOzariSuccess(res, HttpEnum.OK, i18next.t("calendar.feed.deleted"), {});
  } catch (error) {
    logger.error(i18next.t("calendar.logs.feedError"), { error });
    sendOzariError(
      res,
      HttpEnum.INTERNAL_SERVER_ERROR,
      i18next.t("calendar.feed.error"),
    );
  }
};

/**
 * `GET /calendar/feed/:token.ics` — the subscribable calendar.
 *
 * **The token in the path is the ONLY credential**, which is what makes this route the single
 * exception to the API-key rule (see `app.ts`): Apple Calendar sends no headers we control, no
 * cookies and no origin. It is a 32-byte random value, hashed in storage, and regenerating it
 * invalidates every subscription made with the old one.
 *
 * An unknown token answers **404 with no body** rather than a JSON error: this endpoint is spoken to
 * by calendar clients, not people, and a body they cannot parse is noise in somebody's console.
 *
 * The window is bounded (`feedPastDays` / `feedFutureDays`) because a subscription is a working
 * schedule, not an archive — every refresh, on every device, would otherwise ship the entire history
 * of the business.
 */
export const getCalendarFeed = async (req: Request, res: Response): Promise<void> => {
  try {
    const raw = String(req.params["token"] ?? "").replace(/\.ics$/u, "");
    const tokenSha = crypto.createHash("sha256").update(raw).digest("hex");
    const prismaClient = await getPrismaClient();
    const feed = await prismaClient.calendarFeed.findFirst({
      where: { tokenSha, isActive: true },
      select: { userId: true },
    });
    if (!feed) {
      res.status(HttpEnum.NOT_FOUND).end();
      return;
    }

    const now = new Date();
    const [orders, { spacingMinutes }, reminderMinutes] = await Promise.all([
      prismaClient.service.findMany({
        where: {
          isActive: true,
          cancelledAt: null,
          // ⚠️ **This subscriber's OWN jobs, and nobody else's.** The feed used to return every
          // order in the window to every token, so an admin who subscribed on their phone received
          // work assigned to someone else — the same leak the Google half had, and the one that is
          // hardest to notice, because a subscription just quietly fills up. A feed is one person's
          // schedule; `assignedUserId` is what makes it theirs. (Owner, 2026-08-31.)
          assignedUserId: feed.userId,
          deliveryAt: {
            gte: new Date(now.getTime() - appConfig.calendar.feedPastDays * DAY_MS),
            lte: new Date(now.getTime() + appConfig.calendar.feedFutureDays * DAY_MS),
          },
        },
        select: {
          id: true,
          deliveryAt: true,
          pickupAt: true,
          deliveredAt: true,
          collectedAt: true,
          cancelledAt: true,
          updatedAt: true,
          createdAt: true,
          deliveryNameKms: true,
          deliveryAddressKms: true,
          eventType: { select: { name: true } },
          serviceDetails: { where: { isActive: true }, select: { quantity: true } },
        },
      }),
      loadOrderTimingPreferences(prismaClient),
      loadCalendarReminderMinutes(prismaClient),
    ]);

    const entries = orders.flatMap((row) => {
      const order: CalendarOrderModel = {
        id: row.id,
        deliveryAt: row.deliveryAt,
        pickupAt: row.pickupAt,
        deliveredAt: row.deliveredAt,
        collectedAt: row.collectedAt,
        cancelledAt: row.cancelledAt,
        updatedAt: row.updatedAt,
        createdAt: row.createdAt,
        // Already narrowed to this subscriber by the query above; carried so the model is the same
        // shape the sync builds and neither can drift from the other.
        assignedUserId: feed.userId,
        clientName: decryptKms(row.deliveryNameKms),
        address: decryptKms(row.deliveryAddressKms),
        eventTypeName: row.eventType.name,
        itemCount: row.serviceDetails.reduce((total, line) => total + line.quantity, 0),
      };
      return calendarEntriesFor(order, {
        gapMinutes: spacingMinutes,
        reminderMinutes,
        now,
      });
    });

    res.setHeader("content-type", "text/calendar; charset=utf-8");
    // Never cached: the whole value of a subscription is that a refresh sees the current schedule,
    // and an intermediary holding yesterday's copy would silently defeat it.
    res.setHeader("cache-control", "no-store, max-age=0");
    res.send(
      buildIcs(entries, { name: i18next.t("calendar.feed.name"), stamp: now }),
    );
  } catch (error) {
    logger.error(i18next.t("calendar.logs.feedError"), { error });
    res.status(HttpEnum.INTERNAL_SERVER_ERROR).end();
  }
};
