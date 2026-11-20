/**
 * The signed-in person's OWN working preferences (`user_preferences`) — how *I* work, as opposed to
 * the business-wide rules under `/preferences` (how the business runs). Owner, 2026-11-19: they
 * follow the PERSON to every device (never local storage) and differ between the people who create
 * orders, so neither a device setting nor an app preference could hold them.
 *
 * `null` always means "the default behaviour", so an account that never saved anything reads as
 * all-`null` without a row having to exist.
 */
export interface AccountPreferencesModel {
  /**
   * How the order form fills its billed days. `null` (the default) = from the delivery→pickup dates,
   * re-derived whenever they change; `N` = every new order starts at N days whatever the dates say.
   * Either way the field stays editable per order — this decides only where it STARTS.
   */
  orderBilledDays: number | null;
}

/** `GET` / `PUT /account/preferences` — the payload envelope. */
export interface AccountPreferencesEnvelopeModel {
  preferences: AccountPreferencesModel;
}
