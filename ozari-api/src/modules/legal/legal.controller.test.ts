import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { Request, Response } from "express";
import { getPrismaClient } from "@/services/prisma.service.js";
import { sendOzariError } from "@models/http/ozariErrorModel.js";
import { sendOzariSuccess } from "@models/http/ozariSuccessModel.js";
import { HttpEnum } from "@models/enums/httpEnum.js";
import { getTerms } from "./legal.controller.js";
import type { TermsResponseModel } from "./legal.models.js";

vi.mock("@/config/logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/config/i18n.js", () => ({ i18next: { t: vi.fn((key: string) => key) } }));
vi.mock("@/services/prisma.service.js", () => ({ getPrismaClient: vi.fn() }));
vi.mock("@models/http/ozariSuccessModel.js", () => ({ sendOzariSuccess: vi.fn() }));
vi.mock("@models/http/ozariErrorModel.js", () => ({ sendOzariError: vi.fn() }));

const mockPrisma = (rows: Array<{ key: string; value: string }>) => {
  (getPrismaClient as Mock).mockResolvedValue({
    appPreference: { findMany: vi.fn().mockResolvedValue(rows) },
  });
};

const answered = (): TermsResponseModel =>
  (sendOzariSuccess as Mock).mock.calls[0]?.[3] as TermsResponseModel;

beforeEach(() => vi.clearAllMocks());

describe("getTerms", () => {
  it("publishes the terms the admin wrote, newlines and all", async () => {
    mockPrisma([{ key: "documents.terms", value: "Primera línea.\nSegunda línea." }]);
    await getTerms({} as Request, {} as Response);

    expect(answered()).toEqual({ terms: "Primera línea.\nSegunda línea." });
    expect(sendOzariSuccess).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.OK,
      expect.any(String),
      expect.anything(),
    );
  });

  it("answers EMPTY rather than 404 when no terms are published", async () => {
    // A business that has written none is a valid configuration; a client should then offer nothing
    // to read, not report an error about a document that was never meant to exist.
    mockPrisma([]);
    await getTerms({} as Request, {} as Response);
    expect(answered()).toEqual({ terms: "" });
  });

  it("publishes ONLY the terms — never the rest of the settings registry", async () => {
    // The entire reason this endpoint exists instead of widening Admin-only `/preferences`: an
    // anonymous visitor may read one paragraph, not the operational rules behind it.
    mockPrisma([
      { key: "documents.terms", value: "Condiciones" },
      { key: "orders.logisticsSpacingMinutes", value: "90" },
      { key: "documents.businessPhone", value: "1234-5678" },
    ]);
    await getTerms({} as Request, {} as Response);
    expect(Object.keys(answered())).toEqual(["terms"]);
  });

  it("responds 500 when the read fails", async () => {
    (getPrismaClient as Mock).mockRejectedValue(new Error("db down"));
    await getTerms({} as Request, {} as Response);
    expect(sendOzariError).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.INTERNAL_SERVER_ERROR,
      expect.any(String),
    );
  });
});
