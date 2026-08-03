import { describe, expect, it } from "vitest";
import {
  decodeCoords,
  encodeCoords,
  isValidCoords,
  sanitizeCoords,
} from "./geo.js";

describe("isValidCoords", () => {
  it("accepts a pin anywhere on the globe, including the extremes", () => {
    expect(isValidCoords({ lat: 14.6349, lng: -90.5069 })).toBe(true); // Guatemala City
    expect(isValidCoords({ lat: 0, lng: 0 })).toBe(true);
    expect(isValidCoords({ lat: -90, lng: 180 })).toBe(true);
  });

  it("rejects everything that is not a real pair of finite, in-range numbers", () => {
    // `typeof NaN === "number"`, which is exactly how a NaN reaches a map and renders nowhere.
    expect(isValidCoords({ lat: Number.NaN, lng: 0 })).toBe(false);
    expect(isValidCoords({ lat: 0, lng: Number.POSITIVE_INFINITY })).toBe(false);
    expect(isValidCoords({ lat: 91, lng: 0 })).toBe(false);
    expect(isValidCoords({ lat: 0, lng: -181 })).toBe(false);
    expect(isValidCoords({ lat: "14.6", lng: "-90.5" })).toBe(false);
    expect(isValidCoords({ lat: 14.6 })).toBe(false);
    expect(isValidCoords(null)).toBe(false);
    expect(isValidCoords("14.6,-90.5")).toBe(false);
  });
});

describe("sanitizeCoords", () => {
  it("treats an ABSENT pin as legal — the normal case, not an error", () => {
    expect(sanitizeCoords(undefined)).toEqual({ ok: true, value: undefined });
    expect(sanitizeCoords(null)).toEqual({ ok: true, value: undefined });
  });

  it("rounds to ~11 cm so a dragged pin's float noise never reaches storage", () => {
    expect(
      sanitizeCoords({ lat: 14.634915123456789, lng: -90.506882987654321 }),
    ).toEqual({ ok: true, value: { lat: 14.634915, lng: -90.506883 } });
  });

  it("rejects a malformed pin instead of silently dropping the field", () => {
    expect(sanitizeCoords({ lat: 200, lng: 0 }).ok).toBe(false);
    expect(sanitizeCoords({ lat: "x", lng: 0 }).ok).toBe(false);
    expect(sanitizeCoords(42).ok).toBe(false);
  });
});

describe("encodeCoords / decodeCoords", () => {
  it("round-trips through the single string that gets encrypted", () => {
    const coords = { lat: 14.634915, lng: -90.506883 };
    expect(encodeCoords(coords)).toBe("14.634915,-90.506883");
    expect(decodeCoords(encodeCoords(coords))).toEqual(coords);
  });

  it("reads anything unusable as NO PIN — never as NaN", () => {
    // A NaN pin is worse than none: it renders nowhere on a map and sends a deep link to the ocean.
    expect(decodeCoords(null)).toBeUndefined();
    expect(decodeCoords(undefined)).toBeUndefined();
    expect(decodeCoords("")).toBeUndefined();
    expect(decodeCoords("14.634915")).toBeUndefined();
    expect(decodeCoords("14.634915,-90.5,12")).toBeUndefined();
    expect(decodeCoords("norte,sur")).toBeUndefined();
    expect(decodeCoords("200,0")).toBeUndefined();
    // `Number("")` is 0, so a half-empty value would otherwise decode as a valid equator pin.
    expect(decodeCoords("14.6,")).toBeUndefined();
    expect(decodeCoords(",-90.5")).toBeUndefined();
  });
});
