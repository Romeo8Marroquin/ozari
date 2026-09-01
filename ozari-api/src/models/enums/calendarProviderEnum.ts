/**
 * The external calendars we can WRITE into.
 *
 * There is exactly one, and that is not an oversight: **Apple publishes no calendar write API**.
 * There is no OAuth scope, no REST endpoint and no "Sign in with Apple" grant that reaches iCloud
 * Calendar — EventKit is native-only, and iCloud CalDAV needs the user's Apple ID plus an
 * app-specific password, which is a credential we must never hold. Apple Calendar (and Outlook, and
 * anything else) is served by the ICS SUBSCRIPTION feed instead, which is a different mechanism
 * entirely and therefore not a provider here.
 *
 * Stored as a string column rather than a DB enum, so adding Microsoft Graph later is a row value
 * and a service module — never a migration.
 */
export const CalendarProviderEnum = {
  GOOGLE: "GOOGLE",
} as const;

export type CalendarProvider =
  (typeof CalendarProviderEnum)[keyof typeof CalendarProviderEnum];
