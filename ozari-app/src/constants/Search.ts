/**
 * How long typing settles before a search commits — **ONE value for every search box in the app**,
 * so the product grid and the location picker feel like the same product rather than two widgets
 * with different reflexes.
 *
 * Generous on purpose: a short pause mid-phrase must NOT fire a search yet. Each caller keeps its
 * own "search now" fast path (Enter on the product filter; picking a result in the map picker).
 *
 * It also happens to be the number that keeps the location search inside Nominatim's 1 req/s usage
 * policy — so if this is ever lowered, `utils/geocode.ts` needs its own floor rather than a shared
 * value that quietly breaks somebody's terms of use.
 */
export const SEARCH_DEBOUNCE_MS = 600;
