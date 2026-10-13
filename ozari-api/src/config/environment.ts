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

/**
 * Whether `POST /auth/user` accepts new accounts (`REGISTRATION_OPEN`).
 *
 * A deployed environment FAILS CLOSED: only the exact string `"true"` opens it, so a missing or
 * mistyped variable can never let strangers in. The value is committed per environment
 * (`registration_open` in `infrastructure/terraform/envs/<env>/environment.json`, both starting
 * open), applied by Terraform, and changed with `infrastructure/scripts/registration.ps1 <env>
 * open|close` once there are enough users. Locally (and in tests) it stays OPEN unless set to
 * `"false"`, so a developer's machine keeps working without a new `.env` line.
 */
export const isRegistrationOpen = (): boolean => {
  const value = process.env["REGISTRATION_OPEN"];
  return isDeployedEnvironment() ? value === "true" : value !== "false";
};
