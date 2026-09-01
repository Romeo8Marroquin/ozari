/** What `GET /calendar` returns. Never a token — except the FEED url, which is a secret returned on
 *  purpose so an admin can copy it onto another device. */
export interface CalendarStatus {
  google: {
    connected: boolean;
    isActive: boolean;
    /** Which Google account, so an admin can tell they linked the right one. */
    accountEmail?: string;
  };
  feed: {
    isActive: boolean;
    /** Absent until one has been minted — a feed nobody subscribed to is not worth creating. */
    url?: string;
  };
  /** The shared lead time (`calendar.reminderMinutes`), so this screen can STATE the rule both
   *  halves obey instead of implying each has its own. */
  reminderMinutes: number;
  /** Whether the deployment has Google credentials at all. `false` ⇒ offer the feed only, and say
   *  why, rather than showing a Connect button that could not work. */
  googleAvailable: boolean;
}

export interface CalendarStatusEnvelope {
  calendar: CalendarStatus;
}
