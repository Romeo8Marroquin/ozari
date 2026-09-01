import { beforeAll, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

vi.mock("@/config/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/config/i18n.js", () => ({ i18next: { t: vi.fn((key: string) => key) } }));
vi.mock("@/services/prisma.service.js", () => ({ getPrismaClient: vi.fn() }));

const { refreshGoogleAccessToken, upsertGoogleEvent, deleteGoogleEvent } = vi.hoisted(
  () => ({
    refreshGoogleAccessToken: vi.fn(),
    upsertGoogleEvent: vi.fn(async () => undefined),
    deleteGoogleEvent: vi.fn(async () => undefined),
  }),
);
vi.mock("./google.service.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./google.service.js")>()),
  refreshGoogleAccessToken,
  upsertGoogleEvent,
  deleteGoogleEvent,
}));

import { getPrismaClient } from "@/services/prisma.service.js";
import { encryptKms } from "@helpers/encryption.js";
import { GoogleGrantRevokedError } from "./google.service.js";
import {
  activeCalendarConnections,
  ensureAccessToken,
  loadCalendarOrder,
  loadCalendarReminderMinutes,
  syncOrderCalendars,
} from "./calendar.sync.js";

beforeAll(() => {
  process.env["ENCRYPTION_KEY"] =
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
});

const orderRow = (over: Record<string, unknown> = {}) => ({
  id: 12,
  deliveryAt: new Date("2026-08-02T14:00:00.000Z"),
  pickupAt: new Date("2026-08-02T20:00:00.000Z"),
  deliveredAt: null,
  collectedAt: null,
  cancelledAt: null,
  updatedAt: null,
  createdAt: new Date("2026-08-01T07:00:00.000Z"),
  deliveryNameKms: encryptKms("María López"),
  deliveryAddressKms: encryptKms("Zona 10"),
  eventType: { name: "Evento familiar" },
  serviceDetails: [{ quantity: 10 }, { quantity: 15 }],
  ...over,
});

const connectionRow = (over: Record<string, unknown> = {}) => ({
  id: 1,
  userId: 2,
  provider: "GOOGLE",
  refreshTokenKms: encryptKms("refresh-token"),
  accessTokenKms: encryptKms("access-token"),
  accessTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
  calendarId: "primary",
  ...over,
});

/** The prisma surface these functions touch, wired so one `Promise.all` resolves deterministically. */
const mockPrisma = (over: Record<string, unknown> = {}) => {
  const client = {
    service: { findFirst: vi.fn(async () => orderRow()) },
    calendarConnection: {
      findMany: vi.fn(async () => [connectionRow()]),
      update: vi.fn(async () => undefined),
    },
    appPreference: {
      findMany: vi.fn(async () => []),
      findFirst: vi.fn(async () => null),
    },
    ...over,
  };
  (getPrismaClient as Mock).mockResolvedValue(client);
  return client;
};

beforeEach(() => {
  vi.clearAllMocks();
  upsertGoogleEvent.mockResolvedValue(undefined);
  deleteGoogleEvent.mockResolvedValue(undefined);
});

describe("loadCalendarOrder", () => {
  it("decrypts only what a calendar entry needs", async () => {
    const client = mockPrisma();
    const order = await loadCalendarOrder(client, 12);
    expect(order?.clientName).toBe("María López");
    expect(order?.address).toBe("Zona 10");
    // Item count is summed here rather than shipped per line — a calendar shows a total.
    expect(order?.itemCount).toBe(25);
  });

  it("answers null for an order that is gone, which is not an error here", async () => {
    const client = mockPrisma({ service: { findFirst: vi.fn(async () => null) } });
    await expect(loadCalendarOrder(client, 12)).resolves.toBeNull();
  });
});

describe("activeCalendarConnections", () => {
  it("decrypts the grant so nothing downstream touches the encryption helpers", async () => {
    const client = mockPrisma();
    const [connection] = await activeCalendarConnections(client);
    expect(connection?.refreshToken).toBe("refresh-token");
    expect(connection?.accessToken).toBe("access-token");
  });

  it("tolerates a connection that has never been used", async () => {
    const client = mockPrisma({
      calendarConnection: {
        findMany: vi.fn(async () => [
          connectionRow({ accessTokenKms: null, accessTokenExpiresAt: null }),
        ]),
        update: vi.fn(),
      },
    });
    const [connection] = await activeCalendarConnections(client);
    expect(connection?.accessToken).toBeUndefined();
    expect(connection?.accessTokenExpiresAt).toBeUndefined();
  });
});

