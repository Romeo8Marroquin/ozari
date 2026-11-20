import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { Response } from "express";
import { getPrismaClient } from "@/services/prisma.service.js";
import { sendOzariError } from "@models/http/ozariErrorModel.js";
import { sendOzariSuccess } from "@models/http/ozariSuccessModel.js";
import { HttpEnum } from "@models/enums/httpEnum.js";
import type { CustomRequest } from "@models/common/customRequestModel.js";
import { getAccountPreferences, updateAccountPreferences } from "./account.controller.js";
import type { AccountPreferencesEnvelopeModel } from "./account.models.js";

vi.mock("@/config/logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/config/i18n.js", () => ({ i18next: { t: vi.fn((key: string) => key) } }));
vi.mock("@/services/prisma.service.js", () => ({ getPrismaClient: vi.fn() }));
vi.mock("@models/http/ozariSuccessModel.js", () => ({ sendOzariSuccess: vi.fn() }));
vi.mock("@models/http/ozariErrorModel.js", () => ({ sendOzariError: vi.fn() }));

const findUnique = vi.fn();
const upsert = vi.fn();

const request = (body?: unknown): CustomRequest =>
  ({ user: { userId: 7, userRole: 1 }, body }) as unknown as CustomRequest;

const answered = (): AccountPreferencesEnvelopeModel =>
  (sendOzariSuccess as Mock).mock.calls[0]?.[3] as AccountPreferencesEnvelopeModel;

beforeEach(() => {
  vi.clearAllMocks();
  (getPrismaClient as Mock).mockResolvedValue({ userPreference: { findUnique, upsert } });
});

describe("getAccountPreferences", () => {
  it("answers the defaults for an account that never saved any (no row)", async () => {
    findUnique.mockResolvedValue(null);
    await getAccountPreferences(request(), {} as Response);
    expect(findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 7 } }));
    expect(answered()).toEqual({ preferences: { orderBilledDays: null } });
    expect(sendOzariSuccess).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.OK,
      expect.any(String),
      expect.anything(),
    );
  });

  it("answers the CALLER's stored value", async () => {
    findUnique.mockResolvedValue({ orderBilledDays: 1 });
    await getAccountPreferences(request(), {} as Response);
    expect(answered()).toEqual({ preferences: { orderBilledDays: 1 } });
  });

  it("responds 500 when the read fails", async () => {
    findUnique.mockRejectedValue(new Error("db down"));
    await getAccountPreferences(request(), {} as Response);
    expect(sendOzariError).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.INTERNAL_SERVER_ERROR,
      expect.any(String),
    );
  });
});

describe("updateAccountPreferences", () => {
  it("upserts the caller's row and answers what was stored", async () => {
    upsert.mockResolvedValue({ orderBilledDays: 2 });
    await updateAccountPreferences(request({ orderBilledDays: 2 }), {} as Response);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 7 },
        update: { orderBilledDays: 2 },
        create: { userId: 7, orderBilledDays: 2 },
      }),
    );
    expect(answered()).toEqual({ preferences: { orderBilledDays: 2 } });
  });

  it("stores null to return to the automatic default", async () => {
    upsert.mockResolvedValue({ orderBilledDays: null });
    await updateAccountPreferences(request({ orderBilledDays: null }), {} as Response);
    expect(answered()).toEqual({ preferences: { orderBilledDays: null } });
  });

  it("responds 500 when the write fails", async () => {
    upsert.mockRejectedValue(new Error("db down"));
    await updateAccountPreferences(request({ orderBilledDays: 3 }), {} as Response);
    expect(sendOzariError).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.INTERNAL_SERVER_ERROR,
      expect.any(String),
    );
  });
});
