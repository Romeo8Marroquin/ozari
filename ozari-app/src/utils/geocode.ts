import { SEARCH_DEBOUNCE_MS } from '@constants/Search';
import { isValidCoords, roundCoords, type Coords } from './geo';

/**
 * PLACE SEARCH — OpenStreetMap's Nominatim, the free companion to the OSM tiles the picker draws.
 *
 * Their usage policy is a real constraint, not a formality (abuse gets an IP blocked), so it is
 * honoured HERE rather than left to each caller:
 * - **At most 1 request/second.** The caller debounces (`SEARCH_DEBOUNCE_MS`) and aborts the
 *   in-flight request on every keystroke, so a fast typist produces one request, not twelve.
 * - **A minimum query length**, so a single stray character never becomes a request at all.
 * - **Identifiable traffic**: a browser can't set `User-Agent`, but it always sends `Referer`, which
 *   is what Nominatim asks browser apps to be identified by.
 *
 * Biased to Guatemala (`countrycodes=gt`) because that is where this business delivers, and an
 * unbiased search for "zona 10" returns results on three continents. Somewhere abroad is still
 * reachable by dropping the pin or pasting coordinates — search is a convenience, never the only
 * way in.
 */
const ENDPOINT = 'https://nominatim.openstreetmap.org/search';

/** Below this, a query is a typo in progress rather than a search. */
export const SEARCH_MIN_LENGTH = 3;
/** The app's ONE search debounce (`@constants/Search`) — the same pause the product grid uses, and
 *  comfortably above Nominatim's 1 req/s ceiling. Re-exported so callers import it from the module
 *  whose policy depends on it. */
export { SEARCH_DEBOUNCE_MS };
const RESULT_LIMIT = 5;

export interface PlaceResult {
  /** Stable id for React keys — Nominatim's own `place_id`. */
  id: string;
  /** The full human-readable name ("Salón El Roble, Zona 10, Ciudad de Guatemala"). */
  label: string;
  coords: Coords;
}

/** The query URL — pure, so the policy parameters are pinned by a test instead of by review. */
export function buildSearchUrl(query: string): string {
  const params = new URLSearchParams({
    q: query,
    format: 'jsonv2',
    limit: String(RESULT_LIMIT),
    countrycodes: 'gt',
    'accept-language': 'es',
  });
  return `${ENDPOINT}?${params.toString()}`;
}

/** Maps a Nominatim payload to our shape, DROPPING anything malformed rather than trusting it —
 *  a result without usable coordinates would put a pin nowhere and look like our bug. */
export function toPlaceResults(payload: unknown): PlaceResult[] {
  if (!Array.isArray(payload)) return [];
  const results: PlaceResult[] = [];
  for (const raw of payload) {
    if (typeof raw !== 'object' || raw === null) continue;
    const row = raw as Record<string, unknown>;
    const coords = { lat: Number(row['lat']), lng: Number(row['lon']) };
    const label = typeof row['display_name'] === 'string' ? row['display_name'] : '';
    if (label === '' || !isValidCoords(coords)) continue;
    results.push({
      id: String(row['place_id'] ?? `${coords.lat},${coords.lng}`),
      label,
      coords: roundCoords(coords),
    });
  }
  return results;
}

/**
 * Runs a search. Returns `[]` for anything too short and for ANY failure — a place search that
 * cannot reach the network must degrade to "no results", never to a thrown error that breaks the
 * dialog: the map, the pin and the manual entry all still work without it.
 */
export async function searchPlaces(query: string, signal?: AbortSignal): Promise<PlaceResult[]> {
  const trimmed = query.trim();
  if (trimmed.length < SEARCH_MIN_LENGTH) return [];
  try {
    const response = await fetch(buildSearchUrl(trimmed), {
      ...(signal ? { signal } : {}),
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return [];
    return toPlaceResults(await response.json());
  } catch {
    // Includes the AbortError of a superseded keystroke, which is a normal event, not a problem.
    return [];
  }
}
