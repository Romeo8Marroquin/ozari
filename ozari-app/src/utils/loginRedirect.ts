/**
 * The deep-link memory of the auth flow. When a guard bounces an unauthenticated visitor to the
 * login (e.g. someone opening a shared `/panel/productos/6` link), the intended destination rides
 * along as the `?redirect=` search param and the login honors it after success.
 *
 * Because that param travels inside a shareable URL, anyone can craft it — so it is validated here,
 * at the single entry point (the `/sesion` route's `validateSearch`), never trusted raw. Only
 * same-origin PANEL paths pass; anything else (absolute URLs, protocol-relative `//host`, other
 * routes, dotted traversal) is dropped and the login falls back to its default destination.
 */

/** An in-panel path: `/panel` itself or `/panel/...`, optionally with a query string. */
const PANEL_PATH_PATTERN = /^\/panel(?:[/?]|$)/;

export const sanitizeLoginRedirect = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  // Must START with `/panel` — this alone rules out `https://…`, `//evil.com`, and `\`-tricks.
  if (!PANEL_PATH_PATTERN.test(value)) return undefined;
  // Belt-and-braces: dotted segments could resolve outside `/panel` when the URL normalizes.
  if (value.includes('..')) return undefined;
  return value;
};
