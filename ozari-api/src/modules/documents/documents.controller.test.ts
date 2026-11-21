import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import type { Request, Response } from "express";
import { appConfig } from "@/config/app.js";
import { logger } from "@/config/logger.js";
import {
  getStorage,
  StorageTimeoutError,
  StorageValidationError,
} from "@helpers/storage.js";
import { sendOzariError } from "@models/http/ozariErrorModel.js";
import { HttpEnum } from "@models/enums/httpEnum.js";
import { getDocumentImage } from "./documents.controller.js";
import { DOCUMENT_IMAGE_CACHE_CONTROL } from "./documents.models.js";

vi.mock("@/config/logger.js", () => ({ logger: { warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/config/i18n.js", () => ({ i18next: { t: vi.fn((key: string) => key) } }));
vi.mock("@models/http/ozariErrorModel.js", () => ({ sendOzariError: vi.fn() }));
// The real error class, so the controller's `instanceof` is exercised; only the client is stubbed.
vi.mock("@helpers/storage.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@helpers/storage.js")>()),
  getStorage: vi.fn(),
}));

const URL_ = "https://assets.example.com/products/a.webp";
const KEY = "products/a.webp";

const storage = {
  keyFromPublicUrl: vi.fn((): string | null => KEY),
  getObject: vi.fn(),
};

const response = () => {
  const res = {
    setHeader: vi.fn(),
    status: vi.fn(),
    end: vi.fn(),
  };
  res.status.mockReturnValue(res);
  return res;
};

const call = async (url = URL_) => {
  const res = response();
  await getDocumentImage({ query: { url } } as unknown as Request, res as unknown as Response);
  return res;
};

beforeEach(() => {
  vi.clearAllMocks();
  (getStorage as Mock).mockReturnValue(storage);
  storage.keyFromPublicUrl.mockReturnValue(KEY);
});

describe("getDocumentImage", () => {
  it("serves the photo's bytes with its own type, privately cacheable", async () => {
    storage.getObject.mockResolvedValue({
      body: new Uint8Array([7, 8, 9]),
      contentType: "image/WEBP; charset=binary",
    });
    const res = await call();

    expect(storage.keyFromPublicUrl).toHaveBeenCalledWith(URL_);
    // Size-capped by the SAME limit the upload policy enforces.
    expect(storage.getObject).toHaveBeenCalledWith(KEY, appConfig.storage.maxUploadBytes);
    expect(res.setHeader).toHaveBeenCalledWith("content-type", "image/webp");
    expect(res.setHeader).toHaveBeenCalledWith("content-length", "3");
    expect(res.setHeader).toHaveBeenCalledWith("cache-control", DOCUMENT_IMAGE_CACHE_CONTROL);
    expect(res.status).toHaveBeenCalledWith(HttpEnum.OK);
    expect(res.end).toHaveBeenCalledWith(Buffer.from([7, 8, 9]));
    expect(sendOzariError).not.toHaveBeenCalled();
  });

  it("400s a URL that is not one of the app's own assets, and never touches storage", async () => {
    storage.keyFromPublicUrl.mockReturnValue(null);
    const res = await call(`https://evil.example.com/${"x".repeat(500)}`);

    expect(storage.getObject).not.toHaveBeenCalled();
    expect(res.end).not.toHaveBeenCalled();
    expect(sendOzariError).toHaveBeenCalledWith(
      res,
      HttpEnum.BAD_REQUEST,
      "documents.getImage.foreign",
    );
  });

  it("404s a photo that no longer exists", async () => {
    storage.getObject.mockResolvedValue(null);
    const res = await call();
    expect(sendOzariError).toHaveBeenCalledWith(
      res,
      HttpEnum.NOT_FOUND,
      "documents.getImage.notFound",
    );
  });

  it.each([
    ["a type the upload policy does not allow", "application/pdf"],
    ["no stored type at all", undefined],
    ["an inherited property name", "constructor"],
  ])("422s an object with %s", async (_label, contentType) => {
    storage.getObject.mockResolvedValue({ body: new Uint8Array([1]), contentType });
    const res = await call();
    expect(res.end).not.toHaveBeenCalled();
    expect(sendOzariError).toHaveBeenCalledWith(
      res,
      HttpEnum.UNPROCESSABLE_ENTITY,
      "documents.getImage.notImage",
    );
  });

  it("422s an object above the size cap", async () => {
    storage.getObject.mockRejectedValue(new StorageValidationError("too big"));
    const res = await call();
    expect(sendOzariError).toHaveBeenCalledWith(
      res,
      HttpEnum.UNPROCESSABLE_ENTITY,
      "documents.getImage.notImage",
    );
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("504s a storage read that ran out of time — retryable, not a server error", async () => {
    storage.getObject.mockRejectedValue(new StorageTimeoutError(KEY));
    const res = await call();
    expect(sendOzariError).toHaveBeenCalledWith(
      res,
      HttpEnum.GATEWAY_TIMEOUT,
      "documents.getImage.timeout",
    );
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("500s on a storage failure without leaking it", async () => {
    storage.getObject.mockRejectedValue(new Error("R2 down"));
    const res = await call();
    expect(logger.error).toHaveBeenCalled();
    expect(sendOzariError).toHaveBeenCalledWith(
      res,
      HttpEnum.INTERNAL_SERVER_ERROR,
      "documents.getImage.unavailable",
    );
  });
});
