import es from '../assets/locales/es.json';

/**
 * The i18n CONTRACT every test enforces: a key must exist, and a string's placeholders must all be
 * supplied. Both failures are silent in production — the user is shown a raw
 * `modules.panel.orders.x` path, or a literal `{{client}}` — and neither TypeScript nor a review can
 * see them, because the key is a string and the values live in a JSON file. It shipped exactly that
 * way once (the advance toast's `{{client}}`, 2026-07-29).
 *
 * Enforcing it in the mocked `t` makes the guarantee COMPLETE rather than best-effort: coverage is
 * held at 100%, so every `t()` call site in the app runs at least once in the suite — including the
 * ones whose key is assembled at runtime, which no static scan can resolve.
 *
 * Lives in its own module (not in `setup.ts`) so a suite that needs its own `t` — one asserting that
 * a label really interpolates, say — can compose the check instead of switching it off.
 */

/** The Spanish string behind a dotted key, or `undefined` when the path leads nowhere. */
const lookup = (key: string): string | undefined => {
  const found = key
    .split('.')
    .reduce<unknown>(
      (node, part) =>
        node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined,
      es,
    );
  return typeof found === 'string' ? found : undefined;
};

/** The `{{name}}` / `{{-name}}` values a string needs supplied. */
const placeholdersIn = (text: string): string[] =>
  [...text.matchAll(/\{\{-?\s*(\w+)[^}]*\}\}/g)].map((match) => match[1] as string);

/** i18next writes plurals as sibling keys (`items_one` / `items_other`) and picks one from `count`
 *  at call time, so a `count`-bearing call legitimately names a key that doesn't exist by itself. */
const PLURAL_SUFFIXES = ['_one', '_other', '_many', '_zero', '_two', '_few'];

/** Every string a call could resolve to: the exact key, or all of its plural variants — all of them,
 *  so a placeholder that appears in only one variant is still caught. */
const stringsFor = (key: string, params?: Record<string, unknown>): string[] => {
  const direct = lookup(key);
  if (direct !== undefined) return [direct];
  if (params?.['count'] === undefined) return [];
  return PLURAL_SUFFIXES.map((suffix) => lookup(`${key}${suffix}`)).filter(
    (text): text is string => text !== undefined,
  );
};

/**
 * Holds one `t()` call to the contract and returns the KEY, so assertions stay readable
 * (`expect(getByText('a.b.c'))`). Throws — a translation the user can't read is a broken screen,
 * not a warning.
 */
export const assertTranslationContract = (
  key: string,
  params?: Record<string, unknown>,
): string => {
  const texts = stringsFor(key, params);
  if (texts.length === 0) {
    throw new Error(
      `[i18n] "${key}" is not in es.json — the raw key path would be shown to the user.`,
    );
  }
  const missing = [...new Set(texts.flatMap(placeholdersIn))].filter(
    (name) => params?.[name] === undefined,
  );
  if (missing.length > 0) {
    throw new Error(
      `[i18n] "${key}" needs ${missing.map((name) => `{{${name}}}`).join(', ')} — ` +
        `without it the placeholder is rendered literally. Text: "${texts[0]}"`,
    );
  }
  return key;
};
