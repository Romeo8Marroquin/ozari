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
