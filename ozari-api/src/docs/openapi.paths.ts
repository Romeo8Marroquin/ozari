import type { OpenAPIV3 } from "openapi-types";
import {
  dataResponse,
  errorResponse,
  messageResponse,
} from "./openapi.components.js";

/**
 * Path definitions for every CURRENTLY-MOUNTED endpoint. WIP endpoints (e.g. product update/delete)
 * are intentionally omitted until they ship. All paths are relative to the `/api` server base.
 */

// Obviously-fake example passwords reused across request-body examples (both meet the policy).
const STALE_TOKEN_401 = "Missing, invalid, or revoked access token.";
const EXAMPLE_PASSWORD = "Ex4mple!Secret";
const EXAMPLE_NEW_PASSWORD = "N3w!Passw0rd";
const EXAMPLE_EMAIL = "ana.garcia@example.com";
// The illustrative product reused across every /products example.
const EXAMPLE_PRODUCT_NAME = "Mesa redonda";
const EXAMPLE_PRODUCT_DESCRIPTION = "Mesa para 8 personas";
const EXAMPLE_CURRENCY_NAME = "Quetzal Guatemalteco";
// The illustrative walk-in order reused across every /orders and /client-registries example.
const EXAMPLE_CLIENT_NAME = "María López";
const EXAMPLE_ORDER_CONTACT = "WhatsApp 5555-1234";
const EXAMPLE_ORDER_ADDRESS = "Zona 10, 4a avenida 5-55";
const EXAMPLE_STATUS_PENDING = "Pendiente";
const EXAMPLE_EVENT_TYPE = "Evento familiar";
const EXAMPLE_LINE_PRODUCT_NAME = "Silla plegable";
const EXAMPLE_ADMIN_NAME = "Romeo Marroquín";
const EXAMPLE_DELIVERY_AT = "2026-08-01T14:00:00.000Z";
const EXAMPLE_PICKUP_AT = "2026-08-02T10:00:00.000Z";
const EXAMPLE_ORDER_CREATED_AT = "2026-07-16T12:00:00.000Z";

// The two path params every catalog route shares.
const catalogParam: OpenAPIV3.ParameterObject = {
  name: "catalog",
  in: "path",
  required: true,
  description:
    "Which manageable catalog. Anything outside this list is a 404 — including the lookups code " +
    "branches on (roles, currencies, business types, rent units, payment status, geo).",
  schema: {
    type: "string",
    enum: [
      "event-types",
      "contact-types",
      "zones",
      "payment-methods",
      "product-categories",
      "product-detail-types",
      "bank-accounts",
    ],
  },
  example: "event-types",
};
const catalogIdParam: OpenAPIV3.ParameterObject = {
  name: "id",
  in: "path",
  required: true,
  description: "The row id.",
  schema: { type: "integer", minimum: 1 },
  example: 1,
};

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
const adminOnly = (): OpenAPIV3.ResponseObject =>
  errorResponse("Authenticated but not an admin.", 403, "Forbidden");
const productsReadForbidden = (): OpenAPIV3.ResponseObject =>
  errorResponse(
    "Authenticated but the role cannot read products — product reads are Admin + Client only " +
      "(a Driver's job is deliveries, not the catalog).",
    403,
    "Forbidden",
  );
