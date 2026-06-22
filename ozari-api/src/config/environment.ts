/**
 * Environment helpers.
 *
 * These read `process.env` on every call (rather than caching at module load)
 * so behavior reflects the current environment at the moment it is checked. This
 * keeps per-request middleware correct and makes the flags testable (a test can
 * set `NODE_ENV` before invoking the code under test).
 */
export const getNodeEnv = (): string => process.env["NODE_ENV"] ?? "development";

export const isProductionEnvironment = (): boolean =>
  getNodeEnv() === "production";
export const isStagingEnvironment = (): boolean => getNodeEnv() === "staging";
export const isDeployedEnvironment = (): boolean =>
  isProductionEnvironment() || isStagingEnvironment();

/**
 * Frontend origin used for CORS and the API-key browser-origin check.
 * Trailing slashes are stripped so it always matches the browser `Origin`
 * header, which never includes one (a stray slash in APP_HOST would otherwise
 * make every browser request fail the origin comparison).
 */
export const getAppHost = (): string =>
  (process.env["APP_HOST"] ?? "").replace(/\/+$/, "");
