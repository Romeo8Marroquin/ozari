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
  getCommandCtor,
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
  const getCommandCtor = vi.fn(function GetMock(input: unknown) {
    return { input };
  });
  const getSignedUrlMock = vi.fn();
  return {
    s3ClientCtor,
    sendMock,
    putCommandCtor,
    deleteCommandCtor,
    deleteBatchCommandCtor,
    getCommandCtor,
    getSignedUrlMock,
  };
});
vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: s3ClientCtor,
  PutObjectCommand: putCommandCtor,
  DeleteObjectCommand: deleteCommandCtor,
  DeleteObjectsCommand: deleteBatchCommandCtor,
  GetObjectCommand: getCommandCtor,
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

  it("builds a PATH-STYLE client, so presigned URLs stay on the CSP-pinned account host", async () => {
    const { R2Storage } = await import("./storage.js");
    new R2Storage(CONFIG);

    // A virtual-hosted URL (`<bucket>.<account>.r2…`) is refused by the app's connect-src — the
    // staging/prod "(blocked:csp)" upload failure. This pins the client option that prevents it.
    expect(s3ClientCtor).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: CONFIG.endpoint, region: "auto", forcePathStyle: true }),
    );
  });

  it("disables default checksums, so a presigned PUT is not bound to an empty-body CRC32", async () => {
    const { R2Storage } = await import("./storage.js");
    new R2Storage(CONFIG);

    // The SDK's WHEN_SUPPORTED default signs `x-amz-checksum-crc32=AAAAAA==` (the CRC of nothing)
    // into every presigned PutObject, and R2 then rejects the real file. Cloudflare's R2 setting.
    expect(s3ClientCtor).toHaveBeenCalledWith(
      expect.objectContaining({
        requestChecksumCalculation: "WHEN_REQUIRED",
        responseChecksumValidation: "WHEN_REQUIRED",
      }),
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

  it("maps one of its own public URLs back to the key — the inverse of getPublicUrl", async () => {
    const { R2Storage } = await import("./storage.js");
    const storage = new R2Storage(CONFIG);
    expect(storage.keyFromPublicUrl(storage.getPublicUrl("products/x.png"))).toBe("products/x.png");
    expect(storage.keyFromPublicUrl("https://evil.example.com/products/x.png")).toBeNull();
  });

  /** A GetObject output whose body reports what was read and whether it was abandoned. */
  const objectOutput = (bytes: number[], extra: Record<string, unknown> = {}) => {
    const cancel = vi.fn(() => Promise.resolve());
    return {
      cancel,
      output: {
        ContentType: "image/webp",
        ContentLength: bytes.length,
        Body: {
          transformToByteArray: vi.fn(async () => new Uint8Array(bytes)),
          transformToWebStream: vi.fn(() => ({ cancel })),
        },
        ...extra,
      },
    };
  };

  it("reads an object's bytes and stored type over the S3 API", async () => {
    const { R2Storage } = await import("./storage.js");
    sendMock.mockResolvedValueOnce(objectOutput([1, 2, 3]).output);

    const object = await new R2Storage(CONFIG).getObject("products/a.webp", 10);

    expect(getCommandCtor).toHaveBeenCalledWith({ Bucket: "ozari-assets", Key: "products/a.webp" });
    expect(object).toEqual({ body: new Uint8Array([1, 2, 3]), contentType: "image/webp" });
    // Every read is bounded by a deadline — a stalled R2 must not hold the request open.
    expect(sendMock).toHaveBeenCalledWith(expect.anything(), {
      abortSignal: expect.any(AbortSignal),
    });
  });

  it.each(["TimeoutError", "AbortError"])(
    "turns a read that ran out of time (%s) into a StorageTimeoutError",
    async (name) => {
      const { R2Storage, StorageTimeoutError } = await import("./storage.js");
      sendMock.mockRejectedValueOnce(Object.assign(new Error("slow"), { name }));
      await expect(
        new R2Storage(CONFIG).getObject("products/slow.webp", 10),
      ).rejects.toBeInstanceOf(StorageTimeoutError);
    },
  );

  it("refuses an object above the cap WITHOUT reading its body", async () => {
    const { R2Storage, StorageValidationError } = await import("./storage.js");
    const { output, cancel } = objectOutput([1, 2, 3, 4]);
    sendMock.mockResolvedValueOnce(output);

    await expect(new R2Storage(CONFIG).getObject("products/a.webp", 3)).rejects.toBeInstanceOf(
      StorageValidationError,
    );
    expect(output.Body.transformToByteArray).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalled();

    // A stream that fails to cancel changes nothing: the refusal is the answer either way.
    const failing = objectOutput([1, 2, 3, 4]);
    failing.cancel.mockRejectedValueOnce(new Error("already closed"));
    sendMock.mockResolvedValueOnce(failing.output);
    await expect(new R2Storage(CONFIG).getObject("products/a.webp", 3)).rejects.toBeInstanceOf(
      StorageValidationError,
    );
  });

  it("reads an object whose length is not reported", async () => {
    const { R2Storage } = await import("./storage.js");
    sendMock.mockResolvedValueOnce(objectOutput([9], { ContentLength: undefined }).output);
    await expect(new R2Storage(CONFIG).getObject("products/a.webp", 10)).resolves.toMatchObject({
      body: new Uint8Array([9]),
    });
  });

  it("answers null for a missing object, or one with no body", async () => {
    const { R2Storage } = await import("./storage.js");
    const storage = new R2Storage(CONFIG);
    sendMock.mockRejectedValueOnce(Object.assign(new Error("gone"), { name: "NoSuchKey" }));
    await expect(storage.getObject("products/gone.webp", 10)).resolves.toBeNull();
    sendMock.mockResolvedValueOnce({});
    await expect(storage.getObject("products/empty.webp", 10)).resolves.toBeNull();
  });

  it("lets any other storage failure through", async () => {
    const { R2Storage } = await import("./storage.js");
    const storage = new R2Storage(CONFIG);
    sendMock.mockRejectedValueOnce(new Error("R2 down"));
    await expect(storage.getObject("products/a.webp", 10)).rejects.toThrow("R2 down");
    sendMock.mockRejectedValueOnce(null);
    await expect(storage.getObject("products/a.webp", 10)).rejects.toBeNull();
  });
});

describe("assetKeyFromUrl", () => {
  const BASE = "https://assets.example.com";

  it.each([
    ["a product photo", `${BASE}/products/3f2504e0.webp`, "products/3f2504e0.webp"],
    ["an order evidence photo", `${BASE}/orders/evidence/9a.jpg`, "orders/evidence/9a.jpg"],
    ["a base given with a trailing slash", `${BASE}/products/a.png`, "products/a.png"],
  ])("accepts %s", async (_label, url, key) => {
    const { assetKeyFromUrl } = await import("./storage.js");
    expect(assetKeyFromUrl(`${BASE}/`, url)).toBe(key);
  });

  it("honours a base that has a path of its own", async () => {
    const { assetKeyFromUrl } = await import("./storage.js");
    expect(assetKeyFromUrl(`${BASE}/cdn`, `${BASE}/cdn/products/a.png`)).toBe("products/a.png");
    expect(assetKeyFromUrl(`${BASE}/cdn`, `${BASE}/products/a.png`)).toBeNull();
  });

  // Each of these would turn the endpoint into a proxy for something that is not our asset.
  it.each([
    ["another host", "https://evil.example.com/products/a.png"],
    ["another scheme", "http://assets.example.com/products/a.png"],
    ["embedded credentials", "https://user:pw@assets.example.com/products/a.png"],
    ["a query string", `${BASE}/products/a.png?x=1`],
    ["a fragment", `${BASE}/products/a.png#x`],
    ["a folder outside the app's prefixes", `${BASE}/secrets/a.png`],
    ["a prefix without a key", `${BASE}/products/`],
    ["the bare base", `${BASE}/`],
    ["an encoded traversal", `${BASE}/products/%2e%2e%2fsecrets%2fa.png`],
    ["an encoded empty segment", `${BASE}/products/%2Fa.png`],
    // (A bare `%2E` segment is already collapsed by the URL parser; one hidden behind encoded
    // slashes survives it and is refused here.)
    ["an encoded dot segment", `${BASE}/products/x%2F.%2Fa.png`],
    ["an exotic character", `${BASE}/products/a%20b.png`],
    ["a malformed escape", `${BASE}/products/%E0%A4%A.png`],
    ["a key that is far too long", `${BASE}/products/${"a".repeat(600)}.png`],
    ["not a URL at all", "products/a.png"],
  ])("refuses %s", async (_label, url) => {
    const { assetKeyFromUrl } = await import("./storage.js");
    expect(assetKeyFromUrl(BASE, url)).toBeNull();
  });

  it("refuses everything when the configured base is itself not a URL", async () => {
    const { assetKeyFromUrl } = await import("./storage.js");
    expect(assetKeyFromUrl("not a base", `${BASE}/products/a.png`)).toBeNull();
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
