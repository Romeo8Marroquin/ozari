import { describe, expect, it, vi, beforeEach, type Mock } from "vitest";
import type { NextFunction, Request, Response } from "express";
import { HttpEnum } from "@models/enums/httpEnum.js";
import { sendOzariError } from "@models/http/ozariErrorModel.js";
import {
  CANCEL_REASON_MAX_LENGTH,
  EVIDENCE_KEYS_MAX,
  EVIDENCE_STEPS_MAX,
  validateAdvanceOrder,
  validateOrderEvidenceUploads,
} from "./advance.validator.js";

vi.mock("@/config/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/config/i18n.js", () => ({ i18next: { t: vi.fn((key: string) => key) } }));
vi.mock("@models/http/ozariErrorModel.js", () => ({ sendOzariError: vi.fn() }));

const KEY = (suffix = "a1b2c3d4-e5f6-4789-a0b1-c2d3e4f5a6b7.jpg") =>
  `orders/evidence/${suffix}`;

const run = (body: unknown) => {
  const req = { body } as Request;
  const next = vi.fn() as unknown as NextFunction;
  validateAdvanceOrder(req, {} as Response, next);
  return { req, next: next as unknown as Mock };
};

const rejectedWith = (key: string) =>
  expect(sendOzariError).toHaveBeenCalledWith(
    expect.anything(),
    HttpEnum.BAD_REQUEST,
    `orders.advance.validators.${key}`,
  );

beforeEach(() => vi.clearAllMocks());

describe("validateAdvanceOrder", () => {
  it("passes a bare advance (just the target status)", () => {
    const { req, next } = run({ toStatusId: 5 });
    expect(next).toHaveBeenCalled();
    expect(req.body).toEqual({ toStatusId: 5, evidence: [], reason: undefined });
  });

  it("rejects a missing or malformed target status", () => {
    for (const toStatusId of [undefined, 0, -3, 1.5, "abc"]) {
      vi.clearAllMocks();
      const { next } = run({ toStatusId });
      expect(next).not.toHaveBeenCalled();
      rejectedWith("invalidToStatusId");
    }
  });

  it("treats a body-less request as an empty body (not a crash)", () => {
    const { next } = run(undefined);
    expect(next).not.toHaveBeenCalled();
    rejectedWith("invalidToStatusId");
  });

  it("accepts per-STEP evidence minted by OUR presign, and de-duplicates each step's keys", () => {
    // A multi-step jump carries one entry per step it must document.
    const { req, next } = run({
      toStatusId: 4,
      evidence: [
        { statusId: 3, keys: [KEY(), KEY()] },
        { statusId: 4, keys: [KEY("11111111-2222-4333-8444-555555555555.webp")] },
      ],
    });
    expect(next).toHaveBeenCalled();
    expect(req.body).toMatchObject({
      evidence: [
        { statusId: 3, keys: [KEY()] },
        { statusId: 4, keys: [KEY("11111111-2222-4333-8444-555555555555.webp")] },
      ],
    });
  });

  it("refuses a key that points outside the orders' evidence namespace", () => {
    // A client-invented key must never be able to attach someone else's object (or a product's).
    for (const keys of [
      ["products/a1b2c3d4-e5f6-4789-a0b1-c2d3e4f5a6b7.jpg"],
      ["orders/evidence/../products/x.jpg"],
      ["orders/evidence/not-a-uuid.jpg"],
      [42],
      "not-an-array",
      Array.from({ length: EVIDENCE_KEYS_MAX + 1 }, () => KEY()),
    ]) {
      vi.clearAllMocks();
      const { next } = run({ toStatusId: 3, evidence: [{ statusId: 3, keys }] });
      expect(next).not.toHaveBeenCalled();
      rejectedWith("invalidEvidenceKeys");
    }
  });

  it("refuses a malformed evidence list (bad step id, wrong shape, too many steps)", () => {
    for (const evidence of [
      "nope",
      [{ keys: [KEY()] }],
      [{ statusId: 0, keys: [KEY()] }],
      [{ statusId: 3 }],
      Array.from({ length: EVIDENCE_STEPS_MAX + 1 }, () => ({ statusId: 3, keys: [] })),
    ]) {
      vi.clearAllMocks();
      const { next } = run({ toStatusId: 3, evidence });
      expect(next).not.toHaveBeenCalled();
      rejectedWith("invalidEvidenceKeys");
    }
  });

  it("treats an absent/null evidence list as no photos", () => {
    for (const evidence of [undefined, null]) {
      const { req } = run({ toStatusId: 3, evidence });
      expect((req.body as { evidence: unknown[] }).evidence).toEqual([]);
    }
  });

  it("trims a cancel reason and treats blank ones as absent", () => {
    const { req } = run({ toStatusId: 2, reason: "  El cliente canceló  " });
    expect((req.body as { reason?: string }).reason).toBe("El cliente canceló");
    for (const reason of [undefined, null, ""]) {
      const bare = run({ toStatusId: 2, reason });
      expect((bare.req.body as { reason?: string }).reason).toBeUndefined();
    }
  });

  it("rejects a non-string, whitespace-only or oversized reason", () => {
    for (const reason of [17, "   ", "x".repeat(CANCEL_REASON_MAX_LENGTH + 1)]) {
      vi.clearAllMocks();
      const { next } = run({ toStatusId: 2, reason });
      expect(next).not.toHaveBeenCalled();
      rejectedWith("invalidReason");
    }
  });

  it("responds 500 when the body cannot be read at all", () => {
    const req = {
      get body() {
        throw new Error("boom");
      },
    } as unknown as Request;
    validateAdvanceOrder(req, {} as Response, vi.fn() as unknown as NextFunction);
    expect(sendOzariError).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.INTERNAL_SERVER_ERROR,
      "orders.advance.validators.validationError",
    );
  });
});

