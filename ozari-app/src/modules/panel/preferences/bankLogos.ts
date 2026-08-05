/**
 * The banks we ship a logo for — the mirror of the API's `BANK_KEYS`, and the ONLY values a bank
 * account's `bankKey` may take besides `null`.
 *
 * The key names an ASSET (`src/assets/banks/<key>.png`), which is why it is a fixed list on both
 * sides rather than free text: a typo'd `"banrual"` would save happily and then render nothing on
 * the document, with no error anywhere to explain why. Adding a bank is the file plus BOTH lists,
 * in the same commit.
 *
 * **"Sin logo" (`null`) is always available and is the fallback**, so an account at any other bank
 * is fully usable — it simply prints as text. That is what keeps this closed list from being a
 * restriction on the business.
 *
 * The image files themselves are deliberately NOT imported here. Nothing in the preferences screen
 * draws a logo (the account is identified by the name the admin gave it), so importing them would
 * pull hundreds of KB into the panel bundle to render nothing. The document renderer that actually
 * needs them lazy-loads them alongside itself.
 */
export const BANK_KEYS = ['banrural', 'bac'] as const;

export type BankKey = (typeof BANK_KEYS)[number];

/** The i18n leaf naming a bank (`modules.panel.preferences.banks.<key>`). Kept as a function rather
 *  than a map so a key added to `BANK_KEYS` needs only its string, exactly like a setting's. */
export const bankLabelKey = (key: string): string => `modules.panel.preferences.banks.${key}`;
