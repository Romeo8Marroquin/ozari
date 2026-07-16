import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { appConfig } from "@/config/app.js";

// Mock the S3 client + presigner: capture the constructed commands and the presign call. Regular
// functions (not arrows) because the code uses `new S3Client(...)` / `new PutObjectCommand(...)`.
const {
  s3ClientCtor,
  sendMock,
  putCommandCtor,
  deleteCommandCtor,
  deleteBatchCommandCtor,
  getSignedUrlMock,
} = vi.hoisted(() => {
  const sendMock = vi.fn();
  const s3ClientCtor = vi.fn(function S3ClientMock() {
    return { send: sendMock };
  });
  const putCommandCtor = vi.fn(function PutMock(input: unknown) {
    return { input };
  });
  const deleteCommandCtor = vi.fn(function DeleteMock(input: unknown) {
    return { input };
  });
  const deleteBatchCommandCtor = vi.fn(function DeleteBatchMock(input: unknown) {
    return { input };
  });
  const getSignedUrlMock = vi.fn();
  return {
    s3ClientCtor,
    sendMock,
    putCommandCtor,
    deleteCommandCtor,
    deleteBatchCommandCtor,
    getSignedUrlMock,
  };
});
vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: s3ClientCtor,
  PutObjectCommand: putCommandCtor,
  DeleteObjectCommand: deleteCommandCtor,
  DeleteObjectsCommand: deleteBatchCommandCtor,
}));
vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: getSignedUrlMock,
}));

const CONFIG = {
  endpoint: "https://acc.r2.cloudflarestorage.com",
  bucket: "ozari-assets",
  publicUrl: "https://pub.example.com/", // trailing slash → exercises the strip
  accessKeyId: "ak",
  secretAccessKey: "sk",
};

describe("R2Storage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSignedUrlMock.mockResolvedValue("https://signed.example/put");
  });

  it("creates a presigned upload with a namespaced, extensioned key", async () => {
    const { R2Storage } = await import("./storage.js");
    const result = await new R2Storage(CONFIG).createUpload({
      kind: "product",
      contentType: "image/png",
      contentLength: 1024,
    });

    expect(result.key).toMatch(/^products\/[0-9a-f-]{36}\.png$/);
    expect(result.uploadUrl).toBe("https://signed.example/put");
    expect(result.publicUrl).toBe(`https://pub.example.com/${result.key}`);

    // The command binds bucket/key/type/size; presign uses the configured TTL.
    expect(putCommandCtor).toHaveBeenCalledWith({
      Bucket: "ozari-assets",
      Key: result.key,
      ContentType: "image/png",
      ContentLength: 1024,
    });
    expect(getSignedUrlMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ input: expect.anything() }),
      { expiresIn: appConfig.storage.uploadUrlTtlSeconds },
    );
  });

  it("rejects an unsupported content type", async () => {
    const { R2Storage, StorageValidationError } = await import("./storage.js");
    await expect(
      new R2Storage(CONFIG).createUpload({
        kind: "product",
        contentType: "application/pdf",
        contentLength: 1024,
      }),
    ).rejects.toBeInstanceOf(StorageValidationError);
    expect(getSignedUrlMock).not.toHaveBeenCalled();
  });

  it.each([0, -1, 3.5])(
    "rejects a non-positive/non-integer content length: %s",
    async (length) => {
      const { R2Storage, StorageValidationError } = await import("./storage.js");
      await expect(
        new R2Storage(CONFIG).createUpload({
          kind: "product",
          contentType: "image/jpeg",
          contentLength: length,
        }),
      ).rejects.toBeInstanceOf(StorageValidationError);
    },
  );

  it("rejects a file above the max upload size", async () => {
    const { R2Storage, StorageValidationError } = await import("./storage.js");
    await expect(
      new R2Storage(CONFIG).createUpload({
        kind: "product",
        contentType: "image/webp",
        contentLength: appConfig.storage.maxUploadBytes + 1,
      }),
    ).rejects.toBeInstanceOf(StorageValidationError);
  });

  it("deletes an object by key", async () => {
    const { R2Storage } = await import("./storage.js");
    await new R2Storage(CONFIG).deleteObject("products/abc.png");

    expect(deleteCommandCtor).toHaveBeenCalledWith({
      Bucket: "ozari-assets",
      Key: "products/abc.png",
    });
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it("deletes a whole gallery in ONE batched round-trip", async () => {
    const { R2Storage } = await import("./storage.js");
    await new R2Storage(CONFIG).deleteObjects(["products/a.png", "products/b.webp"]);

    expect(deleteBatchCommandCtor).toHaveBeenCalledWith({
      Bucket: "ozari-assets",
      Delete: {
        Objects: [{ Key: "products/a.png" }, { Key: "products/b.webp" }],
        Quiet: true,
      },
    });
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it("never calls out for an empty key list", async () => {
    const { R2Storage } = await import("./storage.js");
    await new R2Storage(CONFIG).deleteObjects([]);
    expect(deleteBatchCommandCtor).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("builds a public URL, stripping a trailing slash from the base", async () => {
    const { R2Storage } = await import("./storage.js");
    expect(new R2Storage(CONFIG).getPublicUrl("products/x.png")).toBe(
      "https://pub.example.com/products/x.png",
    );
  });
});

describe("getStorage", () => {
  const KEYS = [
    "R2_ENDPOINT",
    "R2_BUCKET_NAME",
    "R2_PUBLIC_URL",
    "R2_ACCESS_KEY",
    "R2_SECRET_KEY",
  ] as const;
  const original: Record<string, string | undefined> = {};

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    for (const key of KEYS) {
      original[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of KEYS) {
      if (original[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = original[key];
      }
    }
  });

  it("throws when the R2 env is incomplete", async () => {
    process.env["R2_ENDPOINT"] = CONFIG.endpoint; // only one set → still incomplete
    const { getStorage } = await import("./storage.js");
    expect(() => getStorage()).toThrow(/not configured/);
  });

  it("returns a cached singleton when fully configured", async () => {
    process.env["R2_ENDPOINT"] = CONFIG.endpoint;
    process.env["R2_BUCKET_NAME"] = CONFIG.bucket;
    process.env["R2_PUBLIC_URL"] = CONFIG.publicUrl;
    process.env["R2_ACCESS_KEY"] = CONFIG.accessKeyId;
    process.env["R2_SECRET_KEY"] = CONFIG.secretAccessKey;

    const { getStorage } = await import("./storage.js");
    expect(getStorage()).toBe(getStorage());
    expect(s3ClientCtor).toHaveBeenCalledTimes(1); // built once, then cached
  });
});
