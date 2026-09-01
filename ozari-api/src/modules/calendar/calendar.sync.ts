import type { Prisma } from "@prisma/client";
import { appConfig } from "@/config/app.js";
import { i18next } from "@/config/i18n.js";
import { logger } from "@/config/logger.js";
import { getPrismaClient } from "@/services/prisma.service.js";
import { decryptKms, encryptKms } from "@helpers/encryption.js";
import { CalendarProviderEnum } from "@models/enums/calendarProviderEnum.js";
import { loadOrderTimingPreferences } from "../orders/orders.service.js";
import { calendarEntriesFor, calendarEntryId } from "./calendar.service.js";
import {
  GoogleGrantRevokedError,
  deleteGoogleEvent,
  refreshGoogleAccessToken,
  upsertGoogleEvent,
} from "./google.service.js";
import type {
  CalendarConnectionModel,
  CalendarEntryModel,
  CalendarOrderModel,
} from "./calendar.models.js";

/**
 * THE SYNC — the only thing in this module that knows an order and a calendar exist at the same time.
 *
 * **Every entry point here is best-effort and never throws.** A calendar is a convenience laid over
 * the business, not part of it: Google being slow, a revoked grant or an expired token must never be
 * the reason an order fails to save. Same stance as the welcome email — awaited (Cloud Run only
 * gives us CPU during the request, so a fire-and-forget would be killed), caught, logged, and never
 * surfaced to the caller.
 *
 * It also runs strictly AFTER the order's transaction has committed. Holding a database transaction
 * open across a call to a third party is how a slow external service becomes a lock-contention
 * outage.
 */

/** Every possible entry id for an order — used to work out what must be REMOVED. Because ids are
 *  deterministic there are only ever two, so "delete what is no longer wanted" needs no bookkeeping
 *  table: it is this set minus the set we just wrote. */
const allEntryIds = (orderId: number): string[] => [
  calendarEntryId(orderId, "DELIVERY"),
  calendarEntryId(orderId, "COLLECTION"),
];

/** The narrow read a calendar entry is built from — deliberately not the order projection, which
 *  decrypts contact details and money a calendar has no business carrying. */
const calendarOrderSelect = {
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
} satisfies Prisma.ServiceSelect;

/** Loads and decrypts one order into the calendar's own shape. `null` when the order is gone — which
 *  is not an error here: a deleted order simply has nothing left to put in a calendar. */
export async function loadCalendarOrder(
  client: Pick<Prisma.TransactionClient, "service">,
  orderId: number,
): Promise<CalendarOrderModel | null> {
  const row = await client.service.findFirst({
    where: { id: orderId, isActive: true },
    select: calendarOrderSelect,
  });
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    deliveryAt: row.deliveryAt,
    pickupAt: row.pickupAt,
    deliveredAt: row.deliveredAt,
    collectedAt: row.collectedAt,
    cancelledAt: row.cancelledAt,
    updatedAt: row.updatedAt,
    createdAt: row.createdAt,
    clientName: decryptKms(row.deliveryNameKms),
    address: decryptKms(row.deliveryAddressKms),
    eventTypeName: row.eventType.name,
    itemCount: row.serviceDetails.reduce((total, line) => total + line.quantity, 0),
  };
}

/**
 * Every connection an order should be written to.
 *
 * Today: all ACTIVE connections, which is exactly the set of admins — connecting is an Admin-only
 * route, so the guard already scopes it. **When a Driver may connect their own calendar, this is the
 * one function that changes**: it becomes "every admin, plus the order's assignee", and nothing else
 * in the module has to know.
 */
export async function activeCalendarConnections(
  client: Pick<Prisma.TransactionClient, "calendarConnection">,
): Promise<CalendarConnectionModel[]> {
  const rows = await client.calendarConnection.findMany({
    where: { isActive: true, provider: CalendarProviderEnum.GOOGLE },
  });
  return rows.map((row) => ({
    id: row.id,
    userId: row.userId,
    provider: row.provider,
    refreshToken: decryptKms(row.refreshTokenKms),
    ...(row.accessTokenKms ? { accessToken: decryptKms(row.accessTokenKms) } : {}),
    ...(row.accessTokenExpiresAt ? { accessTokenExpiresAt: row.accessTokenExpiresAt } : {}),
    calendarId: row.calendarId,
  }));
}

/**
 * A usable access token for one connection, refreshing and PERSISTING when the cached one is stale.
 *
 * The cache matters: without it every order write would spend a round trip minting a token that is
 * valid for another 55 minutes. The stored expiry already carries the skew (see `google.service`),
 * so this is a plain comparison rather than a second place that has to remember the slack.
 *
 * A revoked grant deactivates the connection rather than being retried forever. Somebody removing
 * our access in their Google account is a decision, not a fault, and an integration that answered it
 * by logging an error on every order for the rest of time would be the actual bug.
 */
