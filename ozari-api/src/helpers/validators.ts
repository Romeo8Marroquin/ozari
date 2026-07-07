import { z } from "zod";
import { fullNameRegex, passwordRegex } from "./regex.js";

/**
 * Canonical validation policy — the single source of truth for the backend.
 *
 * These rules MUST stay in sync with the frontend mirror in
 * `ozari-app/src/constants/Regex.ts` and `ozari-app/src/utils/formFields.ts`.
 * Both sides must accept and reject exactly the same values. The backend is the
 * security boundary; the frontend copy exists only for UX. When a rule changes
 * here, change it there too.
 *
 * Password policy: 12–128 chars, at least one lowercase, one uppercase, one
 * digit and one symbol. The allowed character set is all printable ASCII except
 * space (every keyboard symbol is fine); spaces, control characters and non-ASCII
 * (accents/emoji) are rejected (enforced by `passwordRegex`).
 */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;
export const EMAIL_MAX_LENGTH = 254; // RFC 5321 maximum total length

/** Trimmed, lowercased, RFC-shaped email capped at the RFC 5321 maximum. */
export const emailField = z
  .string()
  .trim()
  .toLowerCase()
  .max(EMAIL_MAX_LENGTH, "Email format is invalid")
  .email("Email format is invalid");

/** Strong password matching the shared composition + length policy. */
export const passwordField = z
  .string()
  .min(PASSWORD_MIN_LENGTH, "Password format is invalid")
  .max(PASSWORD_MAX_LENGTH, "Password format is invalid")
  .regex(passwordRegex, "Password format is invalid");

/** Human full name (letters incl. accents, digits, spaces, apostrophe, hyphen). */
export const fullNameField = z
  .string()
  .trim()
  .min(1, "Full name is required")
  .regex(fullNameRegex, "Full name format is invalid");
