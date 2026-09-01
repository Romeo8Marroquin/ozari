import { appConfig } from "@/config/app.js";
import { getAppHost } from "@/config/environment.js";
import type { CalendarEntryModel } from "./calendar.models.js";

const { google } = appConfig.calendar;

/**
 * GOOGLE CALENDAR — the only calendar with a real write API.
 *
 * Plain `fetch` against three documented endpoints; no SDK. `googleapis` is a ~50 MB dependency that
 * ships every Google API ever published, and what we need is an OAuth code exchange, a token
 * refresh and three REST calls. The same reasoning that keeps `totp.ts` hand-rolled applies here,
 * with the added weight that this runs on a scale-to-zero container where import cost is startup
 * latency on every cold request.
 *
 * Nothing in this module touches the database or the encryption helpers: it takes tokens and returns
 * tokens. That is what lets it be tested against a mocked `fetch` with no Prisma in sight.
 */

/** The OAuth client, from the environment. Read on every call (never cached at module load), the
 *  same rule `environment.ts` follows — a test or a script may set them after import. */
export function googleCredentials(): { clientId: string; clientSecret: string } | null {
  const clientId = process.env["GOOGLE_CLIENT_ID"];
  const clientSecret = process.env["GOOGLE_CLIENT_SECRET"];
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

/** Is the Google half configured at all? The settings screen asks, so it can offer the ICS feed and
 *  SAY why rather than showing a Connect button that could only ever fail. */
export function isGoogleConfigured(): boolean {
  return googleCredentials() !== null;
}

/** The credentials, or a refusal. ONE throw site rather than a defensive check in every function:
 *  the routes are guarded by {@link isGoogleConfigured} and answer a clean `503`, so reaching this
 *  means the deployment lost its credentials mid-flight — real, but never a normal path. */
function requireCredentials(): { clientId: string; clientSecret: string } {
  const credentials = googleCredentials();
  if (!credentials) {
    throw new Error("google calendar is not configured");
  }
  return credentials;
}

/**
 * Where Google sends the browser back.
 *
 * **This exact string must also be registered in the Google Cloud console** — an OAuth redirect is
 * matched byte for byte, and a mismatch is a `redirect_uri_mismatch` page on Google's side rather
 * than a failure we could ever report. It is therefore passed IN by the caller, which derives it
 * from the live request (see `publicBaseUrl`): the consent and the code exchange then agree by
 * construction, and no environment variable has to be kept in sync with a console setting.
 */
export function googleRedirectUri(baseUrl: string): string {
  return `${baseUrl}${appConfig.basePath}/calendar/google/callback`;
}

/**
 * The consent URL.
 *
 * Three parameters carry real weight:
 * - `access_type=offline` is what makes Google return a REFRESH token. Without it the grant lasts an
 *   hour and the integration silently stops working after lunch.
 * - `prompt=consent` forces the consent screen every time, which is the only way to be handed a
 *   refresh token on a RE-connect: Google issues one on the first grant only, so reconnecting an
 *   account that was already authorised would otherwise return an access token and nothing to
 *   refresh it with.
 * - `include_granted_scopes` keeps any scope the user already gave us, so connecting the calendar
 *   never quietly revokes something else.
 */
export function buildGoogleAuthUrl(state: string, baseUrl: string): string {
  const credentials = requireCredentials();
  const params = new URLSearchParams({
    client_id: credentials.clientId,
    redirect_uri: googleRedirectUri(baseUrl),
    response_type: "code",
    scope: google.scopes.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `${google.authUrl}?${params.toString()}`;
}

/** A token response, in the only shape the rest of the module cares about. */
export interface GoogleTokens {
  accessToken: string;
  /** Absent on a REFRESH — Google returns one only when it mints a new grant, and the stored one
   *  stays valid. A caller must never overwrite a stored refresh token with `undefined`. */
  refreshToken?: string;
  expiresAt: Date;
}

/** Raised when Google says the grant itself is dead (`invalid_grant`) — the user revoked access in
 *  their Google account, or the refresh token expired. It is NOT a transient failure: retrying can
 *  only fail again, so the caller deactivates the connection instead of logging forever. */
export class GoogleGrantRevokedError extends Error {
  constructor() {
    super("google grant revoked");
    this.name = "GoogleGrantRevokedError";
  }
}

async function requestTokens(body: Record<string, string>): Promise<GoogleTokens> {
  const credentials = requireCredentials();
  const response = await fetch(google.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      ...body,
    }).toString(),
  });
  const payload = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string;
  };
  if (!response.ok || !payload.access_token) {
    // `invalid_grant` is the one error that means "stop trying", so it is separated from every
    // other failure here rather than at the call site, where it would be forgotten.
    if (payload.error === "invalid_grant") {
      throw new GoogleGrantRevokedError();
    }
    throw new Error(`google token request failed: ${payload.error ?? response.status}`);
  }
  return {
    accessToken: payload.access_token,
    ...(payload.refresh_token ? { refreshToken: payload.refresh_token } : {}),
    // A minute of slack, so a token never dies mid-request on the boundary.
    expiresAt: new Date(
      Date.now() + ((payload.expires_in ?? 3600) - google.accessTokenSkewSeconds) * 1000,
    ),
  };
}

