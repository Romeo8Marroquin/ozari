/**
 * Human-name formatting helpers, tuned for the Guatemalan naming convention where a full
 * name is typically `[firstName] [secondName?] [firstSurname] [secondSurname?]`.
 *
 * These are display-only (avatar initials, the pill's greeting) — never identity or
 * equality logic. Kept dependency-free and Unicode-aware (accented letters, `ñ`).
 */

/** Split a full name into non-empty, whitespace-trimmed parts. */
const splitParts = (fullName: string): string[] => fullName.trim().split(/\s+/).filter(Boolean);

/**
 * First visible character of a word, uppercased for the local (Spanish) casing rules.
 * Uses `Array.from` so a leading accented grapheme/surrogate pair is taken whole.
 */
const firstLetter = (word: string): string => {
  const [head] = Array.from(word);
  return head ? head.toLocaleUpperCase('es-GT') : '';
};

/**
 * Index of the "primary surname" part to pair with the first name, by how many parts the
 * full name has. The surname's position shifts with the count:
 *   1 → just the one initial
 *   2 → name + surname            → indices 0, 1
 *   3 → first name + last part    → indices 0, 2
 *   4 → first name + first surname (3rd part) → indices 0, 2
 *   5+ → first name + first surname (4th part) → indices 0, 3
 */
const secondInitialIndex = (count: number): number => {
  if (count <= 1) return -1;
  if (count === 2) return 1;
  if (count <= 4) return 2;
  return 3;
};

/**
 * Up to two uppercase initials for an avatar. Follows the GT convention above so
 * "Ana María López Pérez" → "AL", "Juan Pérez" → "JP", "Madonna" → "M".
 * Returns '' for an empty/blank name (callers supply their own fallback glyph).
 */
export const getInitials = (fullName: string): string => {
  const parts = splitParts(fullName);
  if (parts.length === 0) return '';

  const first = firstLetter(parts[0]);
  const secondIdx = secondInitialIndex(parts.length);
  const second = secondIdx >= 0 ? firstLetter(parts[secondIdx]) : '';
  return `${first}${second}`;
};

/** The first given name only (for a compact, friendly greeting in the pill). */
export const getFirstName = (fullName: string): string => splitParts(fullName)[0] ?? '';
