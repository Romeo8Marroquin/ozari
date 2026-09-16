/**
 * NUMERIC TEXT FIELDS — one rule for every field in the app that holds a number.
 *
 * ## Why these are `type="text"` and not `type="number"`
 *
 * Every numeric field here is held in form state as a STRING and parsed by the mirrored Zod schema
 * (`parseLineQuantity`, `parseMoney`, the preferences' own parse). Given that, `type="number"` buys
 * nothing and costs four real things:
 *
 * 1. **It blanks what the user typed.** A `type="number"` input whose content the browser cannot
 *    parse (`1.2.3`, `1e`, `--`, or a `,` in a locale that does not use it) reports `value === ''`
 *    while still SHOWING the text. The form then stores `''`, so the field looks filled and the
 *    error says "requerido" — or, worse, a save goes out with the value silently missing.
 * 2. **The scroll wheel edits it.** A focused number input converts a trackpad scroll into an
 *    increment, so scrolling past a half-filled order form quietly changes a price.
 * 3. **It fights the form's own validation.** `min`/`max`/`step` are constraint-validation
 *    attributes: the browser blocks the submit with its own untranslated bubble, and our mirrored
 *    message — and the `touched` flip that reveals it — never runs (the trap `PreferenceRowForm`
 *    documents, and the reason the bounds live in Zod instead of on the element).
 * 4. **The caret cannot be placed.** `setSelectionRange` throws on a number input, so filtering the
 *    value means always dropping the cursor at the end.
 *
 * The mobile keyboard — the thing `type="number"` is usually kept for — comes from `inputMode`,
 * which is what actually drives it on iOS and Android: `numeric` is a digits-only pad, `decimal`
 * is the same pad with a separator key. That is exactly the split these two bundles encode, and it
 * is the rule already stated for the bank-account field: `inputMode`, never `type="number"`.
 *
 * ## What the filters guarantee
 *
 * The field can only ever hold something the schema can parse, so validation is about RANGE (is 900
 * more than we have in stock?) rather than about characters. That is what makes the decimal keyboard
 * safe: Android offers `,` and `-` beside the digits, and iOS's pad varies by locale, so a value the
 * user cannot see anything wrong with would otherwise fail with "monto inválido".
 */

/** Digits only — an integer field (a quantity, a count of hours, a stock level). Everything else,
 *  including a separator and a sign, is dropped: none of them can appear in a whole number. */
export const toIntegerText = (value: string): string => value.replace(/\D/g, '');

/** The most decimals a money field keeps. The API stores cents and the submit path truncates to
 *  them, so a third decimal is a digit the user watches themselves type and never sees again —
 *  better to not accept it than to silently drop it later. */
const MONEY_DECIMALS = 2;

/**
 * Digits and ONE decimal point, at most {@link MONEY_DECIMALS} of them — a money field.
 *
 * A comma becomes a point rather than being dropped: it is the decimal key on most Spanish-language
 * Android keyboards, so the person typing it means `.` and the value is what they intended. A
 * trailing point survives (`"12."` is the middle of typing `"12.5"`, and `Number('12.')` is 12), and
 * a leading one is kept as well (`".5"` → 0.5).
 */
export const toDecimalText = (value: string): string => {
  const cleaned = value.replace(/,/g, '.').replace(/[^\d.]/g, '');
  const point = cleaned.indexOf('.');
  if (point === -1) return cleaned;
  // Everything after the FIRST point is the fraction, with any further points removed — so
  // `1.2.3` reads as `1.23` (the digits in the order they were typed) rather than being refused.
  const whole = cleaned.slice(0, point);
  const fraction = cleaned.slice(point + 1).replace(/\./g, '');
  return `${whole}.${fraction.slice(0, MONEY_DECIMALS)}`;
};

/** Spread onto a whole-number field: the digits-only keypad plus the digits-only filter. */
export const integerInput = {
  type: 'text',
  inputMode: 'numeric',
  autoComplete: 'off',
  transform: toIntegerText,
} as const;

/** Spread onto a money field: the decimal keypad plus the one-point, two-decimal filter. */
export const decimalInput = {
  type: 'text',
  inputMode: 'decimal',
  autoComplete: 'off',
  transform: toDecimalText,
} as const;
