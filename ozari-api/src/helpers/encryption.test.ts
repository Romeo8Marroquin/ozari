import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import {
  encryptSha256Sync,
  hashPassword,
  comparePassword,
  encryptKms,
  decryptKms,
} from "./encryption.js";

const VALID_ENCRYPTION_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

beforeAll(() => {
  process.env["ENCRYPTION_KEY"] = VALID_ENCRYPTION_KEY;
});

afterEach(() => {
  // Ensure encryption key is always set back to valid value
  process.env["ENCRYPTION_KEY"] = VALID_ENCRYPTION_KEY;
});

describe("Encryption", () => {
  describe("encryptSha256Sync", () => {
    it("should hash strings consistently", () => {
      const input = "test-string";
      const hash1 = encryptSha256Sync(input);
      const hash2 = encryptSha256Sync(input);

      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64);
    });

    it("should produce different hashes for different inputs", () => {
      const hash1 = encryptSha256Sync("string1");
      const hash2 = encryptSha256Sync("string2");

      expect(hash1).not.toBe(hash2);
    });

    it("should produce hex output", () => {
      const hash = encryptSha256Sync("test");
      expect(/^[0-9a-f]{64}$/.test(hash)).toBe(true);
    });
  });

  describe("hashPassword and comparePassword", () => {
    it("should hash password and verify correctly", async () => {
      const password = "SecurePass123!";
      const hash = await hashPassword(password);

      expect(hash).toBeDefined();
      expect(hash).not.toBe(password);

      const isMatch = await comparePassword(password, hash);
      expect(isMatch).toBe(true);
    });

    it("should reject incorrect passwords", async () => {
      const password = "SecurePass123!";
      const wrongPassword = "WrongPass456!";
      const hash = await hashPassword(password);

      const isMatch = await comparePassword(wrongPassword, hash);
      expect(isMatch).toBe(false);
    });

    it("should produce different hashes for same password", async () => {
      const password = "SecurePass123!";
      const hash1 = await hashPassword(password);
      const hash2 = await hashPassword(password);

      expect(hash1).not.toBe(hash2);
    });
  });

  describe("encryptKms and decryptKms", () => {
    it("should encrypt and decrypt single string", () => {
      const plaintext = "sensitive-data";

      const encrypted = encryptKms(plaintext);
      expect(encrypted).toBeDefined();
      expect(encrypted).not.toBe(plaintext);

      const decrypted = decryptKms(encrypted);
      expect(decrypted).toBe(plaintext);
    });

    it("should encrypt and decrypt array of strings", () => {
      const plaintexts = ["data1", "data2", "data3"];

      const encrypted = encryptKms(plaintexts);
      expect(Array.isArray(encrypted)).toBe(true);
      expect(encrypted).toHaveLength(3);
      expect(encrypted[0]).not.toBe(plaintexts[0]);

      const decrypted = decryptKms(encrypted);
      expect(decrypted).toEqual(plaintexts);
    });

    it("should produce different ciphertexts for same plaintext", () => {
      const plaintext = "test-data";

      const encrypted1 = encryptKms(plaintext);
      const encrypted2 = encryptKms(plaintext);

      expect(encrypted1).not.toBe(encrypted2);

      expect(decryptKms(encrypted1)).toBe(plaintext);
      expect(decryptKms(encrypted2)).toBe(plaintext);
    });

    it("should handle unicode characters", () => {
      const plaintext = "Hello 世界 🌍";

      const encrypted = encryptKms(plaintext);
      const decrypted = decryptKms(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    it("should throw on oversized plaintext", () => {
      const oversized = "a".repeat(1024 * 1024 + 1);

      expect(() => encryptKms(oversized)).toThrow(/exceeds maximum allowed/);
    });

    it("should throw on invalid encrypted data", () => {
      expect(() => decryptKms("invalid-base64")).toThrow();
      expect(() => decryptKms("dG9vc2hvcnQ=")).toThrow(
        /Invalid encrypted data/,
      );
    });

    it("should handle empty strings", () => {
      const plaintext = "";

      const encrypted = encryptKms(plaintext);
      const decrypted = decryptKms(encrypted);

      expect(decrypted).toBe(plaintext);
    });
  });

});
