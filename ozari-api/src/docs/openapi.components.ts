import type { OpenAPIV3 } from "openapi-types";

/**
 * Reusable OpenAPI building blocks: security schemes, schemas, and shared responses.
 *
 * The request DTO schemas here are a documentation MIRROR of the Zod validators in
 * `src/helpers/validators.ts` + `src/modules/auth/auth.validator.ts` — they must accept/reject
 * exactly the same values. When a validation rule changes, update it here in the same commit
 * (same discipline as the FE↔BE mirrored schemas). The backend Zod validators remain the single
 * security boundary; this spec is descriptive, not enforcing.
 *
 * Authored against OpenAPI 3.0.3 types (internally consistent under `exactOptionalPropertyTypes`).
 */

type Schema = OpenAPIV3.SchemaObject;
type Response = OpenAPIV3.ResponseObject;

// A syntactically-valid, obviously-fake example password (meets the policy). Not a real credential.
const EXAMPLE_PASSWORD = "Ex4mple!Secret";

// A schema `$ref` into `#/components/schemas`.
const schemaRef = (name: string): OpenAPIV3.ReferenceObject => ({
  $ref: `#/components/schemas/${name}`,
});

// ── Shared field schemas (mirror helpers/validators.ts) ─────────────────────────────────────────

const emailField: Schema = {
  type: "string",
  format: "email",
  maxLength: 254,
  description: "RFC 5321 address (max 254 chars). Trimmed and lower-cased server-side.",
  example: "ana.garcia@example.com",
};

const passwordField: Schema = {
  type: "string",
  minLength: 12,
  maxLength: 128,
  description:
    "12–128 characters with at least one lowercase letter, one uppercase letter, one digit, and " +
    "one symbol. Any printable ASCII character except space is allowed; spaces, control characters " +
    "and non-ASCII characters (accents, emoji) are rejected.",
  example: EXAMPLE_PASSWORD,
};

const fullNameField: Schema = {
  type: "string",
  minLength: 5,
  maxLength: 255,
  description: "Letters (including accents), digits, spaces, apostrophes and hyphens.",
  example: "Ana García López",
};

const roleField: Schema = {
  type: "string",
  enum: ["Client", "Admin", "Employee"],
  description: "Human-readable role name derived from the user's role id.",
  example: "Client",
};

const mfaCodeField: Schema = {
  type: "string",
  minLength: 6,
  maxLength: 32,
  description: "A 6-digit TOTP code **or** a 16-character one-time recovery code.",
  example: "123456",
};

// ── Security schemes ────────────────────────────────────────────────────────────────────────────

export const securitySchemes: Record<string, OpenAPIV3.SecuritySchemeObject> = {
  ApiKeyAuth: {
    type: "apiKey",
    in: "header",
    name: "x-api-key",
    description:
      "Shared secret for **non-browser** callers (server-to-server, scripts, Postman). Browser " +
      "requests are trusted by their `Origin` (must equal `APP_HOST`) instead and do NOT send this " +
      "header — so every operation effectively requires *either* a valid `x-api-key` *or* an " +
      "allow-listed browser origin.",
  },
  BearerAuth: {
    type: "http",
    scheme: "bearer",
    bearerFormat: "JWT",
    description:
      "Access token (HS256 JWT, 15-min TTL) returned in the `Authorization` response header on " +
      "login/refresh. Send it as `Authorization: Bearer <token>`. Revocable — every request " +
      "re-checks the DB session.",
  },
  MfaChallengeToken: {
    type: "http",
    scheme: "bearer",
    bearerFormat: "JWT",
    description:
      "Short-lived (5-min) MFA challenge token from the first login step, returned in the response " +
      "**body** as `data.mfaToken`. Sent as `Authorization: Bearer <mfaToken>` on " +
      "`/auth/mfa/verify-login` only. Keep it in memory — never persist it.",
  },
  CsrfToken: {
    type: "apiKey",
    in: "header",
    name: "x-csrf-token",
    description:
      "Stateless signed CSRF token issued in the `x-csrf-token` response header on login/refresh. " +
      "Echo it in the `x-csrf-token` request header on every state-changing (non-GET) call.",
  },
  RefreshCookie: {
    type: "apiKey",
    in: "cookie",
    name: "refresh-token",
    description:
      "HttpOnly refresh-token cookie (scoped to `/api/auth`, 30-day TTL) set on login. The browser " +
      "sends it automatically; it is the session anchor for `/auth/refresh` and `/auth/signout`.",
  },
};

