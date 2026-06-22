import crypto from "node:crypto";
import { URLSearchParams } from "node:url";
import { appConfig } from "@/config/app.js";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";

  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }

  return output;
}

export function base32Decode(input: string): Buffer {
  const normalized = input.toUpperCase().replace(/=+$/, "").replace(/\s/g, "");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (const char of normalized) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) {
      throw new Error("Invalid base32 character");
    }
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}

export function generateTotpSecret(): string {
  return base32Encode(crypto.randomBytes(appConfig.mfa.secretBytes));
}

export function getTotpStep(timestampMs: number): number {
  return Math.floor(timestampMs / 1000 / appConfig.mfa.totpStepSeconds);
}

function generateHotp(secret: Buffer, counter: number, digits: number): string {
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));

  const hmac = crypto.createHmac("sha1", secret).update(counterBuffer).digest();
  const offset = hmac.readUInt8(hmac.length - 1) & 0x0f;
  const binary = hmac.readUInt32BE(offset) & 0x7fffffff;

  return (binary % 10 ** digits).toString().padStart(digits, "0");
}

export function generateTotp(
  secretBase32: string,
  step: number = getTotpStep(Date.now()),
  digits: number = appConfig.mfa.totpDigits,
): string {
  return generateHotp(base32Decode(secretBase32), step, digits);
}

export function verifyTotp(
  secretBase32: string,
  token: string,
  currentStep: number = getTotpStep(Date.now()),
): { valid: boolean; step: number } {
  const sanitized = token.replace(/\s/g, "");
  if (!/^\d+$/.test(sanitized)) {
    return { valid: false, step: currentStep };
  }

  const secret = base32Decode(secretBase32);
  const { totpDigits, totpWindow } = appConfig.mfa;

  for (let offset = -totpWindow; offset <= totpWindow; offset++) {
    const step = currentStep + offset;
    const expected = generateHotp(secret, step, totpDigits);
    if (
      expected.length === sanitized.length &&
      crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sanitized))
    ) {
      return { valid: true, step };
    }
  }

  return { valid: false, step: currentStep };
}

export function buildOtpauthUri(secretBase32: string, account: string): string {
  const label = encodeURIComponent(`${appConfig.mfa.issuerLabel}:${account}`);
  const params = new URLSearchParams({
    secret: secretBase32,
    issuer: appConfig.mfa.issuerLabel,
    algorithm: "SHA1",
    digits: String(appConfig.mfa.totpDigits),
    period: String(appConfig.mfa.totpStepSeconds),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

export function generateRecoveryCodes(
  count: number = appConfig.mfa.recoveryCodeCount,
): string[] {
  return Array.from({ length: count }, () =>
    base32Encode(crypto.randomBytes(10)).slice(0, 16),
  );
}
