/**
 * The longest `url` `GET /documents/image` accepts. A URL this app writes is the public base plus a
 * ~60-character key; this is generous headroom that still refuses a query built to be huge.
 */
export const DOCUMENT_IMAGE_URL_MAX_LENGTH = 2048;

/**
 * How a served photo may be cached: by THIS browser only (`private` — the response answers an
 * authenticated request, so no shared cache may keep it), for a day, and never revalidated
 * (`immutable`). Safe because every key is a fresh UUID: a replaced photo gets a NEW key and URL, so
 * a cached copy can never be stale. A second download of the same document re-uses the photos
 * instead of asking for them again.
 */
export const DOCUMENT_IMAGE_CACHE_CONTROL = "private, max-age=86400, immutable";

/** Requests per minute per IP. A document asks once per DISTINCT photo, and a long order can hold
 *  dozens, so this route does not share the 100/min authenticated tier the rest of the panel
 *  spends — a big document must never starve, or be starved by, ordinary navigation. */
export const DOCUMENT_IMAGE_RATE_LIMIT = 300;
