import { describe, it, expect } from "vitest";
import { isValidEnumValue, sanitizeSensitiveData } from "./utils.js";

describe("Utils", () => {
  describe("isValidEnumValue", () => {
    it("should return true for valid enum values", () => {
      const TestEnum = { ACTIVE: 1, INACTIVE: 2, PENDING: 3 };

      expect(isValidEnumValue(TestEnum, 1)).toBe(true);
      expect(isValidEnumValue(TestEnum, 2)).toBe(true);
      expect(isValidEnumValue(TestEnum, 3)).toBe(true);
    });

    it("should return false for invalid enum values", () => {
      const TestEnum = { ACTIVE: 1, INACTIVE: 2, PENDING: 3 };

      expect(isValidEnumValue(TestEnum, 0)).toBe(false);
      expect(isValidEnumValue(TestEnum, 4)).toBe(false);
      expect(isValidEnumValue(TestEnum, 999)).toBe(false);
    });
  });

  describe("sanitizeSensitiveData", () => {
    it("should redact sensitive fields", () => {
      const data = {
        username: "john",
        password: "secret123",
        email: "john@example.com",
        token: "abc123",
      };

      const sanitized = sanitizeSensitiveData(data);

      expect(sanitized).toEqual({
        username: "john",
        password: "***REDACTED***",
        email: "john@example.com",
        token: "***REDACTED***",
      });
    });

    it("should handle nested objects", () => {
      const data = {
        user: {
          name: "john",
          credentials: {
            password: "secret123",
            token: "abc123",
          },
        },
      };

      const sanitized = sanitizeSensitiveData(data);

      expect(sanitized).toEqual({
        user: {
          name: "john",
          credentials: {
            password: "***REDACTED***",
            token: "***REDACTED***",
          },
        },
      });
    });

    it("should handle case-insensitive matching", () => {
      const data = {
        Password: "secret",
        TOKEN: "abc",
        mySecretKey: "xyz",
      };

      const sanitized = sanitizeSensitiveData(data);

      expect(sanitized).toEqual({
        Password: "***REDACTED***",
        TOKEN: "***REDACTED***",
        mySecretKey: "***REDACTED***",
      });
    });

    it("should return original data if not an object", () => {
      // @ts-expect-error Testing invalid input
      expect(sanitizeSensitiveData(null)).toBeNull();
      // @ts-expect-error Testing invalid input
      expect(sanitizeSensitiveData(undefined)).toBeUndefined();
      // @ts-expect-error Testing invalid input
      expect(sanitizeSensitiveData("string")).toBe("string");
    });

    it("should not modify non-sensitive fields", () => {
      const data = {
        userId: 123,
        username: "john",
        email: "john@example.com",
        createdAt: "2024-01-01",
      };

      const sanitized = sanitizeSensitiveData(data);

      expect(sanitized).toEqual(data);
    });
  });
});
