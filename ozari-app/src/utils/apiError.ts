import axios, { type AxiosError } from 'axios';
import i18next from 'i18next';

/**
 * Central error-classification helpers, shared by the axios interceptor and the refresh flow so
 * "what does this status mean" is decided in exactly one place.
 *
 * The guiding split (see the error-handling doctrine): a status code is not a UX decision. What
 * matters is the *concern* — is the failure **transient** (retry/notify, keep the session) or does
 * it mean the **session is dead** (auth failure → forced logout)? Everything else is contextual.
 */

/** The HTTP status of a failed request, or `undefined` for a network error / timeout (no response). */
export function getStatus(error: AxiosError): number | undefined {
  return error.response?.status;
}

/** No response at all — the request never reached the server (offline, DNS, timeout, CORS). */
export function isNetworkError(error: AxiosError): boolean {
  return !error.response;
}

/**
 * A transient failure the app can recover from without ending the session: a network blip, a
 * rate-limit (429), or a server error (5xx). These get a notification and a chance to retry — they
 * must NEVER trigger a logout, even when they happen on the refresh round-trip.
 */
export function isTransientStatus(status: number | undefined): boolean {
  return status === undefined || status === 429 || status >= 500;
}

/**
 * An **auth** failure on the refresh endpoint — the refresh token itself was rejected (invalid,
 * expired, or reuse-detected → all sessions purged server-side). This is the only signal that the
 * session is genuinely dead and warrants a forced logout. A 401/403 that is really a transient
 * hiccup won't reach here because those don't come back as 401/403 from `/auth/refresh`.
 */
export function isAuthFailure(status: number | undefined): boolean {
  return status === 401 || status === 403;
}

/** The friendly `message` the backend put in the body (see `sendOzariError`), if any. */
export function getServerMessage(error: AxiosError): string | undefined {
  const data = error.response?.data as { message?: string } | undefined;
  return typeof data?.message === 'string' && data.message.trim() ? data.message : undefined;
}

/**
 * A gateway/unavailable status meaning the **backend itself is down** (deploy in progress, no
 * instances, DB unreachable) — as opposed to a 500, which is a bug in one handler while the service
 * is otherwise up. Outage statuses escalate to the full-screen app overlay + health poll; they do
 * NOT toast and are NOT handled inline by forms.
 */
export function isOutageStatus(status: number | undefined): boolean {
  return status === 502 || status === 503 || status === 504;
}

/**
 * A status a **form** should own **inline** rather than the global toast layer: a validation/semantic
 * client error tied to what the user just submitted (bad input, bad credentials, a duplicate). The
 * global concerns (429/5xx/network/403) are NOT here — those stay toasts.
 */
export function isInlineFormError(status: number | undefined): boolean {
  return status === 400 || status === 401 || status === 409 || status === 422;
}

/**
 * Routes a failed **form submit** to the right surface: an `inline` message the form renders itself
 * (for validation/credential/duplicate errors), or a `toast` for the global/transient concerns. The
 * single decision point so login, register and every future form behave identically.
 *
 * @param fallbackInline copy to show inline when the server didn't provide a specific message.
 */
export function toFormError(
  error: unknown,
  fallbackInline: string,
): { inline?: string; toast?: string } {
  if (!axios.isAxiosError(error)) return { toast: i18next.t('errors.generic') };
  const status = getStatus(error);
  // Backend down → the full-screen outage overlay owns it; the form says nothing (no toast).
  if (isOutageStatus(status)) return {};
  if (isInlineFormError(status)) {
    return { inline: getServerMessage(error) ?? fallbackInline };
  }
  return { toast: resolveApiErrorMessage(error) };
}

/**
 * The `Retry-After` value (seconds) from a 429/503, if the server sent one and it's a plain delay.
 * Lets us show "try again in N s" instead of a vague "wait a few minutes". Ignores HTTP-date form.
 */
export function getRetryAfterSeconds(error: AxiosError): number | undefined {
  const header = error.response?.headers?.['retry-after'];
  if (typeof header !== 'string') return undefined;
  const seconds = Number(header.trim());
  return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : undefined;
}

/**
 * Resolves a single, user-friendly message for a failed request. The backend already returns a
 * localized, friendly `message` (see `sendOzariError`) so we prefer that; we only synthesize copy
 * for cases the server can't speak to (no response = network/offline) or a response that carries no
 * message (e.g. a bare 5xx). 429/503 upgrade to a countdown when a `Retry-After` is present.
 */
export function resolveApiErrorMessage(error: AxiosError): string {
  if (isNetworkError(error)) {
    return navigator.onLine ? i18next.t('errors.network') : i18next.t('errors.offline');
  }

  const status = getStatus(error);

  // A concrete "try again in N s" countdown is more actionable than any generic copy, so it wins.
  if (status === 429 || status === 503) {
    const retryAfter = getRetryAfterSeconds(error);
    if (retryAfter !== undefined) {
      return i18next.t('errors.tooManyRequestsWait', { seconds: retryAfter });
    }
  }

  const serverMessage = getServerMessage(error);
  if (serverMessage) return serverMessage;

  if (status === 503) return i18next.t('errors.maintenance');
  if (status === 429) return i18next.t('errors.tooManyRequests');
  if (status !== undefined && status >= 500) return i18next.t('errors.server');
  if (status === 401 || status === 403) return i18next.t('errors.unauthorized');
  return i18next.t('errors.generic');
}