const ordersListForbidden = (): OpenAPIV3.ResponseObject =>
  errorResponse(
    "Authenticated but the role cannot list orders — the list is Admin + Driver (an Admin sees " +
      "every order; a Driver only their assigned ones). A Client has no orders view here.",
    403,
    "Forbidden",
  );

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
        email: EXAMPLE_EMAIL,
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
        email: EXAMPLE_EMAIL,
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
          "The 5-minute `mfaToken` expired or is invalid — restart from `/auth/signin`.",
          401,
          "Verification expired",
        ),
        "422": errorResponse(
          "The code is wrong (valid `mfaToken`) — let the user try again.",
          422,
          "Incorrect code",
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
        "of the user's sessions** (fail-secure) — with ONE carve-out: replaying the device's " +
        "**immediately-previous** token within a short grace window (60s) is recognized as a lost " +
        "rotation response (reload/tab-close/network drop killed the response after the server " +
        "committed) and simply re-rotates. Requires the CSRF header. Own 5/min limiter.",
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

  "/auth/forgot-password": {
    post: {
      tags: ["Authentication"],
      summary: "Request a password reset",
      operationId: "forgotPassword",
      description:
        "**Public.** Starts the reset flow. **Always** returns the same generic `200` whether or " +
        "not the email maps to an account (no enumeration). When the email is known, a single-use, " +
        "30-minute reset link is emailed (only a hash of the token is stored). Own 5/min limiter.",
      security: [{ ApiKeyAuth: [] }],
      requestBody: bodyRef("ForgotPasswordRequest", {
        email: EXAMPLE_EMAIL,
      }),
      responses: {
        "200": messageResponse(
          "Generic acknowledgement (identical regardless of whether the email exists).",
          "Check your email — we sent you a link to reset your password",
        ),
        "400": errorResponse("Invalid body or email format.", 400, "The email is required and must be valid"),
        "429": rateLimited,
        "500": serverError,
      },
    },
  },

  "/auth/reset-password": {
    post: {
      tags: ["Authentication"],
      summary: "Reset the password with a token",
      operationId: "resetPassword",
      description:
        "**Public.** Completes the reset using the emailed token. Invalid, used, and expired tokens " +
        "all return the same generic `400`. On success it sets the new password (rejecting reuse of " +
        "the current one), consumes the token, and **revokes ALL of the user's sessions on every " +
        "device**. Own 5/min limiter.",
      security: [{ ApiKeyAuth: [] }],
      requestBody: bodyRef("ResetPasswordRequest", {
        token: "M2Q0YmYxYzhhOTdlNGQ2ZmIyN2E1ZTgxYzBkM2Y0YjY",
        newPassword: EXAMPLE_NEW_PASSWORD,
        confirmPassword: EXAMPLE_NEW_PASSWORD,
      }),
      responses: {
        "200": messageResponse("Password reset; every session was revoked.", "Your password has been reset"),
        "400": errorResponse(
          "Invalid/used/expired token, validation failure, or the new password reuses the current one.",
          400,
          "The reset link is invalid or has expired",
        ),
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
          email: EXAMPLE_EMAIL,
          fullName: "Ana García López",
          role: "Client",
          mfaEnabled: false,
          createdAt: "2026-06-01T12:00:00.000Z",
          updatedAt: "2026-06-15T09:30:00.000Z",
        }, "Profile fetched"),
        "401": unauthorized(STALE_TOKEN_401),
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
        newPassword: EXAMPLE_NEW_PASSWORD,
        confirmPassword: EXAMPLE_NEW_PASSWORD,
      }),
      responses: {
        "200": messageResponse("Password changed; other-device sessions revoked.", "Password changed"),
        "400": errorResponse("Validation failed, or the new password reuses the current one.", 400, "The new password cannot be the same as the current one"),
        "401": unauthorized("Missing, invalid, or expired access token."),
        "422": errorResponse("The current password is wrong (the access token is valid).", 422, "The current password is incorrect"),
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
          otpauthUri:
            "otpauth://totp/Party%20Rentals:ana.garcia@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Party%20Rentals",
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
        "401": unauthorized("Missing, invalid, or expired access token."),
        "422": errorResponse("The confirmation code is wrong (the access token is valid).", 422, "Invalid code"),
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
        "401": unauthorized("Missing, invalid, or expired access token."),
        "422": errorResponse("The confirming password is wrong (the access token is valid).", 422, "Incorrect password"),
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
            email: EXAMPLE_EMAIL,
            fullName: "Ana García López",
            role: "Client",
            createdAt: "2026-06-01T12:00:00.000Z",
            updatedAt: "2026-06-15T09:30:00.000Z",
          },
        ], "Users fetched"),
        "401": unauthorized("Missing or invalid access token."),
        "403": adminOnly(),
        "429": rateLimited,
        "500": serverError,
      },
    },
  },

  "/products": {
    get: {
      tags: ["Products"],
      summary: "List the product catalog (role-projected)",
      operationId: "getProducts",
      description:
        "Returns the paginated **active** catalog. **Admin + Client only** (any other role — e.g. " +
        "Driver — gets a `403`); the response fields are **role-projected** (minimum privilege): " +
        "Admin sees the `available` count plus internal fields (incl. the Alquiler fleet `total`), " +
        "and a Client sees only the shared catalog fields. For Alquiler, `available` is derived: " +
        "fleet minus units out on active rentals. Pagination, the optional filters and `sort` are " +
        "clamped or dropped (never rejected), so there is no 400. Authenticated limiter (100/min).",
      security: [{ ApiKeyAuth: [], BearerAuth: [] }],
      parameters: [
        {
          name: "page",
          in: "query",
          required: false,
          description: "1-based page number (clamped to ≥ 1).",
          schema: { type: "integer", minimum: 1, default: 1 },
        },
        {
          name: "pageSize",
          in: "query",
          required: false,
          description: "Items per page (clamped to 1–50).",
          schema: { type: "integer", minimum: 1, maximum: 50, default: 20 },
        },
        {
          name: "search",
          in: "query",
          required: false,
          description:
            "Case-insensitive product-name substring. Trimmed; truncated to 100 chars; " +
            "empty/invalid values are ignored.",
          schema: { type: "string", maxLength: 100 },
        },
        {
          name: "categoryId",
          in: "query",
          required: false,
          description:
            "Filter by product category id (see `GET /products/catalog`). A non-positive or " +
            "unknown id is ignored or matches nothing.",
          schema: { type: "integer", minimum: 1 },
        },
        {
          name: "businessTypeId",
          in: "query",
          required: false,
          description:
            "Filter by business type id (1 = Alquiler, 2 = Venta). Values outside the known " +
            "enum are ignored.",
          schema: { type: "integer", minimum: 1 },
        },
        {
          name: "sort",
          in: "query",
          required: false,
          description:
            "Presentation order, any role. `recent` (default) = newest first; `nameAsc`/`nameDesc` " +
            "= Spanish collation; `priceAsc`/`priceDesc` = THE product's price (rent or sell, " +
            "whichever it has — the conditional rule guarantees exactly one), priceless rows " +
            "sinking to the end either way. An unknown value clamps to `recent`. There is " +
            "deliberately no availability filter — a rented-out Alquiler isn't gone, and an admin " +
            "NEEDS to see unavailable rows.",
          schema: {
            type: "string",
            enum: ["recent", "nameAsc", "nameDesc", "priceAsc", "priceDesc"],
          },
        },
        {
          name: "includeInactive",
          in: "query",
          required: false,
          description:
            "**Admin only** — `true` widens the rows to include soft-deleted products. Silently " +
            "ignored for every other role.",
          schema: { type: "boolean", default: false },
        },
      ],
      responses: {
        "200": dataResponse("The role-projected page of products (example shows the Admin view).", "ProductListResponse", {
          products: [
            {
              id: 7,
              name: EXAMPLE_PRODUCT_NAME,
              description: EXAMPLE_PRODUCT_DESCRIPTION,
              businessType: "Alquiler",
              businessTypeId: 1,
              category: "Mesas",
              categoryId: 1,
              currency: { id: 1, iso4217Code: "GTQ", name: EXAMPLE_CURRENCY_NAME, symbol: "Q" },
              rentPrice: 75,
              sellPrice: null,
              rentTimeUnit: "Día",
              rentTimeUnitId: 2,
              images: [{ id: 1, url: "https://cdn.example.com/products/7/hero.webp", isPrimary: true, sortOrder: 0 }],
              details: [{ id: 12, detail: "Blanco", detailType: "Color", detailTypeId: 1 }],
              inStock: true,
              available: 35,
              total: 40,
              replacementPrice: 900,
              isActive: true,
            },
          ],
          pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        }, "Products fetched"),
        "401": unauthorized(STALE_TOKEN_401),
        "403": productsReadForbidden(),
        "429": rateLimited,
        "500": serverError,
      },
    },
    post: {
      tags: ["Products"],
      summary: "Create a product (admin only)",
      operationId: "createProduct",
      description:
        "Creates a product (+ nested details + gallery images). Requires the `Admin` role. The " +
        "**conditional price rule** applies by business type — Alquiler: `rentPrice` + " +
        "`rentTimeUnitId`, no `sellPrice`; Venta: `sellPrice` only. `images` reference R2 keys " +
        "minted by `/products/images/upload-url` (files already uploaded; at most one `isPrimary`, " +
        "defaulting to the first). Any rule violation or unknown lookup id is a `400`. Returns the " +
        "created product in the SAME role-projected shape the list uses. Authenticated limiter " +
        "(100/min).",
      security: [{ ApiKeyAuth: [], BearerAuth: [] }],
      requestBody: bodyRef("CreateProductRequest", {
        name: EXAMPLE_PRODUCT_NAME,
        description: EXAMPLE_PRODUCT_DESCRIPTION,
        businessTypeId: 1,
        categoryId: 1,
        currencyId: 1,
        quantity: 40,
        rentPrice: 75,
        rentTimeUnitId: 2,
        replacementPrice: 900,
        productDetails: [{ detailTypeId: 1, detail: "Blanco" }],
        images: [
          { key: "products/3f9d2c1a-8b4e-4f6a-9c2d-1e5b7a9d3c0f.webp", isPrimary: true },
        ],
      }),
      responses: {
        "201": dataResponse(
          "The created product, projected for the caller's role (Admin — full view).",
          "ProductListItem",
          {
            id: 7,
            name: EXAMPLE_PRODUCT_NAME,
            description: EXAMPLE_PRODUCT_DESCRIPTION,
            businessType: "Alquiler",
            businessTypeId: 1,
            category: "Mesas",
            categoryId: 1,
            currency: { id: 1, iso4217Code: "GTQ", name: EXAMPLE_CURRENCY_NAME, symbol: "Q" },
            rentPrice: 75,
            sellPrice: null,
            rentTimeUnit: "Día",
            rentTimeUnitId: 2,
            images: [],
            details: [{ id: 12, detail: "Blanco", detailType: "Color", detailTypeId: 1 }],
            inStock: true,
            available: 40,
            total: 40,
            replacementPrice: 900,
            isActive: true,
          },
          "Product created",
          201,
        ),
        "400": errorResponse(
          "A field failed validation — bad lookup id, out-of-range value, a conditional-pricing " +
            "violation, or an image key already owned by another product (unique `r2_key`).",
          400,
          "Los precios enviados no corresponden al tipo de negocio del producto.",
        ),
        "401": unauthorized(STALE_TOKEN_401),
        "403": adminOnly(),
        "429": rateLimited,
        "500": serverError,
      },
    },
  },

  "/products/{id}": {
    get: {
      tags: ["Products"],
      summary: "Get one product (role-projected)",
      operationId: "getProductById",
      description:
        "Returns a single **active** product in the exact role-projected shape of a list item " +
        "(Admin sees the availability + internal fields incl. the Alquiler fleet `total`, a Client " +
        "sees only the shared catalog fields). A malformed id and an unknown/soft-deleted product " +
        "are both a plain `404`. **Admin + Client only** (any other role gets a `403`). " +
        "Authenticated limiter (100/min).",
      security: [{ ApiKeyAuth: [], BearerAuth: [] }],
      parameters: [
        {
          name: "id",
          in: "path",
          required: true,
          description: "The product id.",
          schema: { type: "integer", minimum: 1 },
        },
      ],
      responses: {
        "200": dataResponse("The role-projected product (example shows the Admin view).", "ProductDetailResponse", {
          product: {
            id: 7,
            name: EXAMPLE_PRODUCT_NAME,
            description: EXAMPLE_PRODUCT_DESCRIPTION,
            businessType: "Alquiler",
            businessTypeId: 1,
            category: "Mesas",
            categoryId: 1,
            currency: { id: 1, iso4217Code: "GTQ", name: EXAMPLE_CURRENCY_NAME, symbol: "Q" },
            rentPrice: 75,
            sellPrice: null,
            rentTimeUnit: "Día",
            rentTimeUnitId: 2,
            images: [{ id: 1, url: "https://cdn.example.com/products/7/hero.webp", isPrimary: true, sortOrder: 0 }],
            details: [{ id: 12, detail: "Blanco", detailType: "Color", detailTypeId: 1 }],
            inStock: true,
            available: 35,
            total: 40,
            replacementPrice: 900,
            isActive: true,
          },
        }, "Product fetched"),
        "401": unauthorized(STALE_TOKEN_401),
        "403": productsReadForbidden(),
        "404": errorResponse("Unknown, malformed, or soft-deleted product id.", 404, "Product not found"),
        "429": rateLimited,
        "500": serverError,
      },
    },
    put: {
      tags: ["Products"],
      summary: "Update a product declaratively (admin only)",
      operationId: "updateProduct",
      description:
        "Replaces the product with its FULL desired state — the RECONCILE design: the body carries " +
        "the final scalars, detail list, and gallery, and the backend diffs them against the " +
        "current rows in ONE transaction (kept rows update, absent rows are deleted, new rows are " +
        "created; removed photos' R2 objects are deleted only AFTER the commit). Requires the " +
        "`Admin` role. The same conditional-price and gallery rules as create apply. A kept " +
        "image/detail id that no longer exists (a concurrent edit) is a `409` — reload and retry. " +
        "Returns the updated product in the role-projected list shape. Authenticated limiter (100/min).",
      security: [{ ApiKeyAuth: [], BearerAuth: [] }],
      parameters: [
        {
          name: "id",
          in: "path",
          required: true,
          description: "The product id.",
          schema: { type: "integer", minimum: 1 },
        },
      ],
      requestBody: bodyRef("UpdateProductRequest", {
        name: EXAMPLE_PRODUCT_NAME,
        description: EXAMPLE_PRODUCT_DESCRIPTION,
        businessTypeId: 1,
        categoryId: 1,
        currencyId: 1,
        quantity: 40,
        rentPrice: 75,
        rentTimeUnitId: 2,
        replacementPrice: 900,
        productDetails: [
          { id: 12, detailTypeId: 1, detail: "Blanco" },
          { detailTypeId: 2, detail: "Madera" },
        ],
        images: [
          { id: 1, isPrimary: true },
          { key: "products/3f9d2c1a-8b4e-4f6a-9c2d-1e5b7a9d3c0f.webp" },
        ],
      }),
      responses: {
        "200": dataResponse(
          "The updated product, projected for the caller's role (Admin — full view).",
          "ProductListItem",
          {
            id: 7,
            name: EXAMPLE_PRODUCT_NAME,
            description: EXAMPLE_PRODUCT_DESCRIPTION,
            businessType: "Alquiler",
            businessTypeId: 1,
            category: "Mesas",
            categoryId: 1,
            currency: { id: 1, iso4217Code: "GTQ", name: EXAMPLE_CURRENCY_NAME, symbol: "Q" },
            rentPrice: 75,
            sellPrice: null,
            rentTimeUnit: "Día",
            rentTimeUnitId: 2,
            images: [{ id: 1, url: "https://cdn.example.com/products/7/hero.webp", isPrimary: true, sortOrder: 0 }],
            details: [{ id: 12, detail: "Blanco", detailType: "Color", detailTypeId: 1 }],
            inStock: true,
            available: 35,
            total: 40,
            replacementPrice: 900,
            isActive: true,
          },
          "Product updated",
        ),
        "400": errorResponse(
          "A field failed validation — bad lookup id, a conditional-pricing violation, a malformed " +
            "gallery slot (must carry exactly one of `id`/`key`), an image/detail id that doesn't " +
            "belong to the product, or an image key already owned by another product.",
          400,
          "Los precios enviados no corresponden al tipo de negocio del producto.",
        ),
        "401": unauthorized(STALE_TOKEN_401),
        "403": adminOnly(),
        "404": errorResponse("Unknown, malformed, or soft-deleted product id.", 404, "Product not found"),
        "409": errorResponse(
          "A kept image/detail id no longer exists — the product changed under the editor " +
            "(a concurrent save/delete). Reload and retry.",
          409,
          "El producto cambió mientras lo editabas. Recarga la página e intenta de nuevo.",
        ),
        "429": rateLimited,
        "500": serverError,
      },
    },
    delete: {
      tags: ["Products"],
      summary: "Delete a product (admin only, no-trash policy)",
      operationId: "deleteProduct",
      description:
        "Deletes a product under the NO-TRASH policy: the row survives as a soft-deleted tombstone " +
        "ONLY when order history references it (erasing it would falsify past orders); otherwise " +
        "it is hard-deleted. Its detail and gallery rows are hard-deleted either way, and the " +
        "gallery's R2 objects are removed after the commit in one batched call (best-effort). " +
        "Requires the `Admin` role. Authenticated limiter (100/min).",
      security: [{ ApiKeyAuth: [], BearerAuth: [] }],
      parameters: [
        {
          name: "id",
          in: "path",
          required: true,
          description: "The product id.",
          schema: { type: "integer", minimum: 1 },
        },
      ],
      responses: {
        "200": messageResponse("The product is gone from the catalog.", "Product deleted"),
        "401": unauthorized(STALE_TOKEN_401),
        "403": adminOnly(),
        "404": errorResponse("Unknown, malformed, or already-deleted product id.", 404, "Product not found"),
        "429": rateLimited,
        "500": serverError,
      },
    },
  },

  "/products/images/upload-url": {
    post: {
      tags: ["Products"],
      summary: "Mint presigned R2 upload URLs for gallery images (admin only)",
      operationId: "createProductImageUploads",
      description:
        "Returns short-lived (5 min) **presigned PUT URLs** so the browser uploads product photos " +
        "STRAIGHT to R2 — the image bytes never pass through the API. Requires the `Admin` role. " +
        "1–8 files per call; each file's content type must be a whitelisted image type " +
        "(`image/jpeg`, `image/png`, `image/webp`, `image/avif`) and its exact size ≤ 5 MB — both " +
        "are bound into the signature, so a minted URL can't upload anything else. Reference the " +
        "returned `key`s in `POST /products`. Authenticated limiter (100/min).",
      security: [{ ApiKeyAuth: [], BearerAuth: [] }],
      requestBody: bodyRef("CreateProductImageUploadsRequest", {
        files: [{ contentType: "image/webp", contentLength: 245760 }],
      }),
      responses: {
        "200": dataResponse(
          "The minted uploads, in request order.",
          "ProductImageUploads",
          {
            uploads: [
              {
                uploadUrl:
                  "https://account.r2.cloudflarestorage.com/bucket/products/3f9d2c1a-8b4e-4f6a-9c2d-1e5b7a9d3c0f.webp?X-Amz-Signature=abc123",
                key: "products/3f9d2c1a-8b4e-4f6a-9c2d-1e5b7a9d3c0f.webp",
                publicUrl: "https://cdn.example.com/products/3f9d2c1a-8b4e-4f6a-9c2d-1e5b7a9d3c0f.webp",
              },
            ],
          },
          "Upload URLs created",
        ),
        "400": errorResponse(
          "Missing/empty file list, more than 8 files, a non-whitelisted content type, or an invalid size.",
          400,
          "El tipo de archivo no está permitido.",
        ),
        "401": unauthorized(STALE_TOKEN_401),
        "403": adminOnly(),
        "429": rateLimited,
        "500": serverError,
      },
    },
  },

  "/products/catalog": {
    get: {
      tags: ["Products"],
      summary: "Product reference lookups (selects data)",
      operationId: "getProductCatalog",
      description:
        "The seeded reference lists the product create/edit form renders as selects — business types, " +
        "categories, currencies, rent time units, and detail types (active rows, id order). " +
        "**Admin + Client only**, like every products read (any other role gets a `403`). " +
        "Authenticated limiter (100/min).",
      security: [{ ApiKeyAuth: [], BearerAuth: [] }],
      responses: {
        "200": dataResponse("The five reference lists.", "ProductCatalog", {
          businessTypes: [
            { id: 1, name: "Alquiler" },
            { id: 2, name: "Venta" },
          ],
          categories: [
            { id: 1, name: "Mesas" },
            { id: 2, name: "Sillas" },
          ],
          currencies: [{ id: 1, name: EXAMPLE_CURRENCY_NAME, iso4217Code: "GTQ", symbol: "Q" }],
          detailTypes: [
            { id: 1, name: "Color" },
            { id: 2, name: "Material" },
          ],
          rentTimeUnits: [
            { id: 1, name: "Hora" },
            { id: 2, name: "Día" },
          ],
        }, "Catalog fetched"),
        "401": unauthorized(STALE_TOKEN_401),
        "403": productsReadForbidden(),
        "429": rateLimited,
        "500": serverError,
      },
    },
  },

  "/orders": {
    get: {
      tags: ["Orders"],
      summary: "List orders (agenda / history views)",
      operationId: "getOrders",
      description:
        "Returns the paginated order list behind the panel's segmented control, **row-scoped by " +
        "role**: an **Admin** sees every order (each tagged `isMine` vs the rest); a **Driver** " +
        "sees ONLY orders assigned to them. `view=agenda` (default) = every order that is still " +
        "WORK — upcoming, en route, delivered, or collected-awaiting-the-final-\"listo\" — ordered " +
        "MINE-first then by the soonest NEXT ACTION (its delivery, then its pickup, then the " +
        "\"listo\"), not raw delivery time; `view=history` = finished (`readyAt` set) or cancelled " +
        "orders, newest first. Pagination, `view` and the `statusId` filter are clamped or dropped " +
        "(never rejected), so there is no 400. Authenticated limiter (100/min).",
      security: [{ ApiKeyAuth: [], BearerAuth: [] }],
      parameters: [
        {
          name: "page",
          in: "query",
          required: false,
          description: "1-based page number (clamped to ≥ 1).",
          schema: { type: "integer", minimum: 1, default: 1 },
        },
        {
          name: "pageSize",
          in: "query",
          required: false,
          description: "Items per page (clamped to 1–100).",
          schema: { type: "integer", minimum: 1, maximum: 100, default: 20 },
        },
        {
          name: "view",
          in: "query",
          required: false,
          description:
            "Which slice of orders: `agenda` = still-work rows (schedule order), `history` = " +
            "finished or cancelled rows (log order). An unknown value clamps to `agenda`.",
          schema: { type: "string", enum: ["agenda", "history"], default: "agenda" },
        },
        {
          name: "statusId",
          in: "query",
          required: false,
          description:
            "Filter by order status id within the view (see `GET /orders/catalog`). A " +
            "non-positive or unknown id is ignored or matches nothing.",
          schema: { type: "integer", minimum: 1 },
        },
      ],
      responses: {
        "200": dataResponse("One page of orders for the requested view.", "OrderListResponse", {
          orders: [
            {
              id: 12,
              clientName: EXAMPLE_CLIENT_NAME,
              isRegistryClient: false,
              eventType: { id: 1, name: EXAMPLE_EVENT_TYPE },
              status: { id: 1, name: EXAMPLE_STATUS_PENDING },
              paymentStatus: { id: 1, name: EXAMPLE_STATUS_PENDING },
              deliveryAt: EXAMPLE_DELIVERY_AT,
              pickupAt: EXAMPLE_PICKUP_AT,
              assignee: { id: 2, name: "Romeo Marroquín" },
              isMine: true,
              itemCount: 25,
              totalAmount: 450,
              currency: { id: 1, name: EXAMPLE_CURRENCY_NAME, iso4217Code: "GTQ", symbol: "Q" },
            },
          ],
          pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        }, "Orders fetched"),
        "401": unauthorized(STALE_TOKEN_401),
        "403": ordersListForbidden(),
        "429": rateLimited,
        "500": serverError,
      },
    },
    post: {
      tags: ["Orders"],
      summary: "Create an order (admin, walk-in client)",
      operationId: "createOrder",
      description:
        "**STRICTLY Admin** (owner rule: only the admin creates orders — no employee role " +
        "inherits this). Creates a CONFIRMED order (stock freezes immediately — no reservation " +
        "step) for a walk-in client registry. Everything racy runs in ONE transaction under " +
        "product row locks: rental availability against the order's WINDOW, sale stock (which is " +
        "decremented permanently), and the LOGISTICS PAD — each event occupies a block of its " +
        "assigned DRIVER's day (±half the configured gap per side, so two events on one driver " +
        "need the full gap between them), including the order's own delivery vs collection. The " +
        "admin is blocked too. Money is derived server-side from the product rows.\n\n" +
        "**The payment METHOD is not part of this body.** `services.paymentMethodId` records how the " +
        "order was actually paid, which has not happened at create time — accepting it here stored a " +
        "prediction as a fact. `POST /orders/{id}/payment` is the only door that writes it. " +
        "Authenticated limiter (100/min).",
      security: [{ ApiKeyAuth: [], BearerAuth: [] }],
      requestBody: bodyRef("CreateOrderRequest", {
        clientRegistryId: 3,
        eventTypeId: 1,
        deliveryAt: EXAMPLE_DELIVERY_AT,
        pickupAt: EXAMPLE_PICKUP_AT,
        deliveryName: EXAMPLE_CLIENT_NAME,
        deliveryContact: EXAMPLE_ORDER_CONTACT,
        deliveryAddress: EXAMPLE_ORDER_ADDRESS,
        deliveryAmount: 50,
        assignedUserId: 2,
        lines: [{ productId: 3, quantity: 25 }],
      }),
      responses: {
        "201": dataResponse("The created order (the same detail shape as `GET /orders/{id}`).", "OrderDetailResponse", {
          order: {
            id: 12,
            clientName: EXAMPLE_CLIENT_NAME,
            isRegistryClient: true,
            eventType: { id: 1, name: EXAMPLE_EVENT_TYPE },
            status: { id: 1, name: EXAMPLE_STATUS_PENDING },
            paymentStatus: { id: 1, name: EXAMPLE_STATUS_PENDING },
            deliveryAt: EXAMPLE_DELIVERY_AT,
            pickupAt: EXAMPLE_PICKUP_AT,
            itemCount: 25,
            totalAmount: 200,
            currency: { id: 1, name: EXAMPLE_CURRENCY_NAME, iso4217Code: "GTQ", symbol: "Q" },
            deliveryContact: EXAMPLE_ORDER_CONTACT,
            deliveryAddress: EXAMPLE_ORDER_ADDRESS,
            serviceStart: EXAMPLE_DELIVERY_AT,
            serviceEnd: EXAMPLE_PICKUP_AT,
            deliveryAmount: 50,
            lines: [
              {
                id: 31,
                productId: 3,
                productName: EXAMPLE_LINE_PRODUCT_NAME,
                isRental: true,
                quantity: 25,
                unitaryPrice: 6,
                parcialPrice: 150,
              },
            ],
            extras: [],
            statusHistory: [
              {
                id: 1,
                to: { id: 1, name: EXAMPLE_STATUS_PENDING },
                byUserName: EXAMPLE_ADMIN_NAME,
                at: EXAMPLE_ORDER_CREATED_AT,
              },
            ],
            createdAt: EXAMPLE_ORDER_CREATED_AT,
          },
        }, "Order created"),
        "400": errorResponse(
          "Validation failed (unknown registry/event type/product, a delivery scheduled in the " +
            "past, incoherent pickup for the order's mode, bad snapshot fields, unsupported rent " +
            "unit, mixed currencies…).",
          400,
          "An order with rentals requires a pickup time",
        ),
        "401": unauthorized(STALE_TOKEN_401),
        "403": adminOnly(),
        "409": errorResponse(
          "The window cannot be satisfied, and `data` says WHICH rule refused — the three payloads " +
            "are deliberately distinct, because they land on different fields: `conflicts` (a list " +
            "of `OrderStockConflictItem`) = lines lacking stock → the line's quantity input; " +
            "`driverConflict` (`DriverConflict` + `driverName` + `gapMinutes`) = the assigned " +
            "driver already has an overlapping block → the date inputs; `selfOverlap` " +
            "(`{ gapMinutes }`) = this order's own delivery and collection are too close together.",
          409,
          "Some products are not available for the requested dates",
        ),
        "429": rateLimited,
        "500": serverError,
      },
    },
  },

  "/orders/availability": {
    post: {
      tags: ["Orders"],
      summary: "Live per-window availability: goods AND driver (admin)",
      operationId: "getOrderAvailability",
      description:
        "**Admin only.** The order form's live probe, answering both scheduling questions on one " +
        "keystroke. **Goods:** each product's takeable amount for the window — rentals = fleet " +
        "minus what's held (`null` until a pickup is set), sales = current stock; exact counts " +
        "(the admin runs the business). **Driver:** sent only when the body carries an " +
        "`assignedUserId` — whether either event would overlap a block already on that driver's " +
        "day, plus whether the order's own two events are too close to each other. An `EDIT` " +
        "passes `excludeOrderId` so both halves drop the order from their own counts, and a " +
        "cancelled or already-performed order answers free in both — the probe asks exactly the " +
        "question the save asks. Read-only + " +
        "ADVISORY in both halves — create/edit re-derive everything under the product locks and " +
        "that `409` is the authority. Authenticated limiter (100/min).",
      security: [{ ApiKeyAuth: [], BearerAuth: [] }],
      requestBody: bodyRef("OrderAvailabilityRequest", {
        deliveryAt: EXAMPLE_DELIVERY_AT,
        pickupAt: EXAMPLE_PICKUP_AT,
        productIds: [3, 4],
        assignedUserId: 2,
      }),
      responses: {
        "200": dataResponse("Per-product availability for the window, plus the driver's.", "OrderAvailabilityResponse", {
          availability: [
            { productId: 3, available: 10 },
            { productId: 4, available: 120 },
          ],
          driver: {
            available: false,
            gapMinutes: 60,
            selfOverlap: false,
            conflicts: [
              { orderId: 42, at: EXAMPLE_DELIVERY_AT, kind: "DELIVERY", blocks: "DELIVERY" },
            ],
          },
        }),
        "400": errorResponse(
          "Validation failed (bad delivery/pickup datetime, pickup not after delivery, empty or " +
            "invalid product ids, a non-id `assignedUserId`/`excludeOrderId`).",
          400,
          "The requested products are not valid",
        ),
        "401": unauthorized(STALE_TOKEN_401),
        "403": adminOnly(),
        "429": rateLimited,
        "500": serverError,
      },
    },
  },

  "/orders/catalog": {
    get: {
      tags: ["Orders"],
      summary: "Order reference lookups (selects data)",
      operationId: "getOrdersCatalog",
      description:
        "The seeded reference lists the orders section consumes — event types (with their client " +
        "lead-times), order + payment statuses (filters/chips), the contact types + zones the " +
        "client-registry form needs, and the **staff an order can be assigned to** (the deliverable " +
        "roles — Admin + Driver — with decrypted names). Active rows, id order. **Admin only**, like " +
        "every orders read today. Authenticated limiter (100/min).",
      security: [{ ApiKeyAuth: [], BearerAuth: [] }],
      responses: {
        "200": dataResponse("The five reference lists.", "OrderCatalog", {
          eventTypes: [
            { id: 1, name: "Evento familiar", minLeadHours: 24 },
            { id: 2, name: "Evento social", minLeadHours: 24 },
            { id: 3, name: "Otro", minLeadHours: 24 },
          ],
          serviceStatuses: [
            { id: 1, name: EXAMPLE_STATUS_PENDING },
            { id: 5, name: "En ruta" },
          ],
          paymentStatuses: [
            { id: 1, name: EXAMPLE_STATUS_PENDING },
            { id: 2, name: "Pagado" },
          ],
          contactTypes: [
            { id: 1, name: "WhatsApp" },
            { id: 3, name: "Correo electrónico" },
          ],
          zones: [{ id: 1, name: "Zona 1" }],
          assignableUsers: [
            { id: 2, name: "Romeo Marroquín", role: "Administrador" },
            { id: 3, name: "Ana Díaz", role: "Repartidor" },
          ],
        }, "Catalog fetched"),
        "401": unauthorized(STALE_TOKEN_401),
        "403": adminOnly(),
        "429": rateLimited,
        "500": serverError,
      },
    },
  },

  "/orders/{id}": {
    get: {
      tags: ["Orders"],
      summary: "Get one order (full detail)",
      operationId: "getOrderById",
      description:
        "One order with everything the detail page renders: the decrypted contact/address " +
        "SNAPSHOTS captured at order time, the billed period, the money breakdown (delivery fee, " +
        "deposit, discount, payment), the lines (with their rent-vs-sale snapshot), the extras, " +
        "and the append-only status audit trail. **Admin only.** A malformed and an unknown id " +
        "are both a plain `404`. Authenticated limiter (100/min).",
      security: [{ ApiKeyAuth: [], BearerAuth: [] }],
      parameters: [
        {
          name: "id",
          in: "path",
          required: true,
          description: "The order id.",
          schema: { type: "integer", minimum: 1 },
          example: 12,
        },
      ],
      responses: {
        "200": dataResponse("The full order.", "OrderDetailResponse", {
          order: {
            id: 12,
            clientName: EXAMPLE_CLIENT_NAME,
            isRegistryClient: false,
            eventType: { id: 1, name: EXAMPLE_EVENT_TYPE },
            status: { id: 1, name: EXAMPLE_STATUS_PENDING },
            paymentStatus: { id: 1, name: EXAMPLE_STATUS_PENDING },
            deliveryAt: EXAMPLE_DELIVERY_AT,
            pickupAt: EXAMPLE_PICKUP_AT,
            itemCount: 25,
            totalAmount: 450,
            currency: { id: 1, name: EXAMPLE_CURRENCY_NAME, iso4217Code: "GTQ", symbol: "Q" },
            deliveryContact: EXAMPLE_ORDER_CONTACT,
            deliveryAddress: EXAMPLE_ORDER_ADDRESS,
            serviceStart: EXAMPLE_DELIVERY_AT,
            serviceEnd: EXAMPLE_PICKUP_AT,
            deliveryAmount: 50,
            lines: [
              {
                id: 31,
                productId: 3,
                productName: EXAMPLE_LINE_PRODUCT_NAME,
                isRental: true,
                quantity: 25,
                unitaryPrice: 6,
                parcialPrice: 150,
              },
            ],
            extras: [],
            statusHistory: [
              {
                id: 1,
                to: { id: 1, name: EXAMPLE_STATUS_PENDING },
                byUserName: EXAMPLE_ADMIN_NAME,
                at: EXAMPLE_ORDER_CREATED_AT,
              },
            ],
            createdAt: EXAMPLE_ORDER_CREATED_AT,
          },
        }, "Order fetched"),
        "401": unauthorized(STALE_TOKEN_401),
        "403": adminOnly(),
        "404": errorResponse(
          "The order does not exist (or the id is malformed).",
          404,
          "Order not found",
        ),
        "429": rateLimited,
        "500": serverError,
      },
    },
    put: {
      tags: ["Orders"],
      summary: "Edit an order (admin, full declarative state)",
      operationId: "updateOrder",
      description:
        "**STRICTLY Admin.** DECLARATIVE, like the product update: the body is the order's FINAL " +
        "state (identity, snapshots, window, assignment, money and the COMPLETE line list) and the " +
        "server diffs it in one transaction — there is deliberately no per-field or per-line " +
        "endpoint. It is validated by the **same contract as create**, with one difference: the " +
        "delivery may stay on a date that has already passed (correcting yesterday's order), but " +
        "may never be MOVED into the past.\n\n" +
        "**An edit never touches PAYMENT** — `paymentMethodId`, `paidAt` and `paymentStatusId` are " +
        "absent from the body on purpose, exactly as it never touches the lifecycle. This endpoint " +
        "rewrites what was AGREED; what HAPPENED belongs to its own door. Otherwise a declarative " +
        "full-state save would erase a recorded payment every time somebody fixed a typo.\n\n" +
        "Everything is re-derived, nothing trusted: prices come from the product rows and the new " +
        "billed window (so moving the dates re-bills the order), sale stock moves by the " +
        "DIFFERENCE and only while the order still holds it (`holdsSaleStock`), and rental " +
        "availability plus the logistics pad are re-checked **excluding this order** — it is " +
        "holding its own current lines and already occupies its own blocks, so it can never " +
        "conflict with itself. The pad is checked against the NEW assignee, so handing the order " +
        "to another driver is validated against THAT driver's day. An order whose status reserves " +
        "nothing (finished, or cancelled) is a pure paperwork edit as far as stock is concerned.\n\n" +
        "The lifecycle is untouched: an edit never moves the status, stamps an actual or writes " +
        "history — that is `POST /orders/{id}/advance`'s job alone. Authenticated limiter (100/min).",
      security: [{ ApiKeyAuth: [], BearerAuth: [] }],
      parameters: [
        {
          name: "id",
          in: "path",
          required: true,
          description: "The order id.",
          schema: { type: "integer", minimum: 1 },
          example: 12,
        },
      ],
      requestBody: bodyRef("CreateOrderRequest", {
        clientRegistryId: 3,
        eventTypeId: 1,
        deliveryAt: EXAMPLE_DELIVERY_AT,
        pickupAt: EXAMPLE_PICKUP_AT,
        deliveryName: EXAMPLE_CLIENT_NAME,
        deliveryContact: EXAMPLE_ORDER_CONTACT,
        deliveryAddress: EXAMPLE_ORDER_ADDRESS,
        deliveryAmount: 50,
        assignedUserId: 2,
        lines: [{ productId: 3, quantity: 30 }],
      }),
      responses: {
        "200": dataResponse(
          "The updated order (the same detail shape as `GET /orders/{id}`).",
          "OrderDetailResponse",
          {
            order: {
              id: 12,
              clientName: EXAMPLE_CLIENT_NAME,
              isRegistryClient: true,
              eventType: { id: 1, name: EXAMPLE_EVENT_TYPE },
              status: { id: 1, name: EXAMPLE_STATUS_PENDING },
              paymentStatus: { id: 1, name: EXAMPLE_STATUS_PENDING },
              deliveryAt: EXAMPLE_DELIVERY_AT,
              pickupAt: EXAMPLE_PICKUP_AT,
              itemCount: 30,
              totalAmount: 230,
              currency: { id: 1, name: EXAMPLE_CURRENCY_NAME, iso4217Code: "GTQ", symbol: "Q" },
              deliveryContact: EXAMPLE_ORDER_CONTACT,
              deliveryAddress: EXAMPLE_ORDER_ADDRESS,
              serviceStart: EXAMPLE_DELIVERY_AT,
              serviceEnd: EXAMPLE_PICKUP_AT,
              deliveryAmount: 50,
              lines: [
                {
                  id: 31,
                  productId: 3,
                  productName: EXAMPLE_LINE_PRODUCT_NAME,
                  isRental: true,
                  quantity: 30,
                  unitaryPrice: 6,
                  parcialPrice: 180,
                },
              ],
              extras: [],
              statusHistory: [
                {
                  id: 1,
                  to: { id: 1, name: EXAMPLE_STATUS_PENDING },
                  byUserName: EXAMPLE_ADMIN_NAME,
                  at: EXAMPLE_ORDER_CREATED_AT,
                },
              ],
              createdAt: EXAMPLE_ORDER_CREATED_AT,
            },
          },
          "Order updated",
        ),
        "400": errorResponse(
          "The body failed the order contract (same rules as create; plus the delivery may not be " +
            "moved into the past).",
          400,
          "The pickup must be after the delivery.",
        ),
        "401": unauthorized(STALE_TOKEN_401),
        "403": adminOnly(),
        "404": errorResponse(
          "The order does not exist (or the id is malformed).",
          404,
          "Order not found",
        ),
        "409": errorResponse(
          "Availability or the logistics pad refused the new state — `data` carries `conflicts`, " +
            "`driverConflict` or `selfOverlap`, exactly the same three shapes as create. An order " +
            "that reserves nothing (cancelled, or finished) and whose events have already happened " +
            "can never reach this: its edit competes for no goods and occupies no driver, so it is " +
            "pure paperwork.",
          409,
          "Some products are not available for the requested dates.",
        ),
        "429": rateLimited,
        "500": serverError,
      },
    },
    delete: {
      tags: ["Orders"],
      summary: "Permanently delete an order (admin)",
      operationId: "deleteOrder",
      description:
        "**STRICTLY Admin, and genuinely permanent.** Cancelling is how an order that HAPPENED is " +
        "closed; this is for one that should never have existed, so nothing of it is kept: in one " +
        "transaction it destroys the evidence rows, the status history, the lines and the extras, " +
        "then the order — and **returns the sale stock** those lines consumed at creation (rental " +
        "holds need nothing: they are derived from the status and vanish with the row). The " +
        "evidence's R2 objects are deleted after the commit, best-effort. There is no undo. " +
        "Authenticated limiter (100/min).",
      security: [{ ApiKeyAuth: [], BearerAuth: [] }],
      parameters: [
        {
          name: "id",
          in: "path",
          required: true,
          description: "The order id.",
          schema: { type: "integer", minimum: 1 },
          example: 12,
        },
      ],
      responses: {
        "200": messageResponse("The order and everything belonging to it are gone.", "Order permanently deleted"),
        "401": unauthorized(STALE_TOKEN_401),
        "403": adminOnly(),
        "404": errorResponse(
          "The order does not exist (or the id is malformed).",
          404,
          "Order not found",
        ),
        "429": rateLimited,
        "500": serverError,
      },
    },
  },

  "/orders/{id}/advance": {
    post: {
      tags: ["Orders"],
      summary: "Move an order through its lifecycle (advance / rewind / cancel)",
      operationId: "advanceOrder",
      description:
        "**The single mutating door of the order lifecycle**, for every actor and every kind of " +
        "move. The client does NOT say which kind it wants — it names the target status (one the " +
        "order's `actions` offered) and the engine decides whether that is a forward step, an " +
        "admin rewind or a disruptive exit, and whether this actor may make it.\n\n" +
        "**Admin + Driver.** An Admin may advance, rewind and cancel any order; a Driver may " +
        "advance and cancel (with a reason) **only orders assigned to them**, never rewind.\n\n" +
        "Everything racy happens in ONE transaction: the order row is locked (`SELECT … FOR " +
        "UPDATE`), the move is re-authorised under the lock (a stale client gets a clean `409`, " +
        "never a double-advance), the target's evidence requirement is checked against its " +
        "resolved bounds (`422`), the pre-uploaded R2 keys become evidence rows for the phase " +
        "being entered, the append-only status-history row is written, and the order's status + " +
        "tracked actuals (`deliveredAt`/`collectedAt`/`readyAt`/`cancelledAt`) are stamped from " +
        "the status FLAGS. Rental availability needs no write — holds are derived from " +
        "`inventoryHold`, so the status change alone returns (or keeps) the units.\n\n" +
        "Returns the same `{ order }` envelope as `GET /orders/{id}`. Authenticated limiter (100/min).",
      security: [{ ApiKeyAuth: [], BearerAuth: [] }],
      parameters: [
        {
          name: "id",
          in: "path",
          required: true,
          description: "The order id.",
          schema: { type: "integer", minimum: 1 },
          example: 12,
        },
      ],
      requestBody: bodyRef("AdvanceOrderRequest", {
        toStatusId: 3,
        evidence: [
          {
            statusId: 3,
            keys: ["orders/evidence/a1b2c3d4-e5f6-4789-a0b1-c2d3e4f5a6b7.jpg"],
          },
        ],
      }),
      responses: {
        "200": dataResponse(
          "The order after the move, in the detail shape (its `actions` now describe what comes next).",
          "OrderDetailResponse",
          {
            order: {
              id: 12,
              clientName: EXAMPLE_CLIENT_NAME,
              status: { id: 3, name: "Entregado", colorKey: "emerald" },
              nextStatus: { id: 4, name: "Recolectado" },
              deliveredAt: EXAMPLE_DELIVERY_AT,
            },
          },
          "Order status updated",
        ),
        "400": errorResponse(
          "Validation failed (missing/invalid `toStatusId`, evidence keys outside the orders' " +
            "evidence namespace, or an oversized reason).",
          400,
          "The target order status is not valid",
        ),
        "401": unauthorized(STALE_TOKEN_401),
        "403": errorResponse(
          "The move is legal from here, but not for THIS actor — a Driver on an order that isn't " +
            "theirs, or a Driver attempting a rewind.",
          403,
          "You are not allowed to make this change to the order",
        ),
        "404": errorResponse(
          "The order does not exist (or the id is malformed).",
          404,
          "Order not found",
        ),
        "409": errorResponse(
          "Not a legal move from the order's current status for ANYONE — an unknown target, a " +
            "skipped step, or an order that already moved (stale client). Refetch and retry.",
          409,
          "The order already changed status. Refresh and try again",
        ),
        "422": errorResponse(
          "The target step demands photo evidence and the submitted count is outside its resolved " +
            "`[minEvidence, maxEvidence]` range.",
          422,
          "The evidence photos required for this step are incomplete",
        ),
        "429": rateLimited,
        "500": serverError,
      },
    },
  },

  "/orders/evidence/upload-url": {
    post: {
      tags: ["Orders"],
      summary: "Mint presigned R2 uploads for tracking evidence",
      operationId: "createOrderEvidenceUploads",
      description:
        "**Admin + Driver.** Mints short-lived presigned PUT URLs so the browser uploads tracking " +
        "photos straight to R2 (image bytes never pass through the API, which caps bodies at " +
        "10 kB). The client then hands the returned `key`s to `POST /orders/{id}/advance`, which " +
        "derives the public URL server-side — a client-sent URL is never trusted. Content type and " +
        "length are bound INTO the signature, so a minted URL can't store something bigger or of " +
        "another kind. Authenticated limiter (100/min).",
      security: [{ ApiKeyAuth: [], BearerAuth: [] }],
      requestBody: bodyRef("OrderEvidenceUploadsRequest", {
        files: [{ contentType: "image/webp", contentLength: 204800 }],
      }),
      responses: {
        "200": dataResponse(
          "One presigned upload per requested file.",
          "OrderEvidenceUploadsResponse",
          {
            uploads: [
              {
                uploadUrl: "https://<account>.r2.cloudflarestorage.com/orders/evidence/…?X-Amz-Signature=…",
                key: "orders/evidence/a1b2c3d4-e5f6-4789-a0b1-c2d3e4f5a6b7.webp",
                publicUrl: "https://cdn.example.com/orders/evidence/a1b2c3d4-e5f6-4789-a0b1-c2d3e4f5a6b7.webp",
              },
            ],
          },
          "Upload URLs created",
        ),
        "400": errorResponse(
          "Validation failed (empty/oversized file list, or a file outside the storage policy — " +
            "unsupported content type or size).",
          400,
          "The requested evidence files are not valid",
        ),
        "401": unauthorized(STALE_TOKEN_401),
        "403": errorResponse(
          "The role may not upload order evidence (only Admin and Driver can).",
          403,
          "You do not have permission to perform this action",
        ),
        "429": rateLimited,
        "500": serverError,
      },
    },
  },

  "/client-registries": {
    get: {
      tags: ["Orders"],
      summary: "List walk-in client registries",
      operationId: "getClientRegistries",
      description:
        "The admin's walk-in clients (the WhatsApp/phone people) — the order form's client " +
        "picker. **STRICTLY Admin** (third-party PII no other role reads). Active rows only, " +
        "newest first, decrypted. Names are encrypted at rest, so there is no server-side " +
        "search — filter client-side. Authenticated limiter (100/min).",
      security: [{ ApiKeyAuth: [], BearerAuth: [] }],
      parameters: [
        {
          name: "page",
          in: "query",
          required: false,
          description: "1-based page number (clamped to ≥ 1).",
          schema: { type: "integer", minimum: 1, default: 1 },
        },
        {
          name: "pageSize",
          in: "query",
          required: false,
          description: "Items per page (clamped to 1–100).",
          schema: { type: "integer", minimum: 1, maximum: 100, default: 20 },
        },
      ],
      responses: {
        "200": dataResponse("One page of registries.", "ClientRegistryListResponse", {
          registries: [
            {
              id: 3,
              name: EXAMPLE_CLIENT_NAME,
              contacts: [
                { id: 1, contactType: { id: 1, name: "WhatsApp" }, value: "5555-1234", isPrincipal: true },
              ],
              addresses: [
                {
                  id: 1,
                  zone: { id: 6, name: "Zona 10" },
                  address: EXAMPLE_ORDER_ADDRESS,
                  isFavorite: true,
                },
              ],
              createdAt: EXAMPLE_ORDER_CREATED_AT,
            },
          ],
          pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        }, "Registries fetched"),
        "401": unauthorized(STALE_TOKEN_401),
        "403": adminOnly(),
        "429": rateLimited,
        "500": serverError,
      },
    },
    post: {
      tags: ["Orders"],
      summary: "Create a walk-in client registry",
      operationId: "createClientRegistry",
      description:
        "**STRICTLY Admin.** Registers a walk-in client: the responsible person, 1–10 contact " +
        "methods (exactly one principal — defaulted to the first) and 1–10 delivery addresses " +
        "(optional seeded zone; exactly one favorite, same defaulting). All PII encrypted at " +
        "rest. When this person later registers a platform account, the admin deletes the " +
        "registry (soft only while orders reference it) — orders keep their snapshots. " +
        "Authenticated limiter (100/min).",
      security: [{ ApiKeyAuth: [], BearerAuth: [] }],
      requestBody: bodyRef("CreateClientRegistryRequest", {
        name: EXAMPLE_CLIENT_NAME,
        contacts: [{ contactTypeId: 1, value: "5555-1234", isPrincipal: true }],
        addresses: [
          { zoneId: 6, address: EXAMPLE_ORDER_ADDRESS, isFavorite: true },
        ],
        preferredPaymentMethodId: 1,
      }),
      responses: {
        "201": dataResponse("The created registry (the list's shape).", "ClientRegistryResponse", {
          registry: {
            id: 3,
            name: EXAMPLE_CLIENT_NAME,
            contacts: [
              { id: 1, contactType: { id: 1, name: "WhatsApp" }, value: "5555-1234", isPrincipal: true },
            ],
            addresses: [
              {
                id: 1,
                zone: { id: 6, name: "Zona 10" },
                address: EXAMPLE_ORDER_ADDRESS,
                isFavorite: true,
              },
            ],
            createdAt: EXAMPLE_ORDER_CREATED_AT,
          },
        }, "Registry created"),
        "400": errorResponse(
          "Validation failed (bad name/notes, missing or invalid contacts/addresses, unknown " +
            "contact type or zone, duplicate principal/favorite flags).",
          400,
          "The client requires at least one contact method",
        ),
        "401": unauthorized(STALE_TOKEN_401),
        "403": adminOnly(),
        "429": rateLimited,
        "500": serverError,
      },
    },
  },

  "/client-registries/{id}": {
    put: {
      tags: ["Orders"],
      summary: "Edit a walk-in client registry",
      operationId: "updateClientRegistry",
      description:
        "**STRICTLY Admin.** DECLARATIVE: the body is the registry's FINAL state and is validated " +
        "by the very same contract as create (the identical middleware, so the two cannot drift). " +
        "Contacts and addresses are REPLACED, not diffed — nothing holds a foreign key to them " +
        "(an order records the contact/address TEXT it agreed, never a reference), so past orders " +
        "are untouched by construction. Editing a client today never rewrites where an order that " +
        "already happened was delivered. Authenticated limiter (100/min).",
      security: [{ ApiKeyAuth: [], BearerAuth: [] }],
      parameters: [
        {
          name: "id",
          in: "path",
          required: true,
          schema: { type: "integer", minimum: 1 },
          example: 3,
        },
      ],
      requestBody: bodyRef("CreateClientRegistryRequest", {
        name: EXAMPLE_CLIENT_NAME,
        contacts: [{ contactTypeId: 1, value: "5555-1234", isPrincipal: true }],
        addresses: [
          {
            zoneId: 6,
            address: EXAMPLE_ORDER_ADDRESS,
            instructions: "Portón negro, preguntar por el guardia",
            isFavorite: true,
          },
        ],
        preferredPaymentMethodId: 1,
      }),
      responses: {
        "200": dataResponse("The updated registry (the list's shape).", "ClientRegistryResponse", {
          registry: {
            id: 3,
            name: EXAMPLE_CLIENT_NAME,
            contacts: [
              { id: 9, contactType: { id: 1, name: "WhatsApp" }, value: "5555-1234", isPrincipal: true },
            ],
            addresses: [
              {
                id: 9,
                zone: { id: 6, name: "Zona 10" },
                address: EXAMPLE_ORDER_ADDRESS,
                instructions: "Portón negro, preguntar por el guardia",
                isFavorite: true,
              },
            ],
            createdAt: EXAMPLE_ORDER_CREATED_AT,
          },
        }, "Registry updated"),
        "400": errorResponse(
          "Validation failed — the same rules as create.",
          400,
          "The client requires at least one contact method",
        ),
        "401": unauthorized(STALE_TOKEN_401),
        "403": adminOnly(),
        "404": errorResponse("The registry does not exist (or the id is malformed).", 404, "Client not found"),
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
  "/orders/{id}/payment": {
    post: {
      tags: ["Orders"],
      summary: "Record that an order was paid (admin)",
      operationId: "payOrder",
      description:
        "**STRICTLY Admin.** Stamps `paidAt`, moves the order's payment status to PAID, and records " +
        "HOW it was paid when a method is supplied.\n\n" +
        "**Deliberately its own door rather than a step of the lifecycle.** Payment and fulfilment " +
        "are independent axes: a client can pay a deposit days before delivery, hand over cash at " +
        "the door, or settle a week after collection. Folding it into the pipeline would impose an " +
        "ordering the business does not have and would make 'delivered but unpaid' — the state the " +
        "admin most needs to see — unrepresentable. It never touches the service status, the " +
        "tracked actuals or stock.\n\n" +
        "An order that is ALREADY paid answers **`409`, not a silent success**: it means the caller " +
        "is looking at a stale screen, and re-stamping would overwrite the real payment date with " +
        "the moment of the second tap.",
      security: [{ ApiKeyAuth: [], BearerAuth: [] }],
      parameters: [
        {
          name: "id",
          in: "path",
          required: true,
          schema: { type: "integer", minimum: 1 },
          example: 12,
        },
      ],
      requestBody: {
        required: false,
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                paymentMethodId: {
                  type: "integer",
                  nullable: true,
                  description:
                    "OPTIONAL — an active `payment_methods` id. Omit it when the method was not " +
                    "recorded (cash at the door frequently is not).",
                  example: 1,
                },
              },
            },
          },
        },
      },
      responses: {
        "200": dataResponse(
          "The updated order, in the detail shape.",
          "OrderDetailResponse",
          { order: { id: 12, isPaid: true } },
          "Payment recorded",
        ),
        "400": errorResponse(
          "The id or the payment method is malformed.",
          400,
          "The payment method is not valid",
        ),
        "401": unauthorized(STALE_TOKEN_401),
        "403": adminOnly(),
        "404": errorResponse("No order with that id.", 404, "The order does not exist"),
        "409": errorResponse(
          "The order already has a payment recorded.",
          409,
          "This order already has a payment recorded",
        ),
        "429": rateLimited,
        "500": serverError,
      },
    },
  },

  "/dashboard": {
    get: {
      tags: ["Dashboard"],
      summary: "The admin home screen, in one call (admin)",
      operationId: "getDashboard",
      description:
        "**STRICTLY Admin.** The whole home screen in a single round trip: the three orders the " +
        "admin has to act on next, today's workload, this month against last month, what is still " +
        "owed, a twelve-month revenue trend, the most-rented products and the live status split.\n\n" +
        "**One call, one instant.** Every figure is computed against the same `generatedAt`, so the " +
        "screen can never show a revenue total from one moment beside a counter from another — and " +
        "on a scale-to-zero backend six separate aggregates would cost six round trips on top of a " +
        "cold start.\n\n" +
        "**`upNext` is three ORDERS, not three events.** Each order is represented by the single " +
        "event it still has to perform: an order delivering at 14:00 and collecting at 14:30 " +
        "occupies ONE slot showing the delivery, and the moment that delivery is confirmed the same " +
        "order re-enters the queue carrying its collection and re-sorts against everyone else. Each " +
        "item extends the ORDER LIST shape, so `actions` comes from the lifecycle engine already " +
        "narrowed to this actor — the quick action here and the one on the agenda can never " +
        "disagree. `event.isOverdue` and `event.minutesUntil` are computed server-side so a skewed " +
        "device clock cannot contradict the server about what is late. Authenticated limiter (100/min).",
      security: [{ ApiKeyAuth: [], BearerAuth: [] }],
      responses: {
        "200": dataResponse(
          "The dashboard snapshot.",
          "DashboardResponse",
          {
            dashboard: {
              generatedAt: "2026-08-01T13:30:00.000Z",
              upNext: [
                {
                  id: 12,
                  clientName: EXAMPLE_CLIENT_NAME,
                  isRegistryClient: true,
                  eventType: { id: 1, name: EXAMPLE_EVENT_TYPE },
                  status: { id: 1, name: "Pendiente", colorKey: "amber" },
                  nextStatus: { id: 5, name: "En ruta" },
                  actions: [
                    {
                      kind: "forward",
                      statusId: 5,
                      statusName: "En ruta",
                      colorKey: "indigo",
                      requiresEvidence: false,
                      minEvidence: 1,
                      maxEvidence: 10,
                      requiresReason: false,
                      inventoryEffect: "none",
                      purgesEvidence: false,
                      tracksEvent: null,
                    },
                  ],
                  holdsInventory: true,
                  paymentStatus: { id: 1, name: "Pendiente" },
                  deliveryAt: "2026-08-01T14:00:00.000Z",
                  pickupAt: "2026-08-02T10:00:00.000Z",
                  assignee: { id: 2, name: "Romeo Marroquín" },
                  isMine: true,
                  itemCount: 25,
                  totalAmount: 450,
                  currency: { id: 1, iso4217Code: "GTQ", name: EXAMPLE_CURRENCY_NAME, symbol: "Q" },
                  event: {
                    kind: "DELIVERY",
                    at: "2026-08-01T14:00:00.000Z",
                    isOverdue: false,
                    minutesUntil: 30,
                  },
                  deliveryAddress: EXAMPLE_ORDER_ADDRESS,
                  deliveryCoords: { lat: 14.634915, lng: -90.506883 },
                  deliveryInstructions: "Portón negro, preguntar por el guardia",
                  deliveryContact: "5555-1234",
                },
              ],
              today: { deliveries: 4, collections: 2, overdue: 1, active: 9 },
              month: {
                period: { from: "2026-08-01T06:00:00.000Z", to: "2026-09-01T06:00:00.000Z" },
                revenue: { current: 12400, previous: 9800, deltaPercent: 26.5 },
                orders: { current: 28, previous: 24, deltaPercent: 16.7 },
                // No `deltaPercent` when the previous period was zero — see the schema note.
                averageOrder: { current: 442.86, previous: 408.33, deltaPercent: 8.5 },
                cancelled: { current: 3, previous: 5, deltaPercent: -40 },
              },
              outstanding: { amount: 3150, orders: 7 },
              revenueTrend: [
                { month: "2025-09", revenue: 0, orders: 0 },
                { month: "2026-08", revenue: 12400, orders: 28 },
              ],
              topProducts: [
                { productId: 3, name: "Silla Tiffany", quantity: 240, revenue: 4800 },
              ],
              statusSplit: [
                { statusId: 1, name: "Pendiente", colorKey: "amber", count: 6 },
                { statusId: 3, name: "Entregado", colorKey: "emerald", count: 3 },
              ],
              currency: { id: 1, iso4217Code: "GTQ", name: EXAMPLE_CURRENCY_NAME, symbol: "Q" },
            },
          },
          "Dashboard fetched",
        ),
        "401": unauthorized(STALE_TOKEN_401),
        "403": adminOnly(),
        "429": rateLimited,
        "500": serverError,
      },
    },
  },

  "/preferences": {
    get: {
      tags: ["Preferences"],
      summary: "Read every system preference (admin)",
      operationId: "getPreferences",
      description:
        "**STRICTLY Admin.** Everything the preferences screen manages, in one call: the editable " +
        "scalar settings (each with the BOUNDS the client mirrors while typing) plus every " +
        "admin-manageable seeded catalog, and the municipalities the zone form picks from.\n\n" +
        "Two deliberate choices. **Unpublished rows are INCLUDED** — this is the screen where " +
        "`isActive` is edited, so filtering them here would make them unrecoverable. And only the " +
        "settings the system actually HONOURS are returned: the seed carries twelve keys, but a " +
        "control that saves a value nothing reads teaches the admin to distrust the whole screen, so " +
        "the rest appear when the feature that honours them lands. Authenticated limiter (100/min).",
      security: [{ ApiKeyAuth: [], BearerAuth: [] }],
      responses: {
        "200": dataResponse("The settings, the catalogs and the zone form's municipalities.", "PreferencesResponse", {
          settings: [
            { key: "orders.logisticsSpacingMinutes", type: "int", value: 60, min: 1, max: 1440, group: "orders" },
            { key: "orders.turnaroundMinutes", type: "int", value: 120, min: 0, max: 1440, group: "orders" },
            { key: "orders.evidenceMinPhotos", type: "int", value: 1, min: 1, max: 20, group: "evidence" },
            { key: "orders.evidenceMaxPhotos", type: "int", value: 10, min: 1, max: 20, group: "evidence" },
            { key: "orders.evidenceRetentionMonths", type: "int", value: 24, min: 1, max: 120, group: "evidence" },
          ],
          catalogs: {
            // `isReferenced` = something points at the row, so a delete would UNPUBLISH it rather
            // than destroy it. Here: the event type is in use by an order, the rest are free.
            eventTypes: [
              { id: 1, name: EXAMPLE_EVENT_TYPE, isActive: true, minLeadHours: 24, isReferenced: true },
            ],
            contactTypes: [{ id: 1, name: "WhatsApp", isActive: true, isReferenced: false }],
            zones: [
              { id: 6, name: "Zona 10", isActive: true, deliveryFee: 50, municipalityId: 4, isReferenced: false },
            ],
            paymentMethods: [{ id: 1, name: "Efectivo", isActive: true, isReferenced: false }],
            productCategories: [{ id: 1, name: "Mesas", isActive: true, isReferenced: false }],
            productDetailTypes: [{ id: 1, name: "Color", isActive: true, isReferenced: false }],
          },
          municipalities: [{ id: 4, name: "Mixco", isActive: true }],
        }, "Preferences fetched"),
        "401": unauthorized(STALE_TOKEN_401),
        "403": adminOnly(),
        "429": rateLimited,
        "500": serverError,
      },
    },
  },

  "/preferences/settings": {
    put: {
      tags: ["Preferences"],
      summary: "Update the scalar settings (admin)",
      operationId: "updatePreferenceSettings",
      description:
        "**STRICTLY Admin.** Declarative, like every other update here: the body carries the full " +
        "editable set. Each value must be an integer inside the bounds `GET /preferences` published, " +
        "so a rejection means a stale or tampered client rather than a user typo.\n\n" +
        "Two rules beyond per-field bounds: a key that is unknown or not honoured is **rejected, " +
        "never ignored** (silently dropping it would leave the admin believing they saved " +
        "something), and the evidence pair must stay coherent — `max < min` is refused because a " +
        "status inheriting that range could never be satisfied by any photo count.\n\n" +
        "The response carries the RELOADED settings, not an echo: a clamped or newly-created value " +
        "would otherwise diverge from what the system will read. Authenticated limiter (100/min).",
      security: [{ ApiKeyAuth: [], BearerAuth: [] }],
      requestBody: bodyRef("UpdatePreferenceSettingsRequest", {
        settings: [
          { key: "orders.logisticsSpacingMinutes", value: 90 },
          { key: "orders.turnaroundMinutes", value: 180 },
        ],
      }),
      responses: {
        "200": dataResponse("The settings as they now stand.", "PreferenceSettingsResponse", {
          settings: [
            { key: "orders.logisticsSpacingMinutes", type: "int", value: 90, min: 1, max: 1440, group: "orders" },
          ],
        }, "Preferences updated"),
        "400": errorResponse(
          "An unknown/non-editable key, a duplicate, a value outside its bounds, or an inverted " +
            "evidence range.",
          400,
          "The maximum number of photos cannot be lower than the minimum.",
        ),
        "401": unauthorized(STALE_TOKEN_401),
        "403": adminOnly(),
        "429": rateLimited,
        "500": serverError,
      },
    },
  },

  "/preferences/catalogs/{catalog}": {
    post: {
      tags: ["Preferences"],
      summary: "Add a row to a manageable catalog (admin)",
      operationId: "createCatalogRow",
      description:
        "**STRICTLY Admin.** One endpoint for all seven manageable catalogs — `event-types`, " +
        "`contact-types`, `zones`, `payment-methods`, `product-categories`, " +
        "`product-detail-types`, `bank-accounts` — driven by a registry that declares each one's " +
        "extra fields, so an event type can never be sent a `deliveryFee`, a zone can't be saved " +
        "without its municipality, and a bank account can't be saved without its holder.\n\n" +
        "**Anything not in that list answers `404`**, including the lookups deliberately kept " +
        "unmanageable (`user-roles`, `currencies`, `product-business-types`, `rent-time-units`, " +
        "`payment-status`, the geo tables): runtime code branches on their ids, so an admin adding " +
        "or removing their rows would break pricing or strand records. They must read as \"no such " +
        "thing here\", never as a merely malformed request. Authenticated limiter (100/min).",
      security: [{ ApiKeyAuth: [], BearerAuth: [] }],
      parameters: [catalogParam],
      requestBody: bodyRef("CatalogRowRequest", {
        name: "Boda",
        description: "Evento social con salón",
        isActive: true,
        minLeadHours: 48,
      }),
      responses: {
        "201": dataResponse("The created row.", "CatalogRowResponse", {
          // Always `isReferenced: false`: a row that did not exist a moment ago cannot be in use.
          row: {
            id: 9,
            name: "Boda",
            description: "Evento social con salón",
            isActive: true,
            minLeadHours: 48,
            isReferenced: false,
          },
        }, "Row created"),
        "400": errorResponse(
          "The name/description/publication flag or one of the catalog's declared extra fields is " +
            "invalid.",
          400,
          "The name is required and must be valid.",
        ),
        "401": unauthorized(STALE_TOKEN_401),
        "403": adminOnly(),
        "404": errorResponse("That catalog is not admin-manageable.", 404, "Catalog not found"),
        "429": rateLimited,
        "500": serverError,
      },
    },
  },

  "/preferences/catalogs/{catalog}/{id}": {
    put: {
      tags: ["Preferences"],
      summary: "Update a catalog row (admin)",
      operationId: "updateCatalogRow",
      description:
        "**STRICTLY Admin.** Full-state row update, same registry-driven contract as the create.\n\n" +
        "One invariant: a catalog the FORMS depend on may not be left with zero active rows " +
        "(event types, contact types, product categories). Unpublishing the last one wouldn't just " +
        "look odd — it drops the order or product form into its `config` dead-end, a far worse and " +
        "much harder-to-diagnose outcome than a refused edit. Zones, payment methods and detail " +
        "types are genuinely optional, so emptying those is allowed. Authenticated limiter (100/min).",
      security: [{ ApiKeyAuth: [], BearerAuth: [] }],
      parameters: [catalogParam, catalogIdParam],
      requestBody: bodyRef("CatalogRowRequest", {
        name: "Boda",
        isActive: true,
        minLeadHours: 72,
      }),
      responses: {
        "200": dataResponse("The updated row.", "CatalogRowResponse", {
          row: { id: 1, name: "Boda", isActive: true, minLeadHours: 72, isReferenced: true },
        }, "Row updated"),
        "400": errorResponse("The body failed the catalog's field contract.", 400, "The name is required and must be valid."),
        "401": unauthorized(STALE_TOKEN_401),
        "403": adminOnly(),
        "404": errorResponse(
          "The catalog is not manageable, or that row does not exist.",
          404,
          "Row not found",
        ),
        "409": errorResponse(
          "It would leave a catalog the forms need with no active rows.",
          409,
          "At least one active item must remain in this catalog.",
        ),
        "429": rateLimited,
        "500": serverError,
      },
    },
    delete: {
      tags: ["Preferences"],
      summary: "Delete or unpublish a catalog row (admin)",
      operationId: "deleteCatalogRow",
      description:
        "**STRICTLY Admin.** The conditional NO-TRASH rule applied to reference data: the row " +
        "**hard-deletes** when nothing points at it, and **deactivates** when something does — an " +
        "order holds a live FK to its event type, so destroying a used row would leave its detail " +
        "page unable to name it. Every table that can reference the row is checked (a zone from user " +
        "AND registry addresses; a payment method from orders AND a client's preferred method).\n\n" +
        "`data.outcome` says WHICH happened (`deleted` | `deactivated`) so the client's copy can be " +
        "truthful instead of vague. The same last-active-row invariant as the update applies to both " +
        "doors. No request body: the outcome is decided by what references the row, never by what " +
        "was sent. Authenticated limiter (100/min).",
      security: [{ ApiKeyAuth: [], BearerAuth: [] }],
      parameters: [catalogParam, catalogIdParam],
      responses: {
        "200": dataResponse(
          "Whether the row was removed or merely unpublished.",
          "DeleteCatalogRowResponse",
          { outcome: "deactivated" },
          "The item is in use, so it was unpublished instead of deleted",
        ),
        "401": unauthorized(STALE_TOKEN_401),
        "403": adminOnly(),
        "404": errorResponse(
          "The catalog is not manageable, or that row does not exist.",
          404,
          "Row not found",
        ),
        "409": errorResponse(
          "It would leave a catalog the forms need with no active rows.",
          409,
          "At least one active item must remain in this catalog.",
        ),
        "429": rateLimited,
        "500": serverError,
      },
    },
  },
};