// ── Schemas ──────────────────────────────────────────────────────────────────────────────────────

export const schemas: Record<string, Schema> = {
  // Error envelope produced by `sendOzariError` (validation, auth, and business errors).
  ErrorResponse: {
    type: "object",
    required: ["message", "status"],
    description: "Standard error envelope returned by application-level handlers.",
    properties: {
      message: {
        type: "string",
        description: "Human-readable, localized message (see `Accept-Language`).",
        example: "Invalid credentials",
      },
      status: { type: "integer", description: "HTTP status code, echoed in the body.", example: 401 },
      subCode: {
        type: "integer",
        description: "Machine-readable sub-code for finer error discrimination (0 = none).",
        default: 0,
        example: 0,
      },
    },
  },

  // Framework-level error shape from the global error handler, request timeout, and CORS rejects.
  // NOTE the different shape (`success` flag, no `status`/`subCode`).
  FrameworkErrorResponse: {
    type: "object",
    required: ["success", "message"],
    description:
      "Shape returned by the framework-level fallbacks (404 unknown route, uncaught 500, 408 " +
      "timeout, CORS 403) — distinct from `ErrorResponse`.",
    properties: {
      success: { type: "boolean", enum: [false], example: false },
      message: { type: "string", example: "Endpoint not found" },
    },
  },

  // Request DTOs
  RegisterRequest: {
    type: "object",
    required: ["fullName", "email", "password", "confirmPassword", "termsAccepted"],
    properties: {
      fullName: fullNameField,
      email: emailField,
      password: passwordField,
      confirmPassword: {
        type: "string",
        description: "Must exactly match `password`.",
        example: EXAMPLE_PASSWORD,
      },
      termsAccepted: {
        type: "boolean",
        enum: [true],
        description: "Must be `true` — the user has accepted the terms.",
        example: true,
      },
    },
  },
  SignInRequest: {
    type: "object",
    required: ["email", "password"],
    description: "The `device-uuid` header is required alongside this body.",
    properties: {
      email: emailField,
      password: {
        type: "string",
        minLength: 1,
        description: "The account password (only non-emptiness is checked on login).",
        example: EXAMPLE_PASSWORD,
      },
    },
  },
  ChangePasswordRequest: {
    type: "object",
    required: ["currentPassword", "newPassword", "confirmPassword"],
    properties: {
      currentPassword: {
        type: "string",
        minLength: 1,
        description: "The current password.",
        example: EXAMPLE_PASSWORD,
      },
      newPassword: passwordField,
      confirmPassword: {
        type: "string",
        description: "Must exactly match `newPassword`.",
        example: "N3w!Passw0rd",
      },
    },
  },
  MfaCodeRequest: {
    type: "object",
    required: ["code"],
    properties: { code: mfaCodeField },
  },
  MfaDisableRequest: {
    type: "object",
    required: ["password"],
    properties: {
      password: {
        type: "string",
        minLength: 1,
        description: "The account password, required to disable 2FA.",
        example: EXAMPLE_PASSWORD,
      },
    },
  },

  // Response payloads (the `data` field of the success envelope)
  UserProfile: {
    type: "object",
    properties: {
      id: { type: "integer", example: 42 },
      email: { type: "string", format: "email", example: "ana.garcia@example.com" },
      fullName: { type: "string", example: "Ana García López" },
      role: roleField,
      mfaEnabled: { type: "boolean", example: false },
      createdAt: { type: "string", format: "date-time", example: "2026-06-01T12:00:00.000Z" },
      updatedAt: { type: "string", format: "date-time", example: "2026-06-15T09:30:00.000Z" },
    },
  },
  UserListItem: {
    type: "object",
    properties: {
      id: { type: "integer", example: 42 },
      email: { type: "string", format: "email", example: "ana.garcia@example.com" },
      fullName: { type: "string", example: "Ana García López" },
      role: roleField,
      createdAt: { type: "string", format: "date-time", example: "2026-06-01T12:00:00.000Z" },
      updatedAt: { type: "string", format: "date-time", example: "2026-06-15T09:30:00.000Z" },
    },
  },
  UserListItemArray: {
    type: "array",
    description: "The list of active users.",
    items: schemaRef("UserListItem"),
  },
  MfaRequiredData: {
    type: "object",
    properties: {
      mfaRequired: { type: "boolean", enum: [true], example: true },
      mfaToken: {
        type: "string",
        description: "Short-lived challenge token — send it to `/auth/mfa/verify-login`.",
        example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.<payload>.<signature>",
      },
    },
  },
  MfaSetupData: {
    type: "object",
    properties: {
      secret: {
        type: "string",
        description: "Base32 TOTP secret for manual entry into an authenticator app.",
        example: "JBSWY3DPEHPK3PXP",
      },
      otpauthUri: {
        type: "string",
        description: "`otpauth://` URI to render as a QR code.",
        example:
          "otpauth://totp/Party%20Rentals:ana.garcia@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Party%20Rentals",
      },
    },
  },
  MfaEnableData: {
    type: "object",
    properties: {
      recoveryCodes: {
        type: "array",
        items: { type: "string" },
        description: "One-time recovery codes — shown ONCE. Tell the user to store them safely.",
        example: ["A1B2-C3D4-E5F6", "G7H8-J9K0-L1M2"],
      },
    },
  },
  HealthData: {
    type: "object",
    properties: {
      status: { type: "string", example: "healthy" },
      database: { type: "string", example: "connected" },
      timestamp: { type: "string", format: "date-time", example: "2026-07-02T13:00:00.000Z" },
    },
  },
};

