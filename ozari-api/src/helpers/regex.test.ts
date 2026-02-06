import { describe, it, expect } from "vitest";
import {
  descriptionTextRegex,
  fullNameRegex,
  emailRegex,
  passwordRegex,
  genericUuidRegex,
  genericHttpsUrlRegex,
} from "./regex.js";

describe("Regex Patterns", () => {
  describe("descriptionTextRegex", () => {
    it("should match valid descriptions", () => {
      expect(descriptionTextRegex.test("This is a valid description.")).toBe(
        true,
      );
      expect(descriptionTextRegex.test("Product with numbers 123!")).toBe(true);
      expect(descriptionTextRegex.test("Multi-line text: works (great)")).toBe(
        true,
      );
    });

    it("should reject descriptions outside length bounds", () => {
      expect(descriptionTextRegex.test("Tiny")).toBe(false);
      expect(descriptionTextRegex.test("a".repeat(501))).toBe(false);
    });

    it("should reject invalid characters", () => {
      expect(descriptionTextRegex.test("Invalid @#$% chars")).toBe(false);
      expect(descriptionTextRegex.test("Text with <script>")).toBe(false);
    });
  });

  describe("fullNameRegex", () => {
    it("should match valid full names", () => {
      expect(fullNameRegex.test("John Doe")).toBe(true);
      expect(fullNameRegex.test("María José García")).toBe(true);
      expect(fullNameRegex.test("O'Connor-Smith")).toBe(true);
    });

    it("should reject names outside length bounds", () => {
      expect(fullNameRegex.test("A B")).toBe(false);
      expect(fullNameRegex.test("a".repeat(256))).toBe(false);
    });

    it("should reject invalid characters", () => {
      expect(fullNameRegex.test("John@Doe")).toBe(false);
      expect(fullNameRegex.test("Name#Test")).toBe(false);
    });
  });

  describe("emailRegex", () => {
    it("should match valid email addresses", () => {
      expect(emailRegex.test("user@example.com")).toBe(true);
      expect(emailRegex.test("test.user+tag@domain.co.uk")).toBe(true);
      expect(emailRegex.test("name_123@company-name.com")).toBe(true);
    });

    it("should reject invalid email formats", () => {
      expect(emailRegex.test("invalid.email")).toBe(false);
      expect(emailRegex.test("@domain.com")).toBe(false);
      expect(emailRegex.test("user@.com")).toBe(false);
      expect(emailRegex.test("user@domain")).toBe(false);
    });
  });

  describe("passwordRegex", () => {
    it("should match valid passwords", () => {
      expect(passwordRegex.test("Not_A_Real_Password123!")).toBe(true);
      expect(passwordRegex.test("Not_A_Real_Password2024")).toBe(true);
      expect(passwordRegex.test("Not_A_Real_Pwd3!defGHI")).toBe(true);
    });

    it("should reject passwords without required character types", () => {
      expect(passwordRegex.test("nouppercase123!")).toBe(false);
      expect(passwordRegex.test("NOLOWERCASE123!")).toBe(false);
      expect(passwordRegex.test("NoNumbers!")).toBe(false);
      expect(passwordRegex.test("NoSpecialChar123")).toBe(false);
    });

    it("should reject passwords outside length bounds", () => {
      expect(passwordRegex.test("Short1!")).toBe(false);
      expect(passwordRegex.test("A1!" + "a".repeat(126))).toBe(false);
    });
  });

  describe("genericUuidRegex", () => {
    it("should match valid UUIDs", () => {
      expect(
        genericUuidRegex.test("550e8400-e29b-41d4-a716-446655440000"),
      ).toBe(true);
      expect(
        genericUuidRegex.test("6ba7b810-9dad-11d1-80b4-00c04fd430c8"),
      ).toBe(true);
      expect(
        genericUuidRegex.test("123E4567-E89B-12D3-A456-426614174000"),
      ).toBe(true);
    });

    it("should reject invalid UUID formats", () => {
      expect(genericUuidRegex.test("not-a-uuid")).toBe(false);
      expect(genericUuidRegex.test("550e8400-e29b-41d4-a716")).toBe(false);
      expect(
        genericUuidRegex.test("550e8400-e29b-41d4-a716-44665544000G"),
      ).toBe(false);
    });
  });

  describe("genericHttpsUrlRegex", () => {
    it("should match valid HTTPS URLs", () => {
      expect(genericHttpsUrlRegex.test("https://example.com")).toBe(true);
      expect(genericHttpsUrlRegex.test("https://sub.domain.com:8080")).toBe(
        true,
      );
      expect(
        genericHttpsUrlRegex.test("https://example.com/path/to/resource"),
      ).toBe(true);
    });

    it("should reject non-HTTPS URLs", () => {
      expect(genericHttpsUrlRegex.test("http://example.com")).toBe(false);
      expect(genericHttpsUrlRegex.test("ftp://example.com")).toBe(false);
    });

    it("should reject invalid URL formats", () => {
      expect(genericHttpsUrlRegex.test("https://")).toBe(false);
      expect(genericHttpsUrlRegex.test("not-a-url")).toBe(false);
    });
  });
});