/** Exchange the consent `code` for the long-lived grant. The redirect URI is sent AGAIN here and
 *  must be byte-identical to the one consent was requested with — Google verifies it. */
export function exchangeGoogleCode(
  code: string,
  baseUrl: string,
): Promise<GoogleTokens> {
  return requestTokens({
    code,
    redirect_uri: googleRedirectUri(baseUrl),
    grant_type: "authorization_code",
  });
}

/** Trade the refresh token for a fresh access token. */
export function refreshGoogleAccessToken(refreshToken: string): Promise<GoogleTokens> {
  return requestTokens({ refresh_token: refreshToken, grant_type: "refresh_token" });
}

/** Which account was connected — shown in the UI so an admin can tell they linked the right one.
 *  A failure here is not fatal: the connection works without a label. */
export async function fetchGoogleAccountEmail(
  accessToken: string,
): Promise<string | undefined> {
  const response = await fetch(google.userInfoUrl, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    return undefined;
  }
  const payload = (await response.json()) as { email?: string };
  return payload.email;
}

/** The event body Google's API takes. Built here rather than by the caller so the reminder rule and
 *  the entry's window can never be applied differently by two transports. */
export function googleEventBody(entry: CalendarEntryModel): Record<string, unknown> {
  return {
    id: entry.id,
    summary: entry.summary,
    description: entry.description,
    ...(entry.location ? { location: entry.location } : {}),
    start: { dateTime: entry.start.toISOString(), timeZone: appConfig.calendar.timeZone },
    end: { dateTime: entry.end.toISOString(), timeZone: appConfig.calendar.timeZone },
    // `useDefault: false` is required for overrides to apply at all — with it true Google ignores
    // the list entirely and uses whatever the calendar's own default happens to be.
    reminders:
      entry.reminderMinutes === undefined
        ? { useDefault: false, overrides: [] }
        : {
            useDefault: false,
            overrides: [{ method: "popup", minutes: entry.reminderMinutes }],
          },
    // Ours to manage. Anyone editing the event in Google will have it overwritten on the next sync,
    // which is the honest behaviour for a mirrored record.
    guestsCanModify: false,
    source: { title: "Ozari", url: `${getAppHost()}/panel/pedidos/${entry.orderId}` },
  };
}

async function calendarFetch(
  accessToken: string,
  path: string,
  init: RequestInit,
): Promise<Response> {
  return fetch(`${google.apiBase}${path}`, {
    ...init,
    headers: {
      ...init.headers,
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
  });
}

/**
 * Write one entry into a calendar — create it, or replace it if it is already there.
 *
 * The order of the two calls is deliberate: **update first, insert on 404.** An order is synced far
 * more often than it is created (every edit, every step), so the common path is one request; and
 * trying to insert first would make a `409 duplicate` the normal case, which is a confusing shape to
 * read in logs. A `410 Gone` is treated like a 404 — that is what Google answers once an event has
 * been deleted, and re-creating it is exactly right when the order still needs to happen.
 */
export async function upsertGoogleEvent(
  accessToken: string,
  calendarId: string,
  entry: CalendarEntryModel,
): Promise<void> {
  const body = JSON.stringify(googleEventBody(entry));
  const encoded = encodeURIComponent(calendarId);
  const updated = await calendarFetch(
    accessToken,
    `/calendars/${encoded}/events/${entry.id}`,
    { method: "PUT", body },
  );
  if (updated.ok) {
    return;
  }
  if (updated.status !== 404 && updated.status !== 410) {
    throw new Error(`google event update failed: ${updated.status}`);
  }
  const created = await calendarFetch(accessToken, `/calendars/${encoded}/events`, {
    method: "POST",
    body,
  });
  // A 409 means the id already exists — which can only happen if a concurrent sync just created it,
  // and the event is therefore exactly what we wanted. Not an error.
  if (!created.ok && created.status !== 409) {
    throw new Error(`google event insert failed: ${created.status}`);
  }
}

/** Remove an entry. Already gone (404/410) is SUCCESS: the desired end state is "not in the
 *  calendar", and an admin who deleted it by hand has already achieved it. */
export async function deleteGoogleEvent(
  accessToken: string,
  calendarId: string,
  entryId: string,
): Promise<void> {
  const response = await calendarFetch(
    accessToken,
    `/calendars/${encodeURIComponent(calendarId)}/events/${entryId}`,
    { method: "DELETE" },
  );
  if (!response.ok && response.status !== 404 && response.status !== 410) {
    throw new Error(`google event delete failed: ${response.status}`);
  }
}

/** Tell Google the grant is finished, so it disappears from the user's "third-party access" list
 *  rather than lingering as a permission nobody uses. Best-effort by nature: we are deleting our
 *  copy either way, and a failure here must not block that. */
export async function revokeGoogleGrant(refreshToken: string): Promise<void> {
  await fetch(google.revokeUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token: refreshToken }).toString(),
  });
}