describe("ensureAccessToken", () => {
  const connection = {
    id: 1,
    userId: 2,
    provider: "GOOGLE",
    refreshToken: "refresh-token",
    calendarId: "primary",
  };

  it("reuses a cached token — a refresh per order write would be a round trip for nothing", async () => {
    mockPrisma();
    const token = await ensureAccessToken({
      ...connection,
      accessToken: "cached",
      accessTokenExpiresAt: new Date(Date.now() + 60_000),
    });
    expect(token).toBe("cached");
    expect(refreshGoogleAccessToken).not.toHaveBeenCalled();
  });

  it("refreshes and PERSISTS when the cached token is stale", async () => {
    const client = mockPrisma();
    refreshGoogleAccessToken.mockResolvedValue({
      accessToken: "fresh",
      expiresAt: new Date(Date.now() + 3_540_000),
    });
    const token = await ensureAccessToken({
      ...connection,
      accessToken: "stale",
      accessTokenExpiresAt: new Date(Date.now() - 1000),
    });

    expect(token).toBe("fresh");
    const data = client.calendarConnection.update.mock.calls[0]?.[0]?.data;
    expect(data.accessTokenKms).toBeTruthy();
    // Google returns a refresh token only when it mints a NEW grant. Writing `undefined` over the
    // stored one would disconnect the calendar on its very first token refresh.
    expect(data).not.toHaveProperty("refreshTokenKms");
  });

  it("keeps a NEW refresh token when Google does send one", async () => {
    const client = mockPrisma();
    refreshGoogleAccessToken.mockResolvedValue({
      accessToken: "fresh",
      refreshToken: "rotated",
      expiresAt: new Date(Date.now() + 3_540_000),
    });
    await ensureAccessToken(connection);
    expect(client.calendarConnection.update.mock.calls[0]?.[0]?.data).toHaveProperty(
      "refreshTokenKms",
    );
  });

  it("DEACTIVATES the connection when the user revoked access", async () => {
    // Somebody removing our access in their Google account is a decision, not a fault. Retrying it
    // on every order for the rest of time would be the actual bug.
    const client = mockPrisma();
    refreshGoogleAccessToken.mockRejectedValue(new GoogleGrantRevokedError());
    await expect(ensureAccessToken(connection)).rejects.toBeInstanceOf(
      GoogleGrantRevokedError,
    );
    expect(client.calendarConnection.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { isActive: false },
    });
  });

  it("re-throws a transient failure without touching the connection", async () => {
    const client = mockPrisma();
    refreshGoogleAccessToken.mockRejectedValue(new Error("network"));
    await expect(ensureAccessToken(connection)).rejects.toThrow("network");
    expect(client.calendarConnection.update).not.toHaveBeenCalled();
  });
});

describe("loadCalendarReminderMinutes", () => {
  it("falls back when the preference is missing or corrupt", async () => {
    const client = mockPrisma();
    await expect(loadCalendarReminderMinutes(client)).resolves.toBe(1440);

    const bad = mockPrisma({
      appPreference: { findFirst: vi.fn(async () => ({ value: "mañana" })) },
    });
    await expect(loadCalendarReminderMinutes(bad)).resolves.toBe(1440);
  });

  it("clamps a hand-edited row to a value Google would actually accept", async () => {
    const client = mockPrisma({
      appPreference: { findFirst: vi.fn(async () => ({ value: "999999" })) },
    });
    await expect(loadCalendarReminderMinutes(client)).resolves.toBe(40320);
  });

  it("honours a configured value", async () => {
    const client = mockPrisma({
      appPreference: { findFirst: vi.fn(async () => ({ value: "120" })) },
    });
    await expect(loadCalendarReminderMinutes(client)).resolves.toBe(120);
  });
});

describe("syncOrderCalendars", () => {
  it("writes the wanted entries and removes the rest", async () => {
    mockPrisma();
    await syncOrderCalendars(12);
    expect(upsertGoogleEvent).toHaveBeenCalledTimes(2);
    // Both events are wanted, so nothing is deleted.
    expect(deleteGoogleEvent).not.toHaveBeenCalled();
  });

  it("DELETES the entry for a step that has been confirmed", async () => {
    // The declarative half: what the order no longer needs is removed, with no bookkeeping table —
    // the possible ids are derived from the order id.
    mockPrisma({
      service: {
        findFirst: vi.fn(async () =>
          orderRow({ deliveredAt: new Date("2026-08-02T14:05:00.000Z") }),
        ),
      },
    });
    await syncOrderCalendars(12);
    expect(upsertGoogleEvent).toHaveBeenCalledTimes(1);
    expect(deleteGoogleEvent).toHaveBeenCalledWith("access-token", "primary", "orden12d");
  });

  it("clears BOTH entries for an order that no longer exists", async () => {
    // A permanent delete needs no path of its own: the order is missing, so nothing is wanted.
    mockPrisma({ service: { findFirst: vi.fn(async () => null) } });
    await syncOrderCalendars(12);
    expect(upsertGoogleEvent).not.toHaveBeenCalled();
    expect(deleteGoogleEvent).toHaveBeenCalledTimes(2);
  });

  it("does no work at all when nobody has connected a calendar", async () => {
    const client = mockPrisma({
      calendarConnection: { findMany: vi.fn(async () => []), update: vi.fn() },
    });
    await syncOrderCalendars(12);
    expect(client.appPreference.findMany).not.toHaveBeenCalled();
    expect(upsertGoogleEvent).not.toHaveBeenCalled();
  });

  it("keeps one admin's failure from stopping another's calendar", async () => {
    mockPrisma({
      calendarConnection: {
        findMany: vi.fn(async () => [connectionRow(), connectionRow({ id: 2, userId: 3 })]),
        update: vi.fn(),
      },
    });
    upsertGoogleEvent.mockRejectedValueOnce(new Error("google is down"));
    await syncOrderCalendars(12);
    // The second connection still received its two events.
    expect(upsertGoogleEvent).toHaveBeenCalledTimes(3);
  });

  it("NEVER throws — an order is not lost because a calendar could not be reached", async () => {
    (getPrismaClient as Mock).mockRejectedValue(new Error("db down"));
    await expect(syncOrderCalendars(12)).resolves.toBeUndefined();
  });
});
