import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GoogleGrantRevokedError,
  buildGoogleAuthUrl,
  deleteGoogleEvent,
  exchangeGoogleCode,
  fetchGoogleAccountEmail,
  googleCredentials,
  googleEventBody,
  googleRedirectUri,
  isGoogleConfigured,
  refreshGoogleAccessToken,
  revokeGoogleGrant,
  upsertGoogleEvent,
} from "./google.service.js";
import type { CalendarEntryModel } from "./calendar.models.js";

const BASE = "https://api.example.com";

const entry = (over: Partial<CalendarEntryModel> = {}): CalendarEntryModel => ({
  id: "orden12d",
  orderId: 12,
  kind: "DELIVERY",
  start: new Date("2026-08-02T13:30:00.000Z"),
  end: new Date("2026-08-02T14:30:00.000Z"),
  at: new Date("2026-08-02T14:00:00.000Z"),
  summary: "Entrega · María López",
  description: "Pedido #12",
  location: "Zona 10",
  reminderMinutes: 1440,
  sequence: 0,
  ...over,
});

/** A `fetch` stub returning one canned response per call, in order. */
const stubFetch = (
  ...responses: { ok?: boolean; status?: number; body?: unknown }[]
): ReturnType<typeof vi.fn> => {
  const mock = vi.fn();
  for (const response of responses) {
    mock.mockResolvedValueOnce({
      ok: response.ok ?? true,
      status: response.status ?? 200,
      json: async () => response.body ?? {},
    });
  }
  vi.stubGlobal("fetch", mock);
  return mock;
};

beforeEach(() => {
  vi.stubEnv("GOOGLE_CLIENT_ID", "client-id");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "client-secret");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("googleCredentials", () => {
  it("reads the environment on EVERY call, never at module load", () => {
    expect(isGoogleConfigured()).toBe(true);
    vi.stubEnv("GOOGLE_CLIENT_ID", "");
    // A cached constant would have this still reporting configured — the same rule
    // `environment.ts` follows.
    expect(isGoogleConfigured()).toBe(false);
    expect(googleCredentials()).toBeNull();
  });

  it("refuses to build anything without them, rather than signing a half-formed request", async () => {
    // The routes are guarded by `isGoogleConfigured` and answer a clean 503, so this is a
    // deployment that lost its credentials mid-flight — real, but never a normal path.
    vi.unstubAllEnvs();
    expect(() => buildGoogleAuthUrl("state", BASE)).toThrow(/not configured/u);
    await expect(exchangeGoogleCode("code", BASE)).rejects.toThrow(/not configured/u);
  });
});

describe("buildGoogleAuthUrl", () => {
  it("asks for OFFLINE access and forces consent — without both the grant dies in an hour", () => {
    // `access_type=offline` is what returns a REFRESH token at all; `prompt=consent` is the only way
    // to be given one again when reconnecting an account that already granted access.
    const url = new URL(buildGoogleAuthUrl("state-token", BASE));
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("state")).toBe("state-token");
    expect(url.searchParams.get("redirect_uri")).toBe(googleRedirectUri(BASE));
    // The narrowest scopes that do the job — never `auth/calendar`, which also grants creating and
    // deleting whole calendars.
    expect(url.searchParams.get("scope")).toContain("calendar.events");
    expect(url.searchParams.get("scope")).not.toContain("auth/calendar ");
  });

  it("builds the redirect from the caller's own origin, so consent and exchange agree", () => {
    expect(googleRedirectUri(BASE)).toBe(`${BASE}/api/calendar/google/callback`);
  });
});

