import type { LogisticsEventKindModel } from "../orders/logistics/logistics.models.js";

/**
 * ONE calendar entry, provider-agnostic — the shape both halves of this module render from.
 *
 * It is deliberately not "an order": an order produces up to two entries (its delivery and its
 * collection), each of which is a separate thing in somebody's day. Everything the calendar shows
 * is decided ONCE, here, so a Google event and the same job in the ICS feed can never disagree.
 */
export interface CalendarEntryModel {
  /** Stable identity for this entry, derived from the order + which event it is. It is the Google
   *  event id AND the ICS `UID`, so re-syncing updates rather than duplicating. */
  id: string;
  orderId: number;
  kind: LogisticsEventKindModel;
  /** The BLOCK, not the instant: the same window the driver-availability pad reserves. */
  start: Date;
  end: Date;
  /** The moment the job actually happens — what the summary states and the reminder counts to. */
  at: Date;
  /** One short line: "Entrega · María López". */
  summary: string;
  /** Where to go, plus what the job is. Empty lines are dropped, never printed blank. */
  description: string;
  /** The delivery address text, if the order carries one — a calendar's own location field, which
   *  is what makes the entry tappable-to-navigate in Apple Calendar and Google Calendar alike. */
  location?: string;
  /** How many minutes BEFORE `start` to remind, already clamped so it can never sit in the past.
   *  `undefined` ⇒ the event has already begun and no reminder is possible. */
  reminderMinutes?: number;
  /** Bumped whenever the order changes, so a subscribed calendar knows to replace its copy. */
  sequence: number;
}

/** The order fields a calendar entry is built from — a narrow read, so the sync never depends on
 *  the full order projection (which decrypts more than a calendar has any business seeing). */
export interface CalendarOrderModel {
  id: number;
  deliveryAt: Date;
  pickupAt: Date | null;
  deliveredAt: Date | null;
  collectedAt: Date | null;
  cancelledAt: Date | null;
  updatedAt: Date | null;
  createdAt: Date;
  /** Decrypted, because a calendar entry with no name on it is useless. */
  clientName: string;
  address: string;
  eventTypeName: string;
  itemCount: number;
}

/** A connection as the sync needs it — decrypted secrets included, so nothing downstream touches
 *  the encryption helpers. */
export interface CalendarConnectionModel {
  id: number;
  userId: number;
  provider: string;
  refreshToken: string;
  accessToken?: string | undefined;
  accessTokenExpiresAt?: Date | undefined;
  calendarId: string;
}

/** What `GET /calendar` tells the settings screen. Never a token, never a refresh token — the feed
 *  URL is the one secret it hands back, because the admin has to be able to copy it. */
export interface CalendarStatusResponseModel {
  google: {
    connected: boolean;
    /** Which Google account, so an admin can tell they connected the right one. */
    accountEmail?: string;
    /** Paused rather than disconnected. */
    isActive: boolean;
  };
  feed: {
    /** Absent until the admin creates one — a feed nobody subscribed to is not worth minting. */
    url?: string;
    isActive: boolean;
  };
  /** The shared lead time (the `calendar.reminderMinutes` preference), so the screen can state the
   *  rule both halves obey instead of implying each has its own. */
  reminderMinutes: number;
  /** Whether the deployment has Google credentials at all. `false` ⇒ the UI offers the feed only,
   *  and says why, rather than showing a Connect button that can only fail. */
  googleAvailable: boolean;
}

export interface CalendarStatusEnvelopeModel {
  calendar: CalendarStatusResponseModel;
}

export interface CalendarAuthorizeEnvelopeModel {
  /** Where to send the browser for consent. Returned rather than redirected, so the caller keeps
   *  its session and can open it however it likes. */
  authorizeUrl: string;
}
