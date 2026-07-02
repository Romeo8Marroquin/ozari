import type { OpenAPIV3 } from "openapi-types";
import {
  dataResponse,
  errorResponse,
  messageResponse,
} from "./openapi.components.js";

/**
 * Path definitions for every CURRENTLY-MOUNTED endpoint. WIP modules (e.g. products) are
 * intentionally omitted until they ship. All paths are relative to the `/api` server base.
 */

// Obviously-fake example password reused across request-body examples (meets the policy).
const EXAMPLE_PASSWORD = "Ex4mple!Secret";

const rateLimited: OpenAPIV3.ReferenceObject = {
  $ref: "#/components/responses/TooManyRequests",
};
const serverError: OpenAPIV3.ReferenceObject = {
  $ref: "#/components/responses/InternalServerError",
};

const bodyRef = (schemaName: string, example: unknown): OpenAPIV3.RequestBodyObject => ({
  required: true,
  content: {
    "application/json": {
      schema: { $ref: `#/components/schemas/${schemaName}` },
      example,
    },
  },
});

// Shared error responses used across several protected endpoints.
const csrfForbidden = (): OpenAPIV3.ResponseObject =>
  errorResponse("Missing or invalid CSRF token.", 403, "Invalid CSRF token");
const userNotFound = (): OpenAPIV3.ResponseObject =>
  errorResponse("The user no longer exists or is inactive.", 404, "User not found");
const unauthorized = (description: string): OpenAPIV3.ResponseObject =>
  errorResponse(description, 401, "Unauthorized");

// Response headers set by the two session-issuing paths (login success + refresh).
const sessionHeaders: Record<string, OpenAPIV3.HeaderObject> = {
  Authorization: {
    description: "`Bearer <accessToken>` — the 15-minute access token.",
    schema: { type: "string" },
  },
  "x-csrf-token": {
    description: "Fresh CSRF token; echo it in the `x-csrf-token` header on state-changing calls.",
    schema: { type: "string" },
  },
  "Set-Cookie": {
    description: "HttpOnly `refresh-token` cookie (scoped to `/api/auth`, 30-day TTL).",
    schema: { type: "string" },
  },
};

const deviceUuidHeader: OpenAPIV3.ParameterObject = {
  name: "device-uuid",
  in: "header",
  required: true,
  description: "Stable per-device UUID; binds the session to this device.",
  schema: { type: "string", format: "uuid" },
  example: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
};