describe("exchangeGoogleCode", () => {
  it("returns the grant with an expiry that already carries the skew", async () => {
    stubFetch({
      body: { access_token: "at", refresh_token: "rt", expires_in: 3600 },
    });
    const before = Date.now();
    const tokens = await exchangeGoogleCode("code", BASE);
    expect(tokens.accessToken).toBe("at");
    expect(tokens.refreshToken).toBe("rt");
    // A minute of slack, so a token never dies mid-request on the boundary.
    expect(tokens.expiresAt.getTime()).toBeLessThanOrEqual(before + 3540 * 1000 + 50);
    expect(tokens.expiresAt.getTime()).toBeGreaterThan(before + 3500 * 1000);
  });

  it("raises a DISTINCT error when the grant itself is dead", async () => {
    // `invalid_grant` means "stop trying" — the user revoked access. Separating it here rather than
    // at the call site is what lets the sync deactivate the connection instead of logging forever.
    stubFetch({ ok: false, status: 400, body: { error: "invalid_grant" } });
    await expect(refreshGoogleAccessToken("rt")).rejects.toBeInstanceOf(
      GoogleGrantRevokedError,
    );
  });

  it("raises an ordinary error for anything else", async () => {
    stubFetch({ ok: false, status: 500, body: { error: "server_error" } });
    await expect(exchangeGoogleCode("code", BASE)).rejects.toThrow(/server_error/u);
  });

  it("treats a 200 with no access token as a failure", async () => {
    stubFetch({ body: {} });
    await expect(exchangeGoogleCode("code", BASE)).rejects.toThrow(/failed/u);
  });

  it("defaults the lifetime when Google omits it", async () => {
    stubFetch({ body: { access_token: "at" } });
    const tokens = await refreshGoogleAccessToken("rt");
    // No refresh token on an ordinary refresh — the stored grant stays valid.
    expect(tokens.refreshToken).toBeUndefined();
    expect(tokens.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });
});

describe("fetchGoogleAccountEmail", () => {
  it("names the connected account", async () => {
    stubFetch({ body: { email: "admin@partyrentalsgt.com" } });
    await expect(fetchGoogleAccountEmail("at")).resolves.toBe("admin@partyrentalsgt.com");
  });

  it("is not fatal when it fails — a connection works without a label", async () => {
    stubFetch({ ok: false, status: 403 });
    await expect(fetchGoogleAccountEmail("at")).resolves.toBeUndefined();
  });
});

describe("googleEventBody", () => {
  it("turns OFF the calendar's default reminders, or the override is ignored", () => {
    // With `useDefault: true` Google discards the overrides entirely and uses whatever the
    // calendar's own default happens to be — the reminder would silently not be ours.
    const body = googleEventBody(entry()) as Record<string, { useDefault: boolean; overrides: unknown[] }>;
    expect(body["reminders"]?.useDefault).toBe(false);
    expect(body["reminders"]?.overrides).toEqual([{ method: "popup", minutes: 1440 }]);
  });

  it("sends an EMPTY override list when there is no reminder to give", () => {
    // Not "no reminders key": that would fall back to the calendar's default, which is exactly what
    // `useDefault: false` exists to prevent.
    const body = googleEventBody(entry({ reminderMinutes: undefined })) as Record<
      string,
      { useDefault: boolean; overrides: unknown[] }
    >;
    expect(body["reminders"]).toEqual({ useDefault: false, overrides: [] });
  });

  it("carries the id, so the event can be addressed again without a lookup table", () => {
    expect(googleEventBody(entry())["id"]).toBe("orden12d");
  });

  it("omits the location when the order has no address", () => {
    expect(googleEventBody(entry({ location: undefined }))["location"]).toBeUndefined();
  });
});

describe("upsertGoogleEvent", () => {
  it("UPDATES first — the common path is a re-sync, not a creation", () => {
    const fetchMock = stubFetch({ ok: true });
    return upsertGoogleEvent("at", "primary", entry()).then(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0]?.[0]).toContain("/events/orden12d");
      expect((fetchMock.mock.calls[0]?.[1] as RequestInit).method).toBe("PUT");
    });
  });

  it("falls back to INSERT when the event is not there (or was deleted)", async () => {
    // 410 Gone is what Google answers for an event somebody deleted by hand; re-creating it is
    // exactly right while the order still has to happen.
    for (const status of [404, 410]) {
      const fetchMock = stubFetch({ ok: false, status }, { ok: true });
      await upsertGoogleEvent("at", "primary", entry());
      expect((fetchMock.mock.calls[1]?.[1] as RequestInit).method).toBe("POST");
      vi.unstubAllGlobals();
    }
  });

  it("accepts a 409 on insert — a concurrent sync already created exactly this event", async () => {
    stubFetch({ ok: false, status: 404 }, { ok: false, status: 409 });
    await expect(upsertGoogleEvent("at", "primary", entry())).resolves.toBeUndefined();
  });

  it("reports a real failure on either leg", async () => {
    stubFetch({ ok: false, status: 500 });
    await expect(upsertGoogleEvent("at", "primary", entry())).rejects.toThrow(/update failed/u);

    stubFetch({ ok: false, status: 404 }, { ok: false, status: 500 });
    await expect(upsertGoogleEvent("at", "primary", entry())).rejects.toThrow(/insert failed/u);
  });
});

describe("deleteGoogleEvent", () => {
  it("treats ALREADY GONE as success — the desired end state is 'not in the calendar'", async () => {
    for (const status of [404, 410]) {
      stubFetch({ ok: false, status });
      await expect(deleteGoogleEvent("at", "primary", "orden12d")).resolves.toBeUndefined();
      vi.unstubAllGlobals();
    }
  });

  it("deletes, and reports anything else", async () => {
    const fetchMock = stubFetch({ ok: true });
    await deleteGoogleEvent("at", "primary", "orden12d");
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).method).toBe("DELETE");

    vi.unstubAllGlobals();
    stubFetch({ ok: false, status: 500 });
    await expect(deleteGoogleEvent("at", "primary", "orden12d")).rejects.toThrow(
      /delete failed/u,
    );
  });
});

describe("revokeGoogleGrant", () => {
  it("tells Google the grant is finished", async () => {
    const fetchMock = stubFetch({ ok: true });
    await revokeGoogleGrant("rt");
    expect(fetchMock.mock.calls[0]?.[0]).toContain("revoke");
  });
});
