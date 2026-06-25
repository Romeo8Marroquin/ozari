export const SYMBOLS = '!@#$%^&*_-+=?,:;';

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
export const SAFE_SYMBOL_REGEX = /[!@#$%^&*_\-+=?,:;]/;

export const UNSAFE_SYMBOL_REGEX = /[^A-Za-z0-9!@#$%^&*_\-+=?,:;]/;

// Combined password policy (mirrors the backend `passwordRegex`). The granular
// regexes above compose to the same accept/reject set; this stays as a single
// source-of-truth reference for the full rule.
export const PASSWORD_REGEX =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*_\-+=?,:;])[A-Za-z\d!@#$%^&*_\-+=?,:;]{12,128}$/;