export async function ensureAccessToken(
  connection: CalendarConnectionModel,
  now: Date = new Date(),
): Promise<string> {
  if (
    connection.accessToken &&
    connection.accessTokenExpiresAt &&
    connection.accessTokenExpiresAt.getTime() > now.getTime()
  ) {
    return connection.accessToken;
  }
  const prismaClient = await getPrismaClient();
  try {
    const tokens = await refreshGoogleAccessToken(connection.refreshToken);
    await prismaClient.calendarConnection.update({
      where: { id: connection.id },
      data: {
        accessTokenKms: encryptKms(tokens.accessToken),
        accessTokenExpiresAt: tokens.expiresAt,
        // Google returns a refresh token only when it mints a NEW grant; on an ordinary refresh the
        // field is absent and the stored one is still the valid grant. Writing `undefined` over it
        // would disconnect the calendar on the first token refresh.
        ...(tokens.refreshToken ? { refreshTokenKms: encryptKms(tokens.refreshToken) } : {}),
      },
    });
    return tokens.accessToken;
  } catch (error) {
    if (error instanceof GoogleGrantRevokedError) {
      await prismaClient.calendarConnection.update({
        where: { id: connection.id },
        data: { isActive: false },
      });
      logger.warn(
        i18next.t("calendar.logs.grantRevoked", { userId: connection.userId }),
      );
    }
    throw error;
  }
}

/** Write the wanted entries and remove the rest, for ONE connection. Split out so a failure against
 *  one admin's calendar cannot stop another's from being updated. */
async function applyToConnection(
  connection: CalendarConnectionModel,
  entries: readonly CalendarEntryModel[],
  orderId: number,
): Promise<void> {
  const accessToken = await ensureAccessToken(connection);
  const wanted = new Set(entries.map((entry) => entry.id));
  for (const entry of entries) {
    await upsertGoogleEvent(accessToken, connection.calendarId, entry);
  }
  // Whatever this order could have had and no longer wants: a confirmed delivery, a collection
  // dropped by an edit, a cancelled order (which wants nothing at all). Deleting an event that was
  // never created is a no-op by design — see `deleteGoogleEvent`.
  for (const id of allEntryIds(orderId).filter((id) => !wanted.has(id))) {
    await deleteGoogleEvent(accessToken, connection.calendarId, id);
  }
}

/**
 * Bring every connected calendar in line with one order — **the single hook the order flows call.**
 *
 * It is DECLARATIVE, exactly like the order update it follows: it computes the entries the order
 * should have right now and makes the calendar match, rather than trying to work out what changed.
 * That is what makes it safe to call from create, edit, every lifecycle move and the payment door
 * alike — and what makes a missed call self-healing, since the next one puts everything right.
 */
export async function syncOrderCalendars(orderId: number): Promise<void> {
  try {
    const prismaClient = await getPrismaClient();
    const [order, connections] = await Promise.all([
      loadCalendarOrder(prismaClient, orderId),
      activeCalendarConnections(prismaClient),
    ]);
    if (connections.length === 0) {
      return;
    }
    const { spacingMinutes } = await loadOrderTimingPreferences(prismaClient);
    const reminderMinutes = await loadCalendarReminderMinutes(prismaClient);
    // A missing order still runs: its entries are empty, so the loop below deletes whatever the
    // calendars still hold for it. That is precisely what a permanent delete needs.
    const entries = order
      ? calendarEntriesFor(order, { gapMinutes: spacingMinutes, reminderMinutes, now: new Date() })
      : [];
    for (const connection of connections) {
      try {
        await applyToConnection(connection, entries, orderId);
      } catch (error) {
        logger.error(i18next.t("calendar.logs.syncFailed", { id: orderId }), { error });
      }
    }
  } catch (error) {
    // The outer catch is the promise this function makes to its callers: an order is never lost
    // because a calendar could not be reached.
    logger.error(i18next.t("calendar.logs.syncFailed", { id: orderId }), { error });
  }
}

/** The shared lead time. Clamped on read like every other preference, so a hand-edited row resolves
 *  to its nearest legal value instead of producing an event Google would reject. */
export async function loadCalendarReminderMinutes(
  client: Pick<Prisma.TransactionClient, "appPreference">,
): Promise<number> {
  const row = await client.appPreference.findFirst({
    where: { key: "calendar.reminderMinutes" },
    select: { value: true },
  });
  const parsed = Number(row?.value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return appConfig.calendar.defaultReminderMinutes;
  }
  return Math.min(parsed, appConfig.calendar.google.maxReminderMinutes);
}
