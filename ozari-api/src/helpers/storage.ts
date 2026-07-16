import { randomUUID } from "node:crypto";
import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
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

export interface Storage {
  createUpload(input: CreateUploadInput): Promise<PresignedUpload>;
  deleteObject(key: string): Promise<void>;
  /** Batch delete — ONE round-trip for a whole gallery (S3 `DeleteObjects`, up to 1000 keys). */
  deleteObjects(keys: string[]): Promise<void>;
  getPublicUrl(key: string): string;
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
