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
          schema: { type: "integer", minimum: 1, maximum: 50, default: 15 },
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
          pagination: { page: 1, pageSize: 15, total: 1, totalPages: 1 },
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
