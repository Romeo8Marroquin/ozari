import { randomUUID } from "node:crypto";
import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { appConfig } from "@/config/app.js";

/**
 * Cloudflare R2 (S3-compatible) object storage for PUBLIC assets (product images, …).
 *
 * Design (mirrors the Mailer abstraction): the non-secret policy lives in `appConfig.storage`; the
 * connection + credentials are read from env here. Uploads never flow through the API — a caller mints
 * a short-lived **presigned PUT URL** and the browser uploads straight to R2 (keeps image bytes out of
 * Cloud Run and respects the 10 kB body cap). The bucket is public-READ, so nothing private goes in it.
 *
 * The ONE read that does flow through the API is a printed document's row photo (`GET
 * /documents/image`, EPIC-2-DOCUMENTS §2d #39): `getObject` reads it over the S3 API, so a document
 * never depends on the public edge's CORS headers or cache. `keyFromPublicUrl` is what keeps that
 * read on the app's own assets.
 *
 * Env (see .env.example / DEPLOYMENT.md §3b):
 *   R2_ENDPOINT       — S3 API endpoint https://<account-id>.r2.cloudflarestorage.com   (plain)
 *   R2_BUCKET_NAME    — bucket name                                                      (plain)
 *   R2_PUBLIC_URL     — public read base URL (r2.dev or a custom domain)                 (plain)
 *   R2_ACCESS_KEY     — S3 access key id                                                 (SECRET)
 *   R2_SECRET_KEY     — S3 secret access key                                             (SECRET)
 * (R2_TOKEN, the Cloudflare REST-API bearer, is NOT used by the S3 SDK.)
 */

export type AssetKind = keyof typeof appConfig.storage.keyPrefixes;

export interface CreateUploadInput {
  kind: AssetKind;
  contentType: string;
  contentLength: number;
}

export interface PresignedUpload {
  /** Short-lived URL the client PUTs the file to (directly to R2). */
  uploadUrl: string;
  /** Object key stored in the bucket — persist this; the public URL derives from it. */
  key: string;
  /** Public, browser-facing URL the asset is served from once uploaded. */
  publicUrl: string;
}

/** An object's bytes as read from the bucket. */
export interface StoredObject {
  body: Uint8Array;
  /** As recorded at upload (the presigned PUT binds it), `undefined` if the store has none. */
  contentType: string | undefined;
}

export interface Storage {
  createUpload(input: CreateUploadInput): Promise<PresignedUpload>;
  deleteObject(key: string): Promise<void>;
  /** Batch delete — ONE round-trip for a whole gallery (S3 `DeleteObjects`, up to 1000 keys). */
  deleteObjects(keys: string[]): Promise<void>;
  getPublicUrl(key: string): string;
  /** The inverse of {@link getPublicUrl}: the key behind one of OUR public URLs, or `null` when the
   *  URL is not one ({@link assetKeyFromUrl}). */
  keyFromPublicUrl(url: string): string | null;
  /**
   * Read an object through the S3 API (never the public edge). `null` when it does not exist;
   * {@link StorageValidationError} when it is larger than `maxBytes`, checked BEFORE the body is
   * read so an oversized object is never buffered.
   */
  getObject(key: string, maxBytes: number): Promise<StoredObject | null>;
}

/** Longer than any key this app writes (`orders/evidence/<uuid>.<ext>` is ~60 chars). */
const MAX_ASSET_KEY_LENGTH = 512;
/** The characters a key this app writes can contain: its prefixes, a UUID and an extension. */
const SAFE_ASSET_KEY = /^[\w./-]+$/;

/**
 * The bucket key behind a public asset URL — or `null` unless the URL is unmistakably one THIS app
 * wrote: same origin as the public base (no credentials, query or fragment), under the base path,
 * a plain key (no empty, `.` or `..` segment, no exotic characters) and inside one of the app's own
 * `keyPrefixes`. This is what lets an endpoint accept a URL from the client and still never read
 * anything but the app's own assets: no other host, no other folder, no traversal.
 */
export function assetKeyFromUrl(publicBase: string, url: string): string | null {
  let parsed: URL;
  let base: URL;
  try {
    parsed = new URL(url);
    base = new URL(`${publicBase.replace(/\/+$/, "")}/`);
  } catch {
    return null;
  }
  if (
    parsed.origin !== base.origin ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    !parsed.pathname.startsWith(base.pathname)
  ) {
    return null;
  }
  let key: string;
  try {
    key = decodeURIComponent(parsed.pathname.slice(base.pathname.length));
  } catch {
    return null;
  }
  if (
    key.length === 0 ||
    key.length > MAX_ASSET_KEY_LENGTH ||
    !SAFE_ASSET_KEY.test(key) ||
    key.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    return null;
  }
  const prefixes = Object.values(appConfig.storage.keyPrefixes);
  return prefixes.some((prefix) => key.startsWith(`${prefix}/`)) ? key : null;
}

/**
 * The requested upload violates the storage policy (bad content type / size). Distinct from an
 * infrastructure failure so callers can map it to a 422 (semantic input error) rather than a 500.
 */
export class StorageValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorageValidationError";
  }
}

/** A read did not finish within `appConfig.storage.readTimeoutMs` — the store is slow or stalled,
 *  not the request wrong. Distinct so a caller can answer 504 (retryable) rather than 500. */
export class StorageTimeoutError extends Error {
  constructor(key: string) {
    super(`Storage read timed out: ${key}`);
    this.name = "StorageTimeoutError";
  }
}

