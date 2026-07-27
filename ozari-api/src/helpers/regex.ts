export const descriptionTextRegex =
  /^(?=.{5,500}$)[A-Za-zÀ-ÖØ-öø-ÿ0-9\s.,!?():-]+$/;

export const fullNameRegex = /^(?=.{5,255}$)[A-Za-zÀ-ÖØ-öø-ÿ0-9\s'-]+$/;

export const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

// Registry contact phone: allowed characters (digits + the usual separators) plus a digit COUNT
// within [7, 15] (E.164 upper bound). Mirrors the frontend `isValidContactPhone` (constants/Regex.ts).
const contactPhoneCharsRegex = /^[+\d\s()-]+$/;
export const CONTACT_PHONE_MIN_DIGITS = 7;
export const CONTACT_PHONE_MAX_DIGITS = 15;
export const isValidContactPhone = (value: string): boolean => {
  if (!contactPhoneCharsRegex.test(value)) {
    return false;
  }
  const digits = value.replace(/\D/g, "").length;
  return digits >= CONTACT_PHONE_MIN_DIGITS && digits <= CONTACT_PHONE_MAX_DIGITS;
};

// Password: 12–128 chars, at least one lowercase, one uppercase, one digit and one symbol (any
// non-alphanumeric). The character set is all printable ASCII EXCEPT space (`\x21`–`\x7E`), so every
// keyboard symbol is allowed — passwords are bcrypt-hashed (never in SQL), so the restriction is a
// policy choice, not an injection defence; we only exclude spaces, control characters and non-ASCII
// (accents/emoji) to avoid whitespace footguns and byte/normalisation ambiguity.
export const passwordRegex =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d])[\x21-\x7E]{12,128}$/;

export const genericUuidRegex =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const genericHttpsUrlRegex =
  // eslint-disable-next-line security/detect-unsafe-regex -- Safe regex: no exponential backtracking, fixed length constraints
  /^https:\/\/(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}(?::\d+)?(?:\/\S*)?$/;
