/**
 * GEOGRAPHIC COORDINATES — the optional pin that can be attached to an address.
 *
 * The pin is **always optional and never authoritative**: the delivery ADDRESS TEXT is what the
 * business runs on (a driver can find "Salón del club, entrada norte" without a map), and the pin
 * only makes the last hundred metres unambiguous. Every consumer must keep working when it is
 * absent — the maps button falls back to searching the text.
 *
 * It is PII, so it is stored AES-encrypted like the address it belongs to (`*_kms` columns), which
 * is why it travels as a TEXT payload rather than as two numeric columns: `"lat,lng"` in, one
 * ciphertext out. That also keeps a future geo capability open — the day spacing becomes
 * travel-time aware (EPIC-2-ORDERS §6b), decoding these two numbers is all it needs.
 *
 * The frontend mirrors this contract in `ozari-app/src/utils/geo.ts`; the two must accept and
 * reject exactly the same values (the mirrored-validators doctrine).
 */

export interface CoordsModel {
  lat: number;
  lng: number;
}

const LAT_ABS_MAX = 90;
const LNG_ABS_MAX = 180;

/**
 * Six decimals ≈ 11 cm — far finer than any delivery needs, and deliberately COARSER than the float
 * a dragged map pin produces. Rounding at the boundary keeps the stored value stable, so re-saving
 * an untouched order doesn't churn its ciphertext (and a diff of two snapshots means something).
 */
export const COORDS_DECIMALS = 6;
const FACTOR = 10 ** COORDS_DECIMALS;

const roundCoord = (value: number): number => Math.round(value * FACTOR) / FACTOR;

const isFiniteInRange = (value: unknown, absMax: number): value is number =>
  typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= absMax;

/** Is this a usable pin? Rejects NaN/Infinity (which `typeof` calls a number) and out-of-globe. */
export function isValidCoords(value: unknown): value is CoordsModel {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    isFiniteInRange(candidate["lat"], LAT_ABS_MAX) &&
    isFiniteInRange(candidate["lng"], LNG_ABS_MAX)
  );
}

/**
 * The validator door: `undefined`/`null` are LEGAL (no pin — the normal case), a valid pair is
 * accepted and rounded, and anything else is a clean rejection rather than a silently dropped
 * field. Returning `{ ok }` mirrors `sanitizeOptionalId` in the orders validator.
 */
export function sanitizeCoords(
  raw: unknown,
): { ok: true; value: CoordsModel | undefined } | { ok: false } {
  if (raw === undefined || raw === null) {
    return { ok: true, value: undefined };
  }
  if (!isValidCoords(raw)) {
    return { ok: false };
  }
  return { ok: true, value: { lat: roundCoord(raw.lat), lng: roundCoord(raw.lng) } };
}

/** Storage form — one string to encrypt. */
export function encodeCoords(coords: CoordsModel): string {
  return `${coords.lat},${coords.lng}`;
}

/**
 * Storage → domain. Deliberately TOTAL: a corrupt, hand-edited or legacy value reads as "no pin"
 * (`undefined`), never as `NaN` — which would reach a map component and render nowhere, or reach a
 * maps deep link and send a driver to the middle of the ocean.
 */
export function decodeCoords(text: string | null | undefined): CoordsModel | undefined {
  if (!text) {
    return undefined;
  }
  const [rawLat, rawLng, ...rest] = text.split(",");
  if (rawLng === undefined || rest.length > 0) {
    return undefined;
  }
  const candidate = { lat: Number(rawLat), lng: Number(rawLng) };
  // `Number("")` is 0, so an empty part would otherwise decode as a valid equator pin.
  if (rawLat?.trim() === "" || rawLng.trim() === "" || !isValidCoords(candidate)) {
    return undefined;
  }
  return candidate;
}
