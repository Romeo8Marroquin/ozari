import type { OpenAPIV3 } from "openapi-types";
import { responses, schemas, securitySchemes } from "./openapi.components.js";
import { paths } from "./openapi.paths.js";

/**
 * The complete OpenAPI 3.1 description of the Ozari API's CURRENTLY-AVAILABLE surface.
 *
 * Safe to publish: it contains no secrets, real credentials, connection strings, or infrastructure
 * detail — only the request/response contract with illustrative example data.
 */
export const openApiDocument: OpenAPIV3.Document = {
  openapi: "3.0.3",
  info: {
    title: "Ozari API",
    version: "1.0.0",
    description: [
      "REST API for the Ozari platform. This document describes **only the endpoints that are",
      "currently mounted** — modules still in progress are intentionally omitted until they ship.",
      "",
      "### Response envelope",
      "Successful responses use a consistent envelope: `{ data?, message, status, subCode }`.",
      "`data` is present only when there is a payload (it is omitted for message-only successes).",
      "`message` is human-readable, `status` echoes the HTTP code, and `subCode` is a machine-readable",
      "discriminator (`0` = none).",
      "",
      "### Error shapes",
      "- **Application errors** (validation, auth, business rules) use `{ message, status, subCode }`.",
      "- **Framework fallbacks** (unknown route, uncaught 500, request timeout, CORS reject) use",
      "  `{ success: false, message }`.",
      "- **Rate-limit (429)** responses return the limiter's **plain-text** message plus `RateLimit-*`",
      "  headers.",
      "",
      "### Authentication model",
      "Every request must present **either** a valid `x-api-key` header (non-browser callers) **or**",
      "come from the allow-listed browser origin (`Origin === APP_HOST`). On top of that:",
      "- **Protected** endpoints require a Bearer **access token** (15-min JWT) in `Authorization`.",
      "- **State-changing** endpoints additionally require the **CSRF** token (`x-csrf-token` header),",
      "  a stateless signed token issued on login/refresh.",
      "- The **refresh token** lives in an HttpOnly cookie scoped to `/api/auth`; `/auth/refresh`",
      "  rotates the pair and detects replay of a rotated token (fail-secure: all sessions dropped).",
      "- **2FA** login is two-step: `/auth/signin` may return a short-lived `mfaToken`, which",
      "  authenticates `/auth/mfa/verify-login`.",
      "",
      "### Localization",
      "All `message` fields are localized via i18next (default `es-GT`). Send an `Accept-Language`",
      "header to select a locale; example messages here are illustrative English.",
      "",
      "### Privacy",
      "PII (email, name) is AES-256-GCM encrypted at rest; a separate SHA-256 column powers equality",
      "lookups. Tokens and secrets are never logged in deployed environments.",
    ].join("\n"),
    contact: { name: "Ozari Team" },
    license: { name: "MIT" },
  },
  servers: [
    { url: "/api", description: "Same origin as this documentation" },
    { url: "http://localhost:3000/api", description: "Local development" },
  ],
  tags: [
    { name: "Authentication", description: "Registration, password login, token refresh, sign-out." },
    { name: "Two-Factor Authentication", description: "TOTP setup/enable/disable and the 2FA login step." },
    { name: "Account", description: "The signed-in user's own profile and password." },
    { name: "Admin", description: "Administrative endpoints (role-gated)." },
    { name: "System", description: "Operational endpoints such as health checks." },
  ],
  // Default: every operation needs the API key (or an allow-listed browser origin). Protected
  // operations override this with the additional scheme(s) they require.
  security: [{ ApiKeyAuth: [] }],
  paths,
  components: { securitySchemes, schemas, responses },
};
