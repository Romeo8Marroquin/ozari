import bcrypt from "bcrypt";
import crypto from "node:crypto";
import { logger } from "@/config/logger.js";

export function encryptSha256Sync(target: string): string {
  return crypto.createHash("sha256").update(target).digest("hex");
}

export function hashPassword(password: string): string {
  const salt = bcrypt.genSaltSync(12);
  return bcrypt.hashSync(password, salt);
}

export function comparePassword(password: string, hash: string): boolean {
  return bcrypt.compareSync(password, hash);
}

// AES-256-GCM encryption configuration
const ALGORITHM = "aes-256-gcm" as const;
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

let encryptionKey: Buffer | null = null;

function getEncryptionKey(): Buffer {
  if (encryptionKey === null) {
    const keyHex = process.env["ENCRYPTION_KEY"];

    if (!keyHex) {
      logger.error("ENCRYPTION_KEY environment variable is not defined");
      throw new Error("Encryption key not configured");
    }

    encryptionKey = Buffer.from(keyHex, "hex");

    if (encryptionKey.length !== 32) {
      throw new Error("Encryption key must be 32 bytes (256 bits)");
    }
  }

  return encryptionKey;
}

export async function decryptKmsAsync(target: string): Promise<string>;
export async function decryptKmsAsync(target: string[]): Promise<string[]>;
export async function decryptKmsAsync(
  target: string | string[],
): Promise<string | string[]> {
  if (typeof target === "string") {
    return decryptSingleAsync(target);
  } else {
    const decryptPromises = target.map(decryptSingleAsync);
    return Promise.all(decryptPromises);
  }
}

export async function encryptKmsAsync(target: string): Promise<string>;
export async function encryptKmsAsync(target: string[]): Promise<string[]>;
export async function encryptKmsAsync(
  target: string | string[],
): Promise<string | string[]> {
  if (typeof target === "string") {
    return encryptSingleAsync(target);
  } else {
    const encryptPromises = target.map(encryptSingleAsync);
    return Promise.all(encryptPromises);
  }
}

async function encryptSingleAsync(plaintext: string): Promise<string> {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, "utf8");
  encrypted = Buffer.concat([encrypted, cipher.final()]);

  const authTag = cipher.getAuthTag();

  const result = Buffer.concat([iv, authTag, encrypted]);
  return result.toString("base64");
}

async function decryptSingleAsync(encryptedData: string): Promise<string> {
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
