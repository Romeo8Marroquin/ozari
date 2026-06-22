import { describe, it, expect } from "vitest";
import {
  base32Decode,
  base32Encode,
  buildOtpauthUri,
  generateRecoveryCodes,
  generateTotp,
  generateTotpSecret,
  getTotpStep,
  verifyTotp,
} from "./totp.js";

// RFC 6238 reference secret (ASCII "12345678901234567890") for SHA1 vectors.
const RFC_SECRET = base32Encode(Buffer.from("12345678901234567890", "ascii"));

describe("base32", () => {
  it("round-trips arbitrary bytes", () => {
    const buffer = Buffer.from("Hello, Ozari MFA!", "utf8");
    expect(base32Decode(base32Encode(buffer)).equals(buffer)).toBe(true);
  });

  it("ignores casing and padding", () => {
    const encoded = base32Encode(Buffer.from([1, 2, 3, 4, 5]));
    expect(base32Decode(encoded.toLowerCase())).toEqual(base32Decode(encoded));
  });

  it("rejects invalid characters", () => {
    expect(() => base32Decode("0189!")).toThrow();
  });
});

describe("generateTotp (RFC 6238 SHA1 vectors)", () => {
  const vectors: Array<[number, string]> = [
    [59, "287082"],
    [1111111109, "081804"],
    [1111111111, "050471"],
    [1234567890, "005924"],
    [2000000000, "279037"],
    [20000000000, "353130"],
  ];

  for (const [seconds, expected] of vectors) {
    it(`matches the reference code at t=${seconds}s`, () => {
      expect(generateTotp(RFC_SECRET, getTotpStep(seconds * 1000))).toBe(
        expected,
      );
    });
  }
});

describe("verifyTotp", () => {
  it("accepts the current code and reports its step", () => {
    const secret = generateTotpSecret();
    const step = getTotpStep(Date.now());
    const code = generateTotp(secret, step);
    expect(verifyTotp(secret, code, step)).toEqual({ valid: true, step });
  });

  it("accepts a code from the previous step (clock drift window)", () => {
    const secret = generateTotpSecret();
    const step = getTotpStep(Date.now());
    const previous = generateTotp(secret, step - 1);
    expect(verifyTotp(secret, previous, step)).toEqual({
      valid: true,
      step: step - 1,
    });
  });

  it("rejects an out-of-window code", () => {
    const secret = generateTotpSecret();
    const step = getTotpStep(Date.now());
    const stale = generateTotp(secret, step - 5);
    expect(verifyTotp(secret, stale, step).valid).toBe(false);
  });

  it("rejects non-numeric input", () => {
    expect(verifyTotp(generateTotpSecret(), "abc123").valid).toBe(false);
  });
});

describe("secrets, recovery codes and otpauth uri", () => {
  it("generates decodable base32 secrets", () => {
    expect(() => base32Decode(generateTotpSecret())).not.toThrow();
  });

  it("generates the configured number of unique recovery codes", () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes.every((code) => /^[A-Z2-7]{16}$/.test(code))).toBe(true);
  });

  it("builds an otpauth uri with the secret and issuer", () => {
    const secret = generateTotpSecret();
    const uri = buildOtpauthUri(secret, "user@example.com");
    expect(uri.startsWith("otpauth://totp/")).toBe(true);
    expect(uri).toContain(`secret=${secret}`);
    expect(uri).toContain("issuer=Ozari");
  });
});
