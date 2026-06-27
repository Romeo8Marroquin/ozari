import { isAxiosError } from 'axios';
import i18next from 'i18next';

interface AuthErrorOptions {
  /** i18n key for the generic fallback message. */
  fallback: string;
  /** i18n key for the "couldn't reach the server" case (no HTTP response). */
  networkError: string;
  /** Map of HTTP status -> i18n key for specific, friendly messages. */
  byStatus?: Record<number, string>;
}

/**
 * Turns an unknown error (typically from axios) into a localized, user-facing
 * message. Falls back gracefully: a specific message per status when provided, a
 * network message when the request never reached the server, else the fallback.
 */
export function getAuthErrorMessage(error: unknown, options: AuthErrorOptions): string {
  if (isAxiosError(error)) {
    if (!error.response) return i18next.t(options.networkError);
    const key = options.byStatus?.[error.response.status];
    if (key) return i18next.t(key);
  }
  return i18next.t(options.fallback);
}
