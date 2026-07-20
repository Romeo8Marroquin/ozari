// Canonical validation policy — keep in sync with the backend
// (ozari-api/src/helpers/regex.ts + validators.ts). Both sides must accept and
// reject exactly the same values; the backend is the security boundary.
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;
export const EMAIL_MAX_LENGTH = 254; // RFC 5321 maximum total length
export const FULLNAME_MIN_LENGTH = 5;
export const FULLNAME_MAX_LENGTH = 255;

// Mirrors the backend `fullNameRegex` (ozari-api/src/helpers/regex.ts): letters
// incl. accents, digits, spaces, apostrophe and hyphen, 5–255 chars total.
export const FULLNAME_REGEX = /^(?=.{5,255}$)[A-Za-zÀ-ÖØ-öø-ÿ0-9\s'-]+$/;

export const UPPER_REGEX = /[A-Z]/;
export const LOWER_REGEX = /[a-z]/;
export const NUMBER_REGEX = /\d/;

// Password symbols are permissive now: ANY printable-ASCII non-alphanumeric char
// counts as a valid "symbol". `SAFE_SYMBOL_REGEX` = "has at least one symbol";
// `UNSAFE_SYMBOL_REGEX` = "has a character outside printable ASCII" (space,
// control characters, accents, emoji) — the only things we reject.
export const SAFE_SYMBOL_REGEX = /[^A-Za-z0-9]/;
export const UNSAFE_SYMBOL_REGEX = /[^\x21-\x7E]/;

// Combined password policy (mirrors the backend `passwordRegex`): 12–128 chars,
// ≥1 lowercase, ≥1 uppercase, ≥1 digit, ≥1 symbol, and every character is
// printable ASCII except space. Passwords are bcrypt-hashed (never in SQL), so
// the character set is a policy/UX choice, not an injection defence.
export const PASSWORD_REGEX =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d])[\x21-\x7E]{12,128}$/;

// ── Product form policy — mirrors the backend product validator ─────────────────────────────
// (`ozari-api/src/modules/products/products.validator.ts` + `regex.ts` + `config/app.ts`).
// A product/detail NAME reuses the backend's `fullNameRegex` → `FULLNAME_REGEX` above.
// Free-text description: 5–500 chars of letters (incl. accents), digits, spaces and .,!?():-
export const PRODUCT_DESCRIPTION_REGEX = /^(?=.{5,500}$)[A-Za-zÀ-ÖØ-öø-ÿ0-9\s.,!?():-]+$/;
// Money and quantity ceilings — mirror `appConfig.maxGlobalAmount` / `maxGlobalQuantity`.
export const PRODUCT_MAX_AMOUNT = 1000000;
export const PRODUCT_MAX_QUANTITY = 5000;

// Gallery upload policy — mirrors `appConfig.storage` (the backend re-enforces all of it: the
// content type + exact size are bound INTO each presigned URL, and the create endpoint caps images).
export const PRODUCT_IMAGE_MAX_COUNT = 8;
export const PRODUCT_IMAGE_MAX_BYTES = 5 * 1024 * 1024; // 5 MB
export const PRODUCT_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'];

// ── Order + client-registry form policy — mirrors the backend order/registry validators ──────
// (`ozari-api/src/modules/orders/orders.validator.ts` + `clientRegistries.validator.ts` +
// `config/app.ts`). The backend is the security boundary; these are the UX mirror.
export const ORDER_MAX_LINES = 50; // appConfig.maxOrderLines
// A delivery/registry snapshot name & a contact value: 2–255 chars (looser than the account
// full-name policy — a walk-in "name" can be anything the admin jots down). Free-text: any
// non-control character (the backend only length-bounds these, so we match that).
export const ORDER_TEXT_MIN_LENGTH = 2;
export const ORDER_TEXT_MAX_LENGTH = 255;
// A delivery/registry ADDRESS: 5–500 chars. Free-text notes/description/comment: up to 500.
export const ORDER_ADDRESS_MIN_LENGTH = 5;
export const ORDER_LONGTEXT_MAX_LENGTH = 500;
// Money + per-line quantity reuse the product ceilings (`maxGlobalAmount` / `maxGlobalQuantity`).