// ── Response helpers ──────────────────────────────────────────────────────────────────────────────

/** A localized JSON body carrying only a message (message-only success or any error). */
const messageBody = (message: string, status: number): OpenAPIV3.MediaTypeObject => ({
  schema: schemaRef("ErrorResponse"),
  example: { message, status, subCode: 0 },
});

/** A success envelope carrying a typed `data` payload. */
export const dataResponse = (
  description: string,
  dataSchemaName: string,
  example: unknown,
  message = "OK",
  status = 200,
): Response => ({
  description,
  content: {
    "application/json": {
      schema: {
        type: "object",
        required: ["message", "status"],
        properties: {
          data: schemaRef(dataSchemaName),
          message: { type: "string" },
          status: { type: "integer" },
          subCode: { type: "integer", default: 0 },
        },
      },
      example: { data: example, message, status, subCode: 0 },
    },
  },
});

/** A message-only success envelope (`data` is omitted from the JSON when undefined). */
export const messageResponse = (
  description: string,
  message: string,
  status = 200,
): Response => ({
  description,
  content: { "application/json": { ...messageBody(message, status) } },
});

/** An application-level error (`ErrorResponse` shape) with a specific localized message. */
export const errorResponse = (
  description: string,
  status: number,
  message: string,
): Response => ({
  description,
  content: { "application/json": { ...messageBody(message, status) } },
});

// ── Reusable named responses (referenced from paths) ──────────────────────────────────────────────

export const responses: Record<string, Response> = {
  TooManyRequests: {
    description:
      "Rate limit exceeded. Auth endpoints allow 10 req/min per IP (plus a per-email 5-per-15-min " +
      "login guard and MFA lockout); `/auth/refresh` allows 5/min; public endpoints 30/min. The " +
      "body is the limiter's plain-text message; `RateLimit-*` headers describe the window.",
    content: {
      "text/plain": {
        schema: { type: "string" },
        example: "Too many authentication requests, please try again later.",
      },
    },
  },
  InternalServerError: {
    description: "Unexpected server error. The message is generic; details are logged server-side.",
    content: {
      "application/json": {
        schema: schemaRef("ErrorResponse"),
        example: { message: "Internal Server Error", status: 500, subCode: 0 },
      },
    },
  },
};