export const paths: OpenAPIV3.PathsObject = {
  "/auth/user": {
    post: {
      tags: ["Authentication"],
      summary: "Register a new user",
      operationId: "registerUser",
      description:
        "**Public.** Creates a normal `Client` account (pending admin enablement). Never grants " +
        "admin. No session is issued — the user signs in afterwards. PII is encrypted at rest.",
      security: [{ ApiKeyAuth: [] }],
      requestBody: bodyRef("RegisterRequest", {
        fullName: "Ana García López",
        email: "ana.garcia@example.com",
        password: EXAMPLE_PASSWORD,
        confirmPassword: EXAMPLE_PASSWORD,
        termsAccepted: true,
      }),
      responses: {
        "201": messageResponse("User created.", "User created successfully", 201),
        "400": errorResponse(
          "Validation failed (bad name/email/password, mismatch, or terms not accepted).",
          400,
          "The password does not meet the security requirements",
        ),
        "409": errorResponse("An account with this email already exists.", 409, "Could not create the user"),
        "429": rateLimited,
        "500": serverError,
      },
    },
  },

  "/auth/signin": {
    post: {
      tags: ["Authentication"],
      summary: "Password login (step 1)",
      operationId: "signIn",
      description:
        "**Public.** Verifies the password. If 2FA is disabled, issues the session immediately " +
        "(access token in the `Authorization` header, refresh token in an HttpOnly cookie, CSRF in " +
        "the `x-csrf-token` header). If 2FA is enabled, returns `200` with `data.mfaRequired` and a " +
        "short-lived `mfaToken` and **no** session — continue at `/auth/mfa/verify-login`. Login is " +
        "constant-time against account enumeration.",
      security: [{ ApiKeyAuth: [] }],
      parameters: [deviceUuidHeader],
      requestBody: bodyRef("SignInRequest", {
        email: "ana.garcia@example.com",
        password: EXAMPLE_PASSWORD,
      }),
      responses: {
        "200": {
          description:
            "Either the session was issued (headers set, `data` omitted) OR a second factor is " +
            "required (`data.mfaRequired`, no session headers).",
          headers: sessionHeaders,
          content: {
            "application/json": {
              schema: {
                oneOf: [
                  { $ref: "#/components/schemas/ErrorResponse" },
                  {
                    type: "object",
                    properties: {
                      data: { $ref: "#/components/schemas/MfaRequiredData" },
                      message: { type: "string" },
                      status: { type: "integer" },
                      subCode: { type: "integer" },
                    },
                  },
                ],
              },
              examples: {
                sessionIssued: {
                  summary: "2FA disabled — session issued",
                  value: { message: "Authenticated", status: 200, subCode: 0 },
                },
                mfaRequired: {
                  summary: "2FA enabled — second step required",
                  value: {
                    data: {
                      mfaRequired: true,
                      mfaToken: "eyJhbGciOiJIUzI1NiJ9.<payload>.<signature>",
                    },
                    message: "Multi-factor authentication required",
                    status: 200,
                    subCode: 0,
                  },
                },
              },
            },
          },
        },
        "400": errorResponse("Invalid body or missing/invalid `device-uuid`.", 400, "Invalid email or password format"),
        "401": errorResponse("Invalid credentials (identical for unknown email and wrong password).", 401, "Invalid credentials"),
        "429": rateLimited,
        "500": serverError,
      },
    },
  },

  "/auth/mfa/verify-login": {
    post: {
      tags: ["Two-Factor Authentication"],
      summary: "Complete 2FA login (step 2)",
      operationId: "verifyMfaLogin",
      description:
        "Second login step. Authenticated by the `mfaToken` from step 1 (as a Bearer token). " +
        "Accepts a 6-digit TOTP **or** a 16-char recovery code in `code`. On success, issues the " +
        "real session exactly like a normal login.",
      security: [{ ApiKeyAuth: [], MfaChallengeToken: [] }],
      requestBody: bodyRef("MfaCodeRequest", { code: "123456" }),
      responses: {
        "200": messageResponse(
          "Session issued (access header + refresh cookie + CSRF header set).",
          "Authenticated",
        ),
        "400": errorResponse("Malformed `code`.", 400, "Invalid code"),
        "401": errorResponse(
          "Wrong code, or the 5-minute `mfaToken` expired/invalid (restart from `/auth/signin`).",
          401,
          "Invalid or expired verification",
        ),
        "429": {
          description: "Too many failed codes — the challenge is temporarily locked (~15 min).",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
              example: { message: "Too many attempts, try again later", status: 429, subCode: 0 },
            },
          },
        },
        "500": serverError,
      },
    },
  },

  "/auth/refresh": {
    post: {
      tags: ["Authentication"],
      summary: "Rotate the access/refresh tokens",
      operationId: "refreshTokens",
      description:
        "Rotates the device's token pair using the HttpOnly `refresh-token` cookie (single active " +
        "refresh per device). Replaying a rotated token is treated as theft and **hard-deletes all " +
        "of the user's sessions** (fail-secure). Requires the CSRF header. Own 5/min limiter.",
      security: [{ ApiKeyAuth: [], RefreshCookie: [], CsrfToken: [] }],
      responses: {
        "200": {
          ...messageResponse("New token pair issued (headers + cookie rotated).", "Token refreshed"),
          headers: sessionHeaders,
        },
        "401": errorResponse(
          "Missing/invalid/expired refresh cookie, or reuse/concurrent-rotation detected.",
          401,
          "Could not refresh the session",
        ),
        "403": csrfForbidden(),
        "429": rateLimited,
        "500": serverError,
      },
    },
  },

  "/auth/signout": {
    post: {
      tags: ["Authentication"],
      summary: "Sign out",
      operationId: "signOut",
      description:
        "Idempotent logout. Identity comes from the refresh cookie, so it works even with an " +
        "expired access token. Clears the current device's sessions (or all with `?allDevices=true`) " +
        "and clears the refresh cookie. Requires the CSRF header. Always succeeds with `200`.",
      security: [{ ApiKeyAuth: [], RefreshCookie: [], CsrfToken: [] }],
      parameters: [
        {
          name: "allDevices",
          in: "query",
          required: false,
          description: "Set to `true` to revoke sessions on every device, not just this one.",
          schema: { type: "string", enum: ["true", "false"] },
        },
      ],
      responses: {
        "200": messageResponse("Signed out (idempotent). Clear local credentials on any 2xx.", "Signed out"),
        "403": csrfForbidden(),
        "429": rateLimited,
        "500": serverError,
      },
    },
  },

  "/auth/me": {
    get: {
      tags: ["Account"],
      summary: "Get the current user's profile",
      operationId: "getMe",
      description: "Returns the authenticated user's decrypted profile, including `mfaEnabled`.",
      security: [{ ApiKeyAuth: [], BearerAuth: [] }],
      responses: {
        "200": dataResponse("The current user's profile.", "UserProfile", {
          id: 42,
          email: "ana.garcia@example.com",
          fullName: "Ana García López",
          role: "Client",
          mfaEnabled: false,
          createdAt: "2026-06-01T12:00:00.000Z",
          updatedAt: "2026-06-15T09:30:00.000Z",
        }, "Profile fetched"),
        "401": unauthorized("Missing, invalid, or revoked access token."),
        "404": userNotFound(),
        "429": rateLimited,
        "500": serverError,
      },
    },
  },

  "/auth/change-password": {
    post: {
      tags: ["Account"],
      summary: "Change the current user's password",
      operationId: "changePassword",
      description:
        "Verifies the current password, rejects reuse of the same password, then updates it and " +
        "**revokes every OTHER device's session** (the current device stays signed in). Requires " +
        "Bearer auth + CSRF.",
      security: [{ ApiKeyAuth: [], BearerAuth: [], CsrfToken: [] }],
      requestBody: bodyRef("ChangePasswordRequest", {
        currentPassword: EXAMPLE_PASSWORD,
        newPassword: "N3w!Passw0rd",
        confirmPassword: "N3w!Passw0rd",
      }),
      responses: {
        "200": messageResponse("Password changed; other-device sessions revoked.", "Password changed"),
        "400": errorResponse("Validation failed, or the new password reuses the current one.", 400, "The new password cannot be the same as the current one"),
        "401": errorResponse("The current password is wrong, or the access token is invalid.", 401, "The current password is incorrect"),
        "403": csrfForbidden(),
        "404": userNotFound(),
        "429": rateLimited,
        "500": serverError,
      },
    },
  },

  "/auth/mfa/setup": {
    post: {
      tags: ["Two-Factor Authentication"],
      summary: "Begin 2FA setup",
      operationId: "setupMfa",
      description:
        "Generates a pending TOTP secret + `otpauth://` URI (render as a QR). 2FA is not active " +
        "until confirmed via `/auth/mfa/enable`. Requires Bearer auth + CSRF.",
      security: [{ ApiKeyAuth: [], BearerAuth: [], CsrfToken: [] }],
      responses: {
        "200": dataResponse("Pending TOTP secret + provisioning URI.", "MfaSetupData", {
          secret: "JBSWY3DPEHPK3PXP",
          otpauthUri: "otpauth://totp/Ozari:ana.garcia@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Ozari",
        }, "MFA secret generated"),
        "401": unauthorized("Missing or invalid access token."),
        "403": csrfForbidden(),
        "404": userNotFound(),
        "409": errorResponse("2FA is already enabled.", 409, "Two-factor authentication is already enabled"),
        "429": rateLimited,
        "500": serverError,
      },
    },
  },

  "/auth/mfa/enable": {
    post: {
      tags: ["Two-Factor Authentication"],
      summary: "Confirm and enable 2FA",
      operationId: "enableMfa",
      description:
        "Confirms a TOTP code against the pending secret, enables 2FA, and returns one-time recovery " +
        "codes **once** — show them and never persist them client-side. Requires Bearer auth + CSRF.",
      security: [{ ApiKeyAuth: [], BearerAuth: [], CsrfToken: [] }],
      requestBody: bodyRef("MfaCodeRequest", { code: "123456" }),
      responses: {
        "200": dataResponse("2FA enabled; one-time recovery codes returned.", "MfaEnableData", {
          recoveryCodes: ["A1B2-C3D4-E5F6", "G7H8-J9K0-L1M2", "N3P4-Q5R6-S7T8"],
        }, "Two-factor authentication enabled"),
        "400": errorResponse("Malformed code, or setup was never started (no pending secret).", 400, "Complete MFA setup first"),
        "401": errorResponse("The code is invalid, or the access token is invalid.", 401, "Invalid code"),
        "403": csrfForbidden(),
        "404": userNotFound(),
        "409": errorResponse("2FA is already enabled.", 409, "Two-factor authentication is already enabled"),
        "429": rateLimited,
        "500": serverError,
      },
    },
  },

  "/auth/mfa/disable": {
    post: {
      tags: ["Two-Factor Authentication"],
      summary: "Disable 2FA",
      operationId: "disableMfa",
      description:
        "Requires the account password. Clears the TOTP secret and all recovery codes. Requires " +
        "Bearer auth + CSRF.",
      security: [{ ApiKeyAuth: [], BearerAuth: [], CsrfToken: [] }],
      requestBody: bodyRef("MfaDisableRequest", { password: EXAMPLE_PASSWORD }),
      responses: {
        "200": messageResponse("2FA disabled; secret and recovery codes cleared.", "Two-factor authentication disabled"),
        "400": errorResponse("Invalid body, or 2FA is not currently enabled.", 400, "Two-factor authentication is not enabled"),
        "401": errorResponse("The password is wrong, or the access token is invalid.", 401, "Incorrect password"),
        "403": csrfForbidden(),
        "404": userNotFound(),
        "429": rateLimited,
        "500": serverError,
      },
    },
  },

  "/auth/all": {
    get: {
      tags: ["Admin"],
      summary: "List all users (admin only)",
      operationId: "getAllUsers",
      description: "Returns every active user's decrypted profile. Requires the `Admin` role.",
      security: [{ ApiKeyAuth: [], BearerAuth: [] }],
      responses: {
        "200": dataResponse("The list of active users.", "UserListItemArray", [
          {
            id: 42,
            email: "ana.garcia@example.com",
            fullName: "Ana García López",
            role: "Client",
            createdAt: "2026-06-01T12:00:00.000Z",
            updatedAt: "2026-06-15T09:30:00.000Z",
          },
        ], "Users fetched"),
        "401": unauthorized("Missing or invalid access token."),
        "403": errorResponse("Authenticated but not an admin.", 403, "Forbidden"),
        "429": rateLimited,
        "500": serverError,
      },
    },
  },

  "/health/check": {
    get: {
      tags: ["System"],
      summary: "Liveness + database health probe",
      operationId: "healthCheck",
      description:
        "**Public.** Verifies the service is up and the database is reachable (`SELECT 1`). Used by " +
        "deployment probes and the frontend's outage detector. Public limiter (30/min).",
      security: [{ ApiKeyAuth: [] }],
      responses: {
        "200": dataResponse("Service and database are healthy.", "HealthData", {
          status: "healthy",
          database: "connected",
          timestamp: "2026-07-02T13:00:00.000Z",
        }, "Service is healthy"),
        "503": errorResponse("The database is unreachable — service unhealthy.", 503, "Service unhealthy - database connection failed"),
        "429": rateLimited,
      },
    },
  },
};
