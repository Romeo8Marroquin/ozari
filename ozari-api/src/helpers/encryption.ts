import { hash, verify } from "@node-rs/bcrypt";
import crypto from "node:crypto";
import { logger } from "@/config/logger.js";

export function encryptSha256Sync(target: string): string {
  return crypto.createHash("sha256").update(target).digest("hex");
}

/**
 * Hash password using bcrypt (async to prevent event loop blocking)
 * @param password - Plain text password
 * @returns Promise<hashed password>
 */
export async function hashPassword(password: string): Promise<string> {
  return hash(password, 12);
}

/**
 * Compare password with hash using bcrypt (async to prevent event loop blocking)
 * @param password - Plain text password
 * @param hash - Hashed password
 * @returns Promise<true if match, false otherwise>
 */
export async function comparePassword(
  password: string,
  hash: string,
): Promise<boolean> {
  return verify(password, hash);
}

// AES-256-GCM encryption configuration
const ALGORITHM = "aes-256-gcm" as const;
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

let encryptionKey: Buffer | null = null;

function getEncryptionKey(): Buffer {
  if (encryptionKey === null) {
    const keyHex = process.env["ENCRYPTION_KEY"];

    /* c8 ignore start */
    if (!keyHex) {
      logger.error("ENCRYPTION_KEY environment variable is not defined");
      throw new Error("Encryption key not configured");
    }
    /* c8 ignore stop */

    encryptionKey = Buffer.from(keyHex, "hex");

    /* c8 ignore start */
    if (encryptionKey.length !== 32) {
      throw new Error("Encryption key must be 32 bytes (256 bits)");
    }
    /* c8 ignore stop */
  }

  return encryptionKey;
}

/* eslint-disable no-redeclare */
export function decryptKms(target: string): string;
export function decryptKms(target: string[]): string[];
export function decryptKms(target: string | string[]): string | string[] {
  if (typeof target === "string") {
    return decryptSingle(target);
  } else {
    return target.map(decryptSingle);
  }
}

/* eslint-disable no-redeclare */
export function encryptKms(target: string): string;
export function encryptKms(target: string[]): string[];
export function encryptKms(target: string | string[]): string | string[] {
  if (typeof target === "string") {
    return encryptSingle(target);
  } else {
    return target.map(encryptSingle);
  }
}

function encryptSingle(plaintext: string): string {
  const MAX_PLAINTEXT_SIZE = 1024 * 1024; // 1MB
  const plaintextSize = Buffer.byteLength(plaintext, "utf8");

  if (plaintextSize > MAX_PLAINTEXT_SIZE) {
    throw new Error(
      `Plaintext size (${plaintextSize} bytes) exceeds maximum allowed size (${MAX_PLAINTEXT_SIZE} bytes)`,
    );
  }

  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, "utf8");
  encrypted = Buffer.concat([encrypted, cipher.final()]);

  const authTag = cipher.getAuthTag();

  const result = Buffer.concat([iv, authTag, encrypted]);
  return result.toString("base64");
}

function decryptSingle(encryptedData: string): string {
  const key = getEncryptionKey();
  const data = Buffer.from(encryptedData, "base64");

  if (data.length < IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error("Invalid encrypted data format");
  }

  const iv = data.subarray(0, IV_LENGTH);
  const authTag = data.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const encrypted = data.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted);
  decrypted = Buffer.concat([decrypted, decipher.final()]);

  return decrypted.toString("utf8");
}
