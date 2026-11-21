import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextFunction, Request, Response } from "express";
import { sendOzariError } from "@models/http/ozariErrorModel.js";
import { HttpEnum } from "@models/enums/httpEnum.js";
import { validateDocumentImageQuery } from "./documents.validator.js";
import { DOCUMENT_IMAGE_URL_MAX_LENGTH } from "./documents.models.js";

vi.mock("@/config/logger.js", () => ({ logger: { warn: vi.fn() } }));
vi.mock("@/config/i18n.js", () => ({ i18next: { t: vi.fn((key: string) => key) } }));
vi.mock("@models/http/ozariErrorModel.js", () => ({ sendOzariError: vi.fn() }));

const run = (query: Record<string, unknown>) => {
  const next = vi.fn() as NextFunction;
  const res = {} as Response;
  validateDocumentImageQuery({ query } as unknown as Request, res, next);
  return { next, res };
};

beforeEach(() => vi.clearAllMocks());

describe("validateDocumentImageQuery", () => {
  it("lets a single, non-empty url through", () => {
    const { next } = run({ url: "https://assets.example.com/products/a.webp" });
    expect(next).toHaveBeenCalledOnce();
    expect(sendOzariError).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", {}],
    ["blank", { url: "   " }],
    ["repeated (an array)", { url: ["a", "b"] }],
    ["oversized", { url: `https://a.example.com/${"x".repeat(DOCUMENT_IMAGE_URL_MAX_LENGTH)}` }],
  ])("400s a url that is %s", (_label, query) => {
    const { next, res } = run(query);
    expect(next).not.toHaveBeenCalled();
    expect(sendOzariError).toHaveBeenCalledWith(
      res,
      HttpEnum.BAD_REQUEST,
      "documents.getImage.validators.url",
    );
  });
});
