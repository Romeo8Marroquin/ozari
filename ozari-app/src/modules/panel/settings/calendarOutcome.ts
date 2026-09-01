/**
 * The marker Google's callback hands back on the URL.
 *
 * The consent flow leaves this app entirely and returns as a fresh page load, so there is no
 * mutation result to report from — the outcome arrives in the query string or not at all. It is
 * parsed here, as a pure function, because "what did the round trip say" is a decision and the rest
 * of the section only has to render it.
 */
export type CalendarOutcome = 'connected' | 'error';

/** The URL value ↔ the internal token, in one place. The URL speaks Spanish like every other search
 *  param in this app; the token stays English because it also keys the i18n leaves. */
const OUTCOME_BY_PARAM: Record<string, CalendarOutcome> = {
  conectado: 'connected',
  error: 'error',
};

/** Clamp-never-reject, the app's stance everywhere: anything unrecognised is simply no outcome. */
export function readCalendarOutcome(search: string): CalendarOutcome | undefined {
  const raw = new URLSearchParams(search).get('calendario');
  return raw === null ? undefined : OUTCOME_BY_PARAM[raw];
}

/**
 * The lead time, as a key and a count — the unit a person would actually say it in.
 *
 * `1440` is "1 día", not "1440 minutos": the point of showing this on the settings screen is to
 * confirm the rule at a glance, and a four-digit number is something you have to do arithmetic on.
 * Returned as a key rather than a string (the `relativeTime` pattern) so the decision is pure and
 * the interpolation stays with the component that owns the translator.
 */
export function leadTimeKey(minutes: number): { key: string; count: number } {
  if (minutes === 0) return { key: 'atStart', count: 0 };
  if (minutes % 1440 === 0) return { key: 'days', count: minutes / 1440 };
  if (minutes % 60 === 0) return { key: 'hours', count: minutes / 60 };
  return { key: 'minutes', count: minutes };
}

/**
 * The same URL with the marker removed.
 *
 * It has to go once it has been read: a reload — or a bookmark of the page as it stands — would
 * otherwise announce a connection that happened days ago. Returned rather than applied so the
 * caller owns the history write and this stays testable.
 */
export function withoutCalendarOutcome(url: string): string {
  const parsed = new URL(url, 'https://placeholder.invalid');
  parsed.searchParams.delete('calendario');
  const query = parsed.searchParams.toString();
  return `${parsed.pathname}${query ? `?${query}` : ''}${parsed.hash}`;
}