describe("validateOrderEvidenceUploads", () => {
  const runUploads = (body: unknown) => {
    const req = { body } as Request;
    const next = vi.fn() as unknown as NextFunction;
    validateOrderEvidenceUploads(req, {} as Response, next);
    return { req, next: next as unknown as Mock };
  };

  it("passes a bounded list of files", () => {
    const { req, next } = runUploads({
      files: [{ contentType: "image/webp", contentLength: 2048, extra: "ignored" }],
    });
    expect(next).toHaveBeenCalled();
    expect(req.body).toEqual({
      files: [{ contentType: "image/webp", contentLength: 2048 }],
    });
  });

  it("rejects an empty, oversized or malformed list", () => {
    for (const files of [
      undefined,
      [],
      "nope",
      Array.from({ length: EVIDENCE_KEYS_MAX + 1 }, () => ({
        contentType: "image/webp",
        contentLength: 1,
      })),
      [{ contentType: "", contentLength: 10 }],
      [{ contentType: "image/webp", contentLength: 0 }],
      [{ contentType: "image/webp", contentLength: 1.5 }],
      [{ contentLength: 10 }],
    ]) {
      vi.clearAllMocks();
      const { next } = runUploads({ files });
      expect(next).not.toHaveBeenCalled();
      expect(sendOzariError).toHaveBeenCalledWith(
        expect.anything(),
        HttpEnum.BAD_REQUEST,
        "orders.advance.validators.invalidFiles",
      );
    }
  });

  it("treats a body-less request as an empty body (not a crash)", () => {
    const { next } = runUploads(undefined);
    expect(next).not.toHaveBeenCalled();
    expect(sendOzariError).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.BAD_REQUEST,
      "orders.advance.validators.invalidFiles",
    );
  });

  it("responds 500 when the body cannot be read at all", () => {
    const req = {
      get body() {
        throw new Error("boom");
      },
    } as unknown as Request;
    validateOrderEvidenceUploads(
      req,
      {} as Response,
      vi.fn() as unknown as NextFunction,
    );
    expect(sendOzariError).toHaveBeenCalledWith(
      expect.anything(),
      HttpEnum.INTERNAL_SERVER_ERROR,
      "orders.advance.validators.validationError",
    );
  });
});