interface R2Config {
  endpoint: string;
  bucket: string;
  publicUrl: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export class R2Storage implements Storage {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly publicUrl: string;

  constructor(config: R2Config) {
    this.bucket = config.bucket;
    this.publicUrl = config.publicUrl.replace(/\/+$/, "");
    this.client = new S3Client({
      // R2 is region-agnostic; "auto" is Cloudflare's documented value.
      region: "auto",
      endpoint: config.endpoint,
      // ⚠️ LOAD-BEARING: path-style (`https://<account>.r2.cloudflarestorage.com/<bucket>/<key>`).
      // The SDK's default for a DNS-safe bucket is VIRTUAL-HOSTED (`https://<bucket>.<account>.r2…`),
      // a host the app's CSP does not list — its `connect-src` pins the exact account endpoint
      // (ozari-app/index.html). The browser then refuses the presigned PUT before it leaves (status
      // "(blocked:csp)", 0 ms): every gallery photo and order-evidence upload dies while the product
      // itself saves. Path-style keeps the upload on the one host the CSP names, with no policy change.
      forcePathStyle: true,
      // ⚠️ LOAD-BEARING: checksums only when an operation REQUIRES one (Cloudflare's documented R2
      // setting). Since v3.729 the SDK defaults to WHEN_SUPPORTED and adds a CRC32 to every PutObject;
      // in a PRESIGNED URL it is computed at signing time over an empty body
      // (`x-amz-checksum-crc32=AAAAAA==`), so R2 rejects the browser's real file as a checksum
      // mismatch. The upload's integrity is already pinned by the signed Content-Length + type.
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  async createUpload({
    kind,
    contentType,
    contentLength,
  }: CreateUploadInput): Promise<PresignedUpload> {
    const extension = appConfig.storage.allowedImageTypes[contentType];
    if (!extension) {
      throw new StorageValidationError(`Unsupported content type: ${contentType}`);
    }
    if (!Number.isInteger(contentLength) || contentLength <= 0) {
      throw new StorageValidationError(
        "Content length must be a positive integer",
      );
    }
    if (contentLength > appConfig.storage.maxUploadBytes) {
      throw new StorageValidationError(
        `File exceeds the maximum allowed size of ${appConfig.storage.maxUploadBytes} bytes`,
      );
    }

    const key = `${appConfig.storage.keyPrefixes[kind]}/${randomUUID()}.${extension}`;
    // ContentType + ContentLength are bound INTO the signature, so the client must upload exactly this
    // type and size — a presigned URL can't be reused to store something bigger or of another kind.
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
      ContentLength: contentLength,
    });
    const uploadUrl = await getSignedUrl(this.client, command, {
      expiresIn: appConfig.storage.uploadUrlTtlSeconds,
    });
    return { uploadUrl, key, publicUrl: this.getPublicUrl(key) };
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }

  async deleteObjects(keys: string[]): Promise<void> {
    if (keys.length === 0) {
      return;
    }
    // One batched round-trip for the whole gallery (product galleries cap at 8, far below the
    // S3 DeleteObjects limit of 1000 — no chunking needed).
    await this.client.send(
      new DeleteObjectsCommand({
        Bucket: this.bucket,
        Delete: { Objects: keys.map((key) => ({ Key: key })), Quiet: true },
      }),
    );
  }

  getPublicUrl(key: string): string {
    return `${this.publicUrl}/${key}`;
  }

  keyFromPublicUrl(url: string): string | null {
    return assetKeyFromUrl(this.publicUrl, url);
  }

  async getObject(key: string, maxBytes: number): Promise<StoredObject | null> {
    try {
      // Bounded: the WHOLE read (request + body) shares one deadline, so a stalled R2 fails as a
      // `StorageTimeoutError` rather than holding the request open.
      // (Through `globalThis`: Node 22's global, which the lint env does not declare.)
      const abortSignal = globalThis.AbortSignal.timeout(appConfig.storage.readTimeoutMs);
      const output = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
        { abortSignal },
      );
      if (output.Body === undefined) {
        return null;
      }
      if ((output.ContentLength ?? 0) > maxBytes) {
        // Not reading it IS the guard: release the socket and refuse.
        output.Body.transformToWebStream().cancel().catch(() => undefined);
        throw new StorageValidationError(`Object exceeds ${maxBytes} bytes`);
      }
      return {
        body: await output.Body.transformToByteArray(),
        contentType: output.ContentType,
      };
    } catch (error) {
      const name = (error as { name?: unknown } | null)?.name;
      if (name === "NoSuchKey") {
        return null;
      }
      // `AbortSignal.timeout` aborts with a `TimeoutError`; the SDK may surface it as an AbortError.
      if (name === "TimeoutError" || name === "AbortError") {
        throw new StorageTimeoutError(key);
      }
      throw error;
    }
  }
}

function readR2Config(): R2Config {
  const endpoint = process.env["R2_ENDPOINT"];
  const bucket = process.env["R2_BUCKET_NAME"];
  const publicUrl = process.env["R2_PUBLIC_URL"];
  const accessKeyId = process.env["R2_ACCESS_KEY"];
  const secretAccessKey = process.env["R2_SECRET_KEY"];

  if (!endpoint || !bucket || !publicUrl || !accessKeyId || !secretAccessKey) {
    throw new Error(
      "R2 storage is not configured (need R2_ENDPOINT, R2_BUCKET_NAME, R2_PUBLIC_URL, R2_ACCESS_KEY, R2_SECRET_KEY)",
    );
  }
  return { endpoint, bucket, publicUrl, accessKeyId, secretAccessKey };
}

let storage: Storage | null = null;

/**
 * Lazily builds the R2 storage client once per process (mirrors getMailer). Throws if the R2 env is
 * incomplete — a misconfiguration we want to fail loudly on, not silently drop assets.
 */
export function getStorage(): Storage {
  if (storage) {
    return storage;
  }
  storage = new R2Storage(readR2Config());
  return storage;
}
