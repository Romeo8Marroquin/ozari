/**
 * GEOGRAPHIC COORDINATES — the frontend mirror of `ozari-api/src/helpers/geo.ts`.
 *
 * The two must accept and reject exactly the same values (the mirrored-validators doctrine): the
 * backend is the security boundary, this copy exists so the admin is told immediately instead of on
 * submit. Change one, change the other in the same commit.
 *
 * The pin is ALWAYS optional. The address TEXT is what the business runs on — a driver finds "Salón
 * del club, entrada norte" without a map — and the pin only removes the last-hundred-metres
 * ambiguity. Nothing here may ever become required.
 */

export interface Coords {
  lat: number;
  lng: number;
}

const LAT_ABS_MAX = 90;
const LNG_ABS_MAX = 180;
/** 6 decimals ≈ 11 cm — mirrors `COORDS_DECIMALS` on the API. */
export const COORDS_DECIMALS = 6;
const FACTOR = 10 ** COORDS_DECIMALS;

const inRange = (value: number, absMax: number): boolean =>
  Number.isFinite(value) && Math.abs(value) <= absMax;

/** Rounds to the stored precision, so what the map shows is exactly what the server will keep. */
export const roundCoords = (coords: Coords): Coords => ({
  lat: Math.round(coords.lat * FACTOR) / FACTOR,
  lng: Math.round(coords.lng * FACTOR) / FACTOR,
});

export function isValidCoords(value: unknown): value is Coords {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { lat?: unknown; lng?: unknown };
  return (
    typeof candidate.lat === 'number' &&
    typeof candidate.lng === 'number' &&
    inRange(candidate.lat, LAT_ABS_MAX) &&
    inRange(candidate.lng, LNG_ABS_MAX)
  );
}

/** How a pin reads in the UI when we have to show the raw numbers (the field's value line). */
export const formatCoords = (coords: Coords): string =>
  `${coords.lat.toFixed(COORDS_DECIMALS)}, ${coords.lng.toFixed(COORDS_DECIMALS)}`;

/**
 * Everything an admin might realistically PASTE into the manual field, resolved to a pin.
 *
 * This exists because the fastest path to an exact location is usually a phone: someone is already
 * standing at the venue with Google Maps open, and "share" gives them a link. Making them read two
 * numbers off a screen and retype them would be the slowest possible flow, and typo-prone in a way
 * that silently sends a driver somewhere plausible but wrong.
 *
 * Handles: bare `lat, lng` (with or without the space, and the `lat lng` a copy sometimes yields),
 * Google Maps' `@lat,lng,z` path and `?q=`/`?query=`/`?destination=`/`!3dlat!4dlng` forms, Waze's
 * `?ll=`, and Apple's `?ll=`/`?q=`. Anything else returns `undefined` — including SHORTENED links
 * (`maps.app.goo.gl/…`), which carry no coordinates at all until a server follows the redirect;
 * the UI has to say so rather than pretend it failed to parse.
 */
export function parseCoordsInput(raw: string): Coords | undefined {
  const text = raw.trim();
  if (text === '') return undefined;

  const candidates: Array<[string, string]> = [];
  const push = (lat: string | undefined, lng: string | undefined): void => {
    if (lat !== undefined && lng !== undefined) candidates.push([lat, lng]);
  };

  // ORDER IS PRECEDENCE — the first candidate that is actually on the globe wins, so the most
  // authoritative reading of the paste has to come first. A Google place URL carries BOTH the exact
  // pin and the camera centre, and they differ by a block or two; picking the wrong one puts the
  // driver on the wrong side of the street with no sign that anything went wrong.

  // 1. A bare pair — the user typed exactly this, so there is nothing to interpret. Also the only
  //    form that may use a bare space separator.
  const bare = /^(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)$/u.exec(text);
  push(bare?.[1], bare?.[2]);
  // 2. The exact place pin Google embeds in a place URL: !3d<lat>!4d<lng>.
  const bang = /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/u.exec(text);
  push(bang?.[1], bang?.[2]);
  // 3. An explicit destination/query parameter (Google `q`/`query`/`destination`, Waze/Apple `ll`).
  const param = /[?&](?:q|query|ll|destination|daddr|sll)=(-?\d+(?:\.\d+)?)(?:,|%2C)(-?\d+(?:\.\d+)?)/iu.exec(text);
  push(param?.[1], param?.[2]);
  // 4. Last resort: the map CAMERA in the path (`/@lat,lng,17z`) — where the screenshot was taken,
  //    not necessarily what was being pointed at.
  const at = /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/u.exec(text);
  push(at?.[1], at?.[2]);

  for (const [lat, lng] of candidates) {
    const coords = { lat: Number(lat), lng: Number(lng) };
    if (isValidCoords(coords)) return roundCoords(coords);
  }
  return undefined;
}

/** Does this look like a shortened maps link? Those carry no coordinates until something follows
 *  the redirect, so the UI explains that instead of showing a generic "couldn't read that". */
export const isShortMapsLink = (raw: string): boolean =>
  /(?:maps\.app\.goo\.gl|goo\.gl\/maps|g\.co\/kgs)/iu.test(raw.trim());
