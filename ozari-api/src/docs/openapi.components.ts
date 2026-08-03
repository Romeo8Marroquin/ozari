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
  enum: ["Client", "Admin", "Driver"],
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
  ForgotPasswordRequest: {
    type: "object",
    required: ["email"],
    properties: { email: emailField },
  },
  ResetPasswordRequest: {
    type: "object",
    required: ["token", "newPassword", "confirmPassword"],
    properties: {
      token: {
        type: "string",
        minLength: 1,
        description: "The opaque reset token delivered in the emailed link (`?token=`).",
        example: "M2Q0YmYxYzhhOTdlNGQ2ZmIyN2E1ZTgxYzBkM2Y0YjY",
      },
      newPassword: passwordField,
      confirmPassword: {
        type: "string",
        description: "Must exactly match `newPassword`.",
        example: "N3w!Passw0rd",
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

  ProductImage: {
    type: "object",
    description:
      "A product photo (R2). Arrays come in display order (`sortOrder`); the primary is FLAGGED, " +
      "not necessarily first — clients open on the flagged photo.",
    properties: {
      id: { type: "integer", example: 1 },
      url: { type: "string", format: "uri", example: "https://cdn.example.com/products/7/hero.webp" },
      isPrimary: { type: "boolean", example: true },
      sortOrder: { type: "integer", example: 0 },
    },
  },
  ProductDetailItem: {
    type: "object",
    description: "A product spec (color, material, dimensions, …).",
    properties: {
      id: { type: "integer", example: 12 },
      detail: { type: "string", example: "Blanco" },
      detailType: { type: "string", example: "Color" },
      detailTypeId: {
        type: "integer",
        description: "The type's lookup id — what the edit form prefills its select with.",
        example: 1,
      },
    },
  },
  ProductListItem: {
    type: "object",
    description:
      "A catalog product. The base fields are visible to every allowed role; the remaining fields " +
      "are **role-projected** (minimum privilege): `inStock`, `available`, `total`, " +
      "`replacementPrice` and `isActive` are **Admin only** (a Client never receives any stock " +
      "information; a Driver cannot read products at all). `available` is DERIVED for Alquiler: " +
      "the fleet minus units out on active rentals (delivered, or pending inside their event window).",
    properties: {
      id: { type: "integer", example: 7 },
      name: { type: "string", example: "Mesa redonda" },
      description: { type: "string", nullable: true, example: "Mesa para 8 personas" },
      businessType: { type: "string", example: "Alquiler" },
      businessTypeId: {
        type: "integer",
        description: "The business type's lookup id (1 = Alquiler, 2 = Venta) — public reference data.",
        example: 1,
      },
      category: { type: "string", example: "Mesas" },
      categoryId: { type: "integer", description: "The category's lookup id.", example: 1 },
      currency: {
        type: "object",
        properties: {
          id: { type: "integer", example: 1 },
          iso4217Code: { type: "string", example: "GTQ" },
          name: { type: "string", example: "Quetzal Guatemalteco" },
          symbol: { type: "string", example: "Q" },
        },
      },
      rentPrice: { type: "number", nullable: true, description: "Alquiler price per `rentTimeUnit`.", example: 75 },
      sellPrice: { type: "number", nullable: true, description: "Venta price.", example: null },
      rentTimeUnit: { type: "string", nullable: true, description: "Period the rent price is quoted against (Alquiler only).", example: "Día" },
      rentTimeUnitId: { type: "integer", nullable: true, description: "Its lookup id (Alquiler only).", example: 2 },
      images: { type: "array", items: schemaRef("ProductImage") },
      details: { type: "array", items: schemaRef("ProductDetailItem") },
      inStock: { type: "boolean", description: "Availability signal (`available > 0`) — **Admin only**.", example: true },
      available: {
        type: "integer",
        description:
          "Units takeable right now — **Admin only**. Venta: the recorded stock. " +
          "Alquiler: fleet minus units out on active rentals.",
        example: 35,
      },
      total: {
        type: "integer",
        description:
          "The whole rental fleet in circulation (`available` + currently rented) — **Admin only, " +
          "Alquiler only** (absent for Venta, where it would duplicate `available`).",
        example: 40,
      },
      replacementPrice: { type: "number", description: "As-new replacement value — **Admin only**.", example: 900 },
      isActive: { type: "boolean", description: "Soft-delete flag — **Admin only**.", example: true },
    },
  },
  Pagination: {
    type: "object",
    properties: {
      page: { type: "integer", example: 1 },
      pageSize: { type: "integer", example: 20 },
      total: { type: "integer", example: 1 },
      totalPages: { type: "integer", example: 1 },
    },
  },
  ProductListResponse: {
    type: "object",
    properties: {
      products: { type: "array", items: schemaRef("ProductListItem") },
      pagination: schemaRef("Pagination"),
    },
  },
  ProductDetailResponse: {
    type: "object",
    properties: {
      product: schemaRef("ProductListItem"),
    },
  },
  CatalogOption: {
    type: "object",
    description: "A seeded lookup row — just enough to render a select option.",
    properties: {
      id: { type: "integer", example: 1 },
      name: { type: "string", example: "Alquiler" },
    },
  },
  ZoneOption: {
    type: "object",
    description:
      "A zone lookup carrying its default delivery fee (zones drive fee pricing). `deliveryFee` is " +
      "absent when the zone has no configured fee (distinct from 0 = free).",
    properties: {
      id: { type: "integer", example: 6 },
      name: { type: "string", example: "Zona 10" },
      deliveryFee: { type: "number", example: 50 },
    },
  },
  ProductCatalog: {
    type: "object",
    description:
      "The reference lists the product create/edit form renders as selects: every ACTIVE row of the " +
      "five seeded lookups.",
    properties: {
      businessTypes: { type: "array", items: schemaRef("CatalogOption") },
      categories: { type: "array", items: schemaRef("CatalogOption") },
      currencies: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "integer", example: 1 },
            name: { type: "string", example: "Quetzal Guatemalteco" },
            iso4217Code: { type: "string", example: "GTQ" },
            symbol: { type: "string", example: "Q" },
          },
        },
      },
      detailTypes: { type: "array", items: schemaRef("CatalogOption") },
      rentTimeUnits: { type: "array", items: schemaRef("CatalogOption") },
    },
  },
  OrderLookup: {
    type: "object",
    description: "A lookup pair as projected on an order (id + display name).",
    properties: {
      id: { type: "integer", example: 1 },
      name: { type: "string", example: "Pendiente" },
    },
  },
  AdvanceOrderRequest: {
    type: "object",
    required: ["toStatusId"],
    description:
      "A lifecycle move, named by its TARGET only — the engine derives whether that's a forward " +
      "step, a rewind, a cancel, or (for a cancelled order) a reopen, and whether the caller may " +
      "make it. An **Admin may name a target several steps away**: the engine resolves the path and " +
      "applies every step in between as its own validated transition, so the audit trail records " +
      "the walk. A Driver is confined to one forward step or an off-ramp on their own orders.",
    properties: {
      toStatusId: {
        type: "integer",
        description:
          "The `service_status` to move into — one of the order's offered `actions`, or (Admin) any " +
          "step on the order's applicable pipeline.",
        example: 3,
      },
      evidence: {
        type: "array",
        description:
          "Photos per TARGET STEP. A multi-step jump documents every demanding step it crosses in " +
          "ONE pass, so the whole walk is validated before anything is written. Keys must have been " +
          "minted by `POST /orders/evidence/upload-url` and sit under the orders' evidence prefix — " +
          "anything else is rejected, so a key can never attach an object from another namespace. " +
          "Duplicates within a step are dropped.",
        items: {
          type: "object",
          required: ["statusId", "keys"],
          properties: {
            statusId: { type: "integer", example: 3 },
            keys: {
              type: "array",
              items: { type: "string", example: "orders/evidence/a1b2c3d4-….jpg" },
            },
          },
        },
      },
      reason: {
        type: "string",
        maxLength: 500,
        description: "Why the order is being cancelled — recorded on a disruptive move.",
        example: "El cliente canceló la fiesta",
      },
    },
  },
  OrderEvidenceUploadsRequest: {
    type: "object",
    required: ["files"],
    properties: {
      files: {
        type: "array",
        minItems: 1,
        maxItems: 20,
        items: {
          type: "object",
          required: ["contentType", "contentLength"],
          properties: {
            contentType: { type: "string", example: "image/webp" },
            contentLength: { type: "integer", example: 204800 },
          },
        },
      },
    },
  },
  OrderEvidenceUploadsResponse: {
    type: "object",
    properties: {
      uploads: {
        type: "array",
        items: {
          type: "object",
          properties: {
            uploadUrl: {
              type: "string",
              description: "Short-lived presigned PUT the browser uploads to (directly to R2).",
            },
            key: {
              type: "string",
              description: "The object key — send THIS back with the advance; the server derives the URL.",
            },
            publicUrl: { type: "string" },
          },
        },
      },
    },
  },
  OrderStatusRef: {
    type: "object",
    description:
      "The order's current lifecycle status, carrying the chip tone token the admin configured " +
      "(`colorKey`) so no client keeps an id→colour map of its own.",
    properties: {
      id: { type: "integer", example: 1 },
      name: { type: "string", example: "Pendiente" },
      colorKey: {
        type: "string",
        nullable: true,
        description:
          "Palette TOKEN (amber|indigo|emerald|sky|violet|rose|red|slate), never a CSS class; an " +
          "unknown or absent key renders neutral.",
        example: "amber",
      },
    },
  },
  OrderAction: {
    type: "object",
    description:
      "One move the requesting actor may make on the order, with everything the UI must collect " +
      "first. Produced by the lifecycle engine (`resolveTransitions`), so the offered set already " +
      "respects the role and the order's assignment.",
    properties: {
      kind: {
        type: "string",
        enum: ["forward", "backward", "disruptive"],
        description:
          "`forward`/`backward` walk the pipeline; `disruptive` is the any-time exit (cancel).",
        example: "forward",
      },
      statusId: { type: "integer", example: 5 },
      statusName: { type: "string", example: "En ruta" },
      colorKey: { type: "string", nullable: true, example: "indigo" },
      requiresEvidence: {
        type: "boolean",
        description:
          "The target step demands photo evidence (only ever true on a `forward` move — undoing " +
          "or cancelling is never blocked by a camera).",
        example: false,
      },
      minEvidence: {
        type: "integer",
        description:
          "Resolved photo bounds: the status' own counts when set, else the global " +
          "`orders.evidenceMinPhotos`/`orders.evidenceMaxPhotos` preferences.",
        example: 1,
      },
      maxEvidence: { type: "integer", example: 10 },
      requiresReason: {
        type: "boolean",
        description: "Disruptive moves record a reason (`cancelReason`).",
        example: false,
      },
      inventoryEffect: {
        type: "string",
        enum: ["release", "reclaim", "none"],
        description:
          "What accepting this move does to the goods the order reserves. `release` — units go " +
          "back to the fleet/shelf; `reclaim` — the order takes units again, so the move CAN FAIL " +
          "on availability (409); `none` — the reservation is unchanged (e.g. cancelling an order " +
          "that already finished, which holds nothing to give back). Derived from the statuses' " +
          "`inventoryHold` plus the sale-stock rule, so it stays correct as steps are added or " +
          "re-flagged — clients must state THIS instead of assuming a cancel frees anything.",
        example: "none",
      },
      purgesEvidence: {
        type: "boolean",
        description:
          "True when accepting this move destroys the photos of the step it undoes (a `backward` " +
          "leg out of a step that demanded evidence). The deletion is permanent, including the " +
          "stored objects.",
        example: false,
      },
      tracksEvent: {
        type: "string",
        nullable: true,
        enum: ["DELIVERY", "COLLECTION", null],
        description:
          "Which physical trip this move CONFIRMS, read from the target status's `tracksEvent` — " +
          "so a client can offer navigation on exactly the steps where somebody drives somewhere, " +
          "without knowing any status ids. `null` on every non-travel step and on every `backward`/" +
          "`disruptive` move (undoing a tap is desk work, not a journey).",
        example: "DELIVERY",
      },
    },
  },
  Coords: {
    type: "object",
    required: ["lat", "lng"],
    description:
      "A map pin. **Always optional**: the delivery ADDRESS TEXT is what the business runs on, and " +
      "the pin only removes the last-hundred-metres ambiguity — every consumer must keep working " +
      "when it is absent. Stored AES-encrypted like the address it belongs to, and rounded to 6 " +
      "decimals (~11 cm) so a dragged pin's float noise never churns the snapshot.",
    properties: {
      lat: { type: "number", format: "double", minimum: -90, maximum: 90, example: 14.634915 },
      lng: { type: "number", format: "double", minimum: -180, maximum: 180, example: -90.506883 },
    },
  },
  OrderStatusCatalogOption: {
    type: "object",
    description:
      "A lifecycle status as the catalog publishes it: the lookup PLUS its declared behavior, so " +
      "clients can render tones, order the filter chips like the real pipeline, and know what a " +
      "step will demand. Evidence counts arrive RESOLVED (per-status override already merged with " +
      "the global preference). Pipeline steps carry `sortOrder`; disruptive off-ramps omit it.",
    properties: {
      id: { type: "integer", example: 3 },
      name: { type: "string", example: "Entregado" },
      sortOrder: { type: "integer", nullable: true, example: 3 },
      isInitial: { type: "boolean", example: false },
      isDisruptive: {
        type: "boolean",
        description: "An any-time exit (Cancelado) rather than a position in the pipeline.",
        example: false,
      },
      inventoryHold: {
        type: "string",
        enum: ["NONE", "WINDOW", "OUT"],
        description:
          "How a rental line in this status affects the fleet: `NONE` (available), `WINDOW` (held " +
          "only during the order's billed period) or `OUT` (held unconditionally — on the truck, " +
          "at the event, or back but not yet washed).",
        example: "OUT",
      },
      requiresEvidence: { type: "boolean", example: true },
      minEvidence: { type: "integer", example: 1 },
      maxEvidence: { type: "integer", example: 10 },
      appliesTo: {
        type: "string",
        enum: ["ALL", "RENTAL", "SALE"],
        description:
          "Which order modes walk this step — how a purchase-only order finishes at Entregado " +
          "without any hardcoded sale-vs-rental branch.",
        example: "ALL",
      },
      tracksEvent: {
        type: "string",
        enum: ["DELIVERY", "COLLECTION"],
        nullable: true,
        description: "The actual this step stamps (`deliveredAt` / `collectedAt`); absent = none.",
        example: "DELIVERY",
      },
      colorKey: { type: "string", nullable: true, example: "emerald" },
    },
  },
  OrderListItem: {
    type: "object",
    description:
      "An order as the agenda/history list renders it — deliberately lean: who, what kind of " +
      "event, where it stands, when, how big, how much. The PII-heavier snapshots (contact, " +
      "address) and the money breakdown live on the detail response only. `pickupAt` is absent " +
      "on purchase-only orders; the tracking timestamps appear as their steps are confirmed.",
    properties: {
      id: { type: "integer", example: 12 },
      clientName: {
        type: "string",
        description: "Decrypted snapshot of the responsible person captured at order time.",
        example: "María López",
      },
      isRegistryClient: {
        type: "boolean",
        description:
          "True when the order belongs to a walk-in client registry rather than a platform user.",
        example: false,
      },
      eventType: schemaRef("OrderLookup"),
      status: schemaRef("OrderStatusRef"),
      nextStatus: {
        allOf: [schemaRef("OrderLookup")],
        nullable: true,
        description:
          "The MODE-AWARE next pipeline step (a purchase-only order never walks the rental-only " +
          "steps), or absent when the order is finished or cancelled. Informational — whether the " +
          "caller may take it is `actions`.",
      },
      actions: {
        type: "array",
        description:
          "Every move the REQUESTING actor may make right now, already narrowed by the lifecycle " +
          "permission matrix (an Admin advances/rewinds/cancels; an assigned Driver advances and " +
          "cancels; nobody else gets anything). Clients render their buttons straight from this.",
        items: schemaRef("OrderAction"),
      },
      holdsInventory: {
        type: "boolean",
        description:
          "Does the order RESERVE anything right now — rental units held by its current status " +
          "(`inventoryHold`), or sale units not yet cancelled/delivered? Derived, never stored. " +
          "Lets a client state a consequence rather than hedge: deleting an order that holds goods " +
          "returns them; deleting a finished or cancelled one changes no inventory at all.",
        example: true,
      },
      paymentStatus: schemaRef("OrderLookup"),
      deliveryAt: { type: "string", format: "date-time" },
      pickupAt: { type: "string", format: "date-time", nullable: true },
      deliveredAt: { type: "string", format: "date-time", nullable: true },
      collectedAt: { type: "string", format: "date-time", nullable: true },
      readyAt: {
        type: "string",
        format: "date-time",
        nullable: true,
        description: "The explicit final \"listo\" press that returned the units to the fleet.",
      },
      cancelledAt: { type: "string", format: "date-time", nullable: true },
      assignee: {
        type: "object",
        nullable: true,
        description: "The assigned driver (the admin is also a driver); absent while unassigned.",
        properties: {
          id: { type: "integer", example: 2 },
          name: { type: "string", example: "Romeo Marroquín" },
        },
      },
      isMine: {
        type: "boolean",
        description:
          "True when the order is assigned to the requesting user — the agenda groups MINE vs the " +
          "rest and shows the per-order quick action only on `isMine` rows.",
        example: true,
      },
      itemCount: {
        type: "integer",
        description: "Total units across the order's active lines.",
        example: 25,
      },
      totalAmount: { type: "number", example: 450 },
      currency: {
        type: "object",
        properties: {
          id: { type: "integer", example: 1 },
          name: { type: "string", example: "Quetzal Guatemalteco" },
          iso4217Code: { type: "string", example: "GTQ" },
          symbol: { type: "string", example: "Q" },
        },
      },
    },
  },
  OrderListResponse: {
    type: "object",
    properties: {
      orders: { type: "array", items: schemaRef("OrderListItem") },
      pagination: schemaRef("Pagination"),
    },
  },
  OrderLine: {
    type: "object",
    description:
      "One order line. `isRental` is the line's rent-vs-sale SNAPSHOT (how it was ordered, " +
      "immune to later product edits): rental lines bill per billed day and get picked up; sale " +
      "lines bill once and permanently decrement stock.",
    properties: {
      id: { type: "integer", example: 31 },
      productId: { type: "integer", example: 3 },
      productName: { type: "string", example: "Silla plegable" },
      isRental: { type: "boolean", example: true },
      quantity: { type: "integer", example: 25 },
      unitaryPrice: { type: "number", example: 6 },
      parcialPrice: { type: "number", example: 150 },
    },
  },
  OrderExtra: {
    type: "object",
    description: "An ad-hoc extra charged on the order — every money field may be absent.",
    properties: {
      id: { type: "integer", example: 1 },
      name: { type: "string", example: "Instalación" },
      description: { type: "string", nullable: true },
      quantity: { type: "integer", nullable: true },
      unitaryPrice: { type: "number", nullable: true },
      parcialPrice: { type: "number", nullable: true },
    },
  },
  OrderStatusChange: {
    type: "object",
    description:
      "One transition from the order's append-only status audit trail. `from` is absent on the " +
      "creation row.",
    properties: {
      id: { type: "integer", example: 1 },
      // 3.0 has no nullable-$ref shorthand — the standard allOf wrapper carries the nullability.
      from: { allOf: [schemaRef("OrderLookup")], nullable: true },
      to: schemaRef("OrderLookup"),
      byUserName: { type: "string", example: "Romeo Marroquín" },
      at: { type: "string", format: "date-time" },
    },
  },
  OrderDetail: {
    description:
      "The full order: the list-item fields plus the decrypted contact/address SNAPSHOTS " +
      "(captured at order time — never live registry/user data), the billed period, the money " +
      "breakdown, the lines/extras, and the status audit trail.",
    allOf: [
      schemaRef("OrderListItem"),
      {
        type: "object",
        properties: {
          clientRegistryId: {
            type: "integer",
            nullable: true,
            description:
              "The walk-in client registry this order belongs to — the IDENTITY, as opposed to the " +
              "snapshot texts. Absent on the (future) platform-user variant. The edit form reopens " +
              "on this client; the list projection deliberately omits it.",
            example: 3,
          },
          deliveryContact: { type: "string", example: "WhatsApp 5555-1234" },
          deliveryAddress: { type: "string", example: "Zona 10, 4a avenida 5-55" },
          deliveryCoords: {
            allOf: [schemaRef("Coords")],
            nullable: true,
            description:
              "The delivery's map pin, snapshotted at order time. Absent is normal — a client " +
              "offering navigation falls back to searching `deliveryAddress`.",
          },
          description: { type: "string", nullable: true },
          comment: { type: "string", nullable: true },
          deliveryAmount: {
            type: "number",
            nullable: true,
            description: "Delivery fee actually charged (admin-set, distance-based).",
          },
          depositAmount: { type: "number", nullable: true, description: "Anticipo recorded so far." },
          paymentMethod: {
            allOf: [schemaRef("CatalogOption")],
            nullable: true,
            description: "How the order is paid (Efectivo / Transferencia); absent until chosen.",
          },
          discountAmount: { type: "number", nullable: true },
          discountReason: { type: "string", nullable: true },
          paidAt: { type: "string", format: "date-time", nullable: true },
          cancelReason: { type: "string", nullable: true },
          serviceStart: {
            type: "string",
            format: "date-time",
            description: "Start of the BILLED period (whole days over the delivery→pickup window).",
          },
          serviceEnd: { type: "string", format: "date-time" },
          lines: { type: "array", items: schemaRef("OrderLine") },
          extras: { type: "array", items: schemaRef("OrderExtra") },
          statusHistory: { type: "array", items: schemaRef("OrderStatusChange") },
          createdAt: { type: "string", format: "date-time" },
        },
      },
    ],
  },
  OrderDetailResponse: {
    type: "object",
    properties: {
      order: schemaRef("OrderDetail"),
    },
  },
  OrderCatalog: {
    type: "object",
    description:
      "The reference lists the orders section consumes: event types (with their client " +
      "lead-times), the status vocabularies, the contact types + zones the client-registry form " +
      "needs, and the staff an order can be ASSIGNED to. Active rows, id order.",
    properties: {
      eventTypes: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "integer", example: 1 },
            name: { type: "string", example: "Evento familiar" },
            minLeadHours: {
              type: "integer",
              description:
                "Client-side rule: clients create orders only this many hours ahead, and " +
                "edit/cancel only until this many hours before delivery. Admins are unrestricted.",
              example: 24,
            },
          },
        },
      },
      serviceStatuses: {
        type: "array",
        description:
          "The lifecycle statuses in PIPELINE order with the disruptive off-ramps last, each " +
          "carrying its declared behavior (the machine is configured in data).",
        items: schemaRef("OrderStatusCatalogOption"),
      },
      paymentStatuses: { type: "array", items: schemaRef("CatalogOption") },
      paymentMethods: { type: "array", items: schemaRef("CatalogOption") },
      contactTypes: { type: "array", items: schemaRef("CatalogOption") },
      zones: { type: "array", items: schemaRef("ZoneOption") },
      assignableUsers: {
        type: "array",
        description:
          "Staff an order can be assigned to — the deliverable roles (Admin + Driver today). " +
          "Names are decrypted; the role name rides along. The create form's \"Asignar a\" options.",
        items: {
          type: "object",
          properties: {
            id: { type: "integer", example: 2 },
            name: { type: "string", example: "Romeo Marroquín" },
            role: { type: "string", example: "Administrador" },
          },
        },
      },
    },
  },
  CreateOrderRequest: {
    type: "object",
    required: [
      "clientRegistryId",
      "eventTypeId",
      "deliveryAt",
      "deliveryName",
      "deliveryContact",
      "deliveryAddress",
      "assignedUserId",
      "lines",
    ],
    description:
      "Creates an order on behalf of a WALK-IN client (identity = a client registry — the only " +
      "variant mounted today; a platform-user variant is a planned door). `pickupAt` is REQUIRED " +
      "when any line is a rental and FORBIDDEN on a purchase-only order. The delivery fields are " +
      "SNAPSHOTS (text — prefilled from the registry or typed as a one-off venue). Prices are " +
      "derived SERVER-SIDE from each product (rentals bill per started 24h day over the window; " +
      "'Evento'-unit rentals bill flat) — the body never carries money except the admin-set " +
      "delivery fee and optional deposit.",
    properties: {
      clientRegistryId: { type: "integer", example: 3 },
      eventTypeId: { type: "integer", example: 1 },
      deliveryAt: { type: "string", format: "date-time" },
      pickupAt: { type: "string", format: "date-time", nullable: true },
      deliveryName: { type: "string", minLength: 2, maxLength: 255, example: "María López" },
      deliveryContact: { type: "string", minLength: 2, maxLength: 255, example: "WhatsApp 5555-1234" },
      deliveryAddress: { type: "string", minLength: 5, maxLength: 500, example: "Zona 10, 4a avenida 5-55" },
      deliveryCoords: {
        allOf: [schemaRef("Coords")],
        nullable: true,
        description:
          "OPTIONAL map pin for this delivery, snapshotted alongside the text. Omit it (or send " +
          "null) when there is none — the address text remains authoritative either way. A " +
          "malformed pair is a `400`, never a silently dropped field.",
      },
      description: { type: "string", nullable: true, maxLength: 500 },
      comment: { type: "string", nullable: true, maxLength: 500 },
      deliveryAmount: { type: "number", nullable: true, example: 50 },
      depositAmount: { type: "number", nullable: true, example: 100 },
      paymentMethodId: {
        type: "integer",
        nullable: true,
        description: "How it will be paid (an active seeded method); optional — payment can settle later.",
        example: 1,
      },
      assignedUserId: {
        type: "integer",
        description:
          "Staff member the order is assigned to (an active Admin/Driver — see " +
          "`GET /orders/catalog` `assignableUsers`). **Required**: each logistics event occupies a " +
          "block of its DRIVER's day, so every event needs an owner (the API used to default this " +
          "to the creating admin).",
        example: 2,
      },
      lines: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          required: ["productId", "quantity"],
          properties: {
            productId: { type: "integer", example: 3 },
            quantity: { type: "integer", minimum: 1, example: 25 },
          },
        },
      },
    },
  },
  OrderStockConflictItem: {
    type: "object",
    description:
      "One line the requested window cannot satisfy — carried in the creation 409's `data.conflicts` " +
      "so the form can re-offer with the real numbers.",
    properties: {
      productId: { type: "integer", example: 3 },
      productName: { type: "string", example: "Silla plegable" },
      requested: { type: "integer", example: 25 },
      available: { type: "integer", example: 10 },
    },
  },
  OrderAvailabilityRequest: {
    type: "object",
    required: ["deliveryAt", "productIds"],
    description:
      "The live availability probe: a delivery datetime, an OPTIONAL pickup (after delivery when " +
      "present — omit it when no rental window exists yet), 1–200 product ids, and the OPTIONAL " +
      "driver half (`assignedUserId`, plus `excludeOrderId` when an edit re-checks itself).",
    properties: {
      deliveryAt: { type: "string", format: "date-time" },
      pickupAt: { type: "string", format: "date-time", nullable: true },
      productIds: {
        type: "array",
        minItems: 1,
        maxItems: 200,
        items: { type: "integer", example: 3 },
      },
      assignedUserId: {
        type: "integer",
        nullable: true,
        description:
          "The driver whose day would hold these events. Omit it and the response carries NO " +
          "`driver` block — the form simply has nothing to say until the assignee is chosen.",
        example: 2,
      },
      excludeOrderId: {
        type: "integer",
        nullable: true,
        description:
          "The order being EDITED, excluded from BOTH counts — it is holding its own rental units " +
          "and occupies its own two blocks, so without this it would compete with itself and the " +
          "probe would answer a stricter question than the save. Its tracking actuals are also " +
          "read here: an order that was cancelled, or whose events already happened, occupies " +
          "nothing and probes as free.",
        example: 42,
      },
    },
  },
  DriverConflict: {
    type: "object",
    description:
      "One real overlap on the driver's day: the OTHER order's event (`at`/`kind`) and WHICH of " +
      "the checked order's own events it blocks — so the form can put the error on the right " +
      "date input instead of on both. **Admin tier only.**",
    properties: {
      orderId: { type: "integer", example: 42 },
      at: { type: "string", format: "date-time" },
      kind: { type: "string", enum: ["DELIVERY", "COLLECTION"], example: "DELIVERY" },
      blocks: { type: "string", enum: ["DELIVERY", "COLLECTION"], example: "COLLECTION" },
    },
  },
  DriverAvailability: {
    type: "object",
    description:
      "Whether the assigned driver can actually be there. Every field except `available` is " +
      "**Admin tier**: a future client asking whether their window can be served learns only that " +
      "it cannot — never a name, a count, an order, or that the business has one driver.",
    properties: {
      available: { type: "boolean", example: false },
      gapMinutes: {
        type: "integer",
        description:
          "The configured `orders.logisticsSpacingMinutes`, so copy quotes the real number " +
          "instead of hardcoding \"1 hora\".",
        example: 60,
      },
      selfOverlap: {
        type: "boolean",
        description:
          "The order's OWN delivery and collection are closer than the gap — physically " +
          "impossible for one driver, and never checked before this epic.",
        example: false,
      },
      conflicts: { type: "array", items: schemaRef("DriverConflict") },
      driverName: {
        type: "string",
        description:
          "Who is already busy — sent even though the client picked the assignee, so the probe's " +
          "copy and the save's `409` name the driver from ONE source.",
        example: "Ana Ruiz",
      },
    },
  },
  ProductAvailability: {
    type: "object",
    description:
      "One product's availability for the window. `available` is fleet-minus-held for rentals, " +
      "current stock for sales, and `null` for a rental with no pickup window yet.",
    properties: {
      productId: { type: "integer", example: 3 },
      available: { type: "integer", nullable: true, example: 10 },
    },
  },
  OrderAvailabilityResponse: {
    type: "object",
    properties: {
      availability: { type: "array", items: schemaRef("ProductAvailability") },
      driver: schemaRef("DriverAvailability"),
    },
  },
  ClientRegistryContact: {
    type: "object",
    properties: {
      id: { type: "integer", example: 1 },
      contactType: schemaRef("CatalogOption"),
      value: { type: "string", example: "5555-1234" },
      isPrincipal: { type: "boolean", example: true },
    },
  },
  ClientRegistryAddress: {
    type: "object",
    properties: {
      id: { type: "integer", example: 1 },
      zone: { allOf: [schemaRef("ZoneOption")], nullable: true },
      address: { type: "string", example: "Zona 10, 4a avenida 5-55" },
      instructions: { type: "string", nullable: true },
      coords: { allOf: [schemaRef("Coords")], nullable: true },
      domicilePrice: { type: "number", nullable: true, example: 50 },
      isFavorite: { type: "boolean", example: true },
    },
  },
  ClientRegistry: {
    type: "object",
    description:
      "A WALK-IN client (the admin's WhatsApp/phone people): the responsible person, their contact " +
      "methods, their delivery addresses, and an optional preferred payment method — all decrypted " +
      "for the admin. Not a platform account.",
    properties: {
      id: { type: "integer", example: 3 },
      name: { type: "string", example: "María López" },
      notes: { type: "string", nullable: true },
      contacts: { type: "array", items: schemaRef("ClientRegistryContact") },
      addresses: { type: "array", items: schemaRef("ClientRegistryAddress") },
      preferredPaymentMethod: { allOf: [schemaRef("CatalogOption")], nullable: true },
      createdAt: { type: "string", format: "date-time" },
    },
  },
  ClientRegistryListResponse: {
    type: "object",
    properties: {
      registries: { type: "array", items: schemaRef("ClientRegistry") },
      pagination: schemaRef("Pagination"),
    },
  },
  ClientRegistryResponse: {
    type: "object",
    properties: {
      registry: schemaRef("ClientRegistry"),
    },
  },
  PreferenceSetting: {
    type: "object",
    description:
      "One scalar setting with the BOUNDS the API enforces, so a client can enforce the same ones " +
      "while the admin types (the mirrored-validation doctrine, applied to settings). Deliberately " +
      "carries no label or help text: that is copy, and the frontend owns it.",
    properties: {
      key: { type: "string", example: "orders.turnaroundMinutes" },
      type: {
        type: "string",
        enum: ["int"],
        description: "Always an integer today; the field exists so a future bool/text setting needs no new shape.",
      },
      value: { type: "integer", example: 120 },
      min: { type: "integer", example: 0 },
      max: { type: "integer", example: 1440 },
      group: {
        type: "string",
        description: "Grouping token (`orders`, `evidence`) the screen lays its cards out by.",
        example: "orders",
      },
    },
  },
  CatalogRow: {
    type: "object",
    description:
      "One manageable catalog row, uniform across every catalog so a client renders them all with " +
      "one list. The extras are explicit rather than a generic bag — there are only three in the " +
      "whole system.",
    properties: {
      id: { type: "integer", example: 1 },
      name: { type: "string", example: "Evento familiar" },
      description: { type: "string", nullable: true },
      isActive: {
        type: "boolean",
        description: "Publication flag, NOT deletion. Unpublished rows are returned here (this is where it is edited).",
        example: true,
      },
      minLeadHours: {
        type: "integer",
        description: "Event types only — the client-side lead time before a delivery.",
        example: 24,
      },
      deliveryFee: {
        type: "number",
        description:
          "Zones only — the DEFAULT fee for addresses in the zone. ABSENT means not configured, " +
          "which is a different answer from 0 (free).",
        example: 50,
      },
      municipalityId: { type: "integer", description: "Zones only.", example: 4 },
      isReferenced: {
        type: "boolean",
        description:
          "Is anything pointing at this row? Lets a client's delete confirmation name the outcome " +
          "up front (destroyed vs unpublished) instead of hedging. The server re-decides under the " +
          "transaction that acts, so this is a preview, not the authority. Absent on " +
          "`municipalities`, which are plain reference data nobody deletes here.",
        example: false,
      },
    },
  },
  PreferencesResponse: {
    type: "object",
    properties: {
      settings: { type: "array", items: schemaRef("PreferenceSetting") },
      catalogs: {
        type: "object",
        description: "Every admin-manageable catalog, unpublished rows included.",
        properties: {
          eventTypes: { type: "array", items: schemaRef("CatalogRow") },
          contactTypes: { type: "array", items: schemaRef("CatalogRow") },
          zones: { type: "array", items: schemaRef("CatalogRow") },
          paymentMethods: { type: "array", items: schemaRef("CatalogRow") },
          productCategories: { type: "array", items: schemaRef("CatalogRow") },
          productDetailTypes: { type: "array", items: schemaRef("CatalogRow") },
        },
      },
      municipalities: {
        type: "array",
        description:
          "Reference data the ZONE form picks from — active rows only. NOT admin-managed here: the " +
          "geo tables are shared reference data, not business taxonomy.",
        items: schemaRef("CatalogRow"),
      },
    },
  },
  PreferenceSettingsResponse: {
    type: "object",
    properties: {
      settings: { type: "array", items: schemaRef("PreferenceSetting") },
    },
  },
  UpdatePreferenceSettingsRequest: {
    type: "object",
    required: ["settings"],
    description:
      "The FULL editable set. A partial body would make \"unchanged\" and \"cleared\" " +
      "indistinguishable, and an unknown or not-yet-honoured key is rejected rather than ignored.",
    properties: {
      settings: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          required: ["key", "value"],
          properties: {
            key: { type: "string", example: "orders.turnaroundMinutes" },
            value: { type: "integer", example: 180 },
          },
        },
      },
    },
  },
  CatalogRowRequest: {
    type: "object",
    required: ["name", "isActive"],
    description:
      "A catalog row's full state. Which EXTRA fields are read depends on the catalog (the registry " +
      "declares them), so a stray field for another catalog is simply dropped rather than written " +
      "somewhere it doesn't belong.",
    properties: {
      name: { type: "string", minLength: 2, maxLength: 100, example: "Boda" },
      description: { type: "string", maxLength: 500, nullable: true },
      isActive: { type: "boolean", example: true },
      minLeadHours: {
        type: "integer",
        minimum: 0,
        description: "`event-types` only. Omitted on create ⇒ the column's default (24).",
        example: 48,
      },
      deliveryFee: {
        type: "number",
        nullable: true,
        description: "`zones` only. `null`/omitted = not configured (NOT free).",
        example: 50,
      },
      municipalityId: {
        type: "integer",
        description: "`zones` only, REQUIRED there — must be an active municipality.",
        example: 4,
      },
    },
  },
  CatalogRowResponse: {
    type: "object",
    properties: {
      row: schemaRef("CatalogRow"),
    },
  },
  DeleteCatalogRowResponse: {
    type: "object",
    properties: {
      outcome: {
        type: "string",
        enum: ["deleted", "deactivated"],
        description:
          "`deleted` — nothing referenced the row, it is gone. `deactivated` — something does, so it " +
          "was unpublished instead and existing records keep resolving their names.",
        example: "deactivated",
      },
    },
  },
  CreateClientRegistryRequest: {
    type: "object",
    required: ["name", "contacts"],
    description:
      "Creates a walk-in client registry: a name (looser than the account full-name policy), " +
      "optional notes, 1–10 contacts (at most one flagged principal — the first becomes principal " +
      "when none is), 0–10 addresses (optional seeded zone; same single-favorite rule; a walk-in " +
      "may have none and type one per order) and an optional preferred payment method.",
    properties: {
      name: { type: "string", minLength: 2, maxLength: 255, example: "María López" },
      notes: { type: "string", nullable: true, maxLength: 500 },
      contacts: {
        type: "array",
        minItems: 1,
        maxItems: 10,
        items: {
          type: "object",
          required: ["contactTypeId", "value"],
          properties: {
            contactTypeId: { type: "integer", example: 1 },
            value: { type: "string", minLength: 2, maxLength: 255, example: "5555-1234" },
            isPrincipal: { type: "boolean" },
          },
        },
      },
      addresses: {
        type: "array",
        minItems: 0,
        maxItems: 10,
        items: {
          type: "object",
          required: ["address"],
          properties: {
            zoneId: { type: "integer", nullable: true, example: 6 },
            address: { type: "string", minLength: 5, maxLength: 500 },
            instructions: { type: "string", nullable: true, maxLength: 500 },
            coords: { allOf: [schemaRef("Coords")], nullable: true },
            domicilePrice: { type: "number", nullable: true },
            isFavorite: { type: "boolean" },
          },
        },
      },
      preferredPaymentMethodId: {
        type: "integer",
        nullable: true,
        description: "The client's default payment method (pre-selects the order's method); optional.",
        example: 1,
      },
    },
  },
  CreateProductRequest: {
    type: "object",
    required: ["businessTypeId", "categoryId", "currencyId", "name", "quantity"],
    description:
      "Creates a product (+ nested details + gallery images). The CONDITIONAL price rule applies by " +
      "business type: **Alquiler** requires `rentPrice` + `rentTimeUnitId` and forbids `sellPrice`; " +
      "**Venta** requires `sellPrice` and forbids the rent fields AND `replacementPrice` (the " +
      "as-new value billed for a lost/damaged RENTAL — a sold item is consumed, nothing to " +
      "replace; optional for Alquiler). `images` reference R2 keys previously " +
      "minted by `/products/images/upload-url` (the files must already be uploaded); the public URL " +
      "is derived server-side from each key.",
    properties: {
      name: { type: "string", minLength: 5, maxLength: 255, example: "Mesa redonda" },
      description: { type: "string", nullable: true, minLength: 5, maxLength: 500, example: "Mesa para 8 personas" },
      businessTypeId: { type: "integer", description: "1 = Alquiler, 2 = Venta.", example: 1 },
      categoryId: { type: "integer", example: 1 },
      currencyId: { type: "integer", example: 1 },
      quantity: { type: "integer", minimum: 0, maximum: 5000, example: 40 },
      rentPrice: { type: "number", nullable: true, minimum: 0, description: "Required for Alquiler; forbidden for Venta.", example: 75 },
      rentTimeUnitId: { type: "integer", nullable: true, description: "Required for Alquiler; forbidden for Venta.", example: 2 },
      replacementPrice: { type: "number", nullable: true, minimum: 0, example: 900 },
      sellPrice: { type: "number", nullable: true, minimum: 0, description: "Required for Venta; forbidden for Alquiler.", example: null },
      productDetails: {
        type: "array",
        description:
          "Optional specs created with the product — at most ONE per detail type (a duplicate " +
          "`detailTypeId` is a 400), which also caps the list at the number of active types.",
        items: {
          type: "object",
          required: ["detailTypeId", "detail"],
          properties: {
            detailTypeId: { type: "integer", example: 1 },
            detail: { type: "string", minLength: 5, maxLength: 255, example: "Blanco" },
          },
        },
      },
      images: {
        type: "array",
        maxItems: 8,
        description:
          "Optional gallery (max 8). Array order = `sortOrder`. At most ONE image may set " +
          "`isPrimary: true`; when none does, the FIRST image becomes the primary.",
        items: {
          type: "object",
          required: ["key"],
          properties: {
            key: {
              type: "string",
              description: "R2 object key minted by `/products/images/upload-url`.",
              example: "products/3f9d2c1a-8b4e-4f6a-9c2d-1e5b7a9d3c0f.webp",
            },
            isPrimary: { type: "boolean", example: true },
          },
        },
      },
    },
  },
  UpdateProductRequest: {
    type: "object",
    required: ["businessTypeId", "categoryId", "currencyId", "name", "quantity"],
    description:
      "The product's FULL desired state (declarative, never a partial patch — the RECONCILE " +
      "design): the same scalar rules as create (incl. the conditional price rule), plus the FINAL " +
      "details and gallery lists. `productDetails` rows with an `id` keep/update one of the " +
      "product's existing details, rows without create one, and existing rows absent from the list " +
      "are deleted. `images` slots carry exactly ONE of `id` (a kept photo of this product) or " +
      "`key` (a new upload minted by `/products/images/upload-url`); array order = `sortOrder`, at " +
      "most one `isPrimary` (default: the first); existing photos absent from the list are deleted " +
      "— DB row and R2 object.",
    properties: {
      name: { type: "string", minLength: 5, maxLength: 255, example: "Mesa redonda" },
      description: { type: "string", nullable: true, minLength: 5, maxLength: 500, example: "Mesa para 8 personas" },
      businessTypeId: { type: "integer", description: "1 = Alquiler, 2 = Venta.", example: 1 },
      categoryId: { type: "integer", example: 1 },
      currencyId: { type: "integer", example: 1 },
      quantity: { type: "integer", minimum: 0, maximum: 5000, example: 40 },
      rentPrice: { type: "number", nullable: true, minimum: 0, description: "Required for Alquiler; forbidden for Venta.", example: 75 },
      rentTimeUnitId: { type: "integer", nullable: true, description: "Required for Alquiler; forbidden for Venta.", example: 2 },
      replacementPrice: { type: "number", nullable: true, minimum: 0, example: 900 },
      sellPrice: { type: "number", nullable: true, minimum: 0, description: "Required for Venta; forbidden for Alquiler.", example: null },
      productDetails: {
        type: "array",
        description:
          "The FINAL detail list — at most ONE row per detail type. `id` present = keep/update " +
          "that existing row; absent = create. Existing rows missing from the list are deleted.",
        items: {
          type: "object",
          required: ["detailTypeId", "detail"],
          properties: {
            id: { type: "integer", description: "An existing detail row of THIS product.", example: 12 },
            detailTypeId: { type: "integer", example: 1 },
            detail: { type: "string", minLength: 5, maxLength: 255, example: "Blanco" },
          },
        },
      },
      images: {
        type: "array",
        maxItems: 8,
        description:
          "The FINAL gallery in display order (array order = `sortOrder`). Each slot carries " +
          "exactly ONE of `id`/`key`. At most ONE slot may set `isPrimary: true`; when none does, " +
          "the FIRST becomes the primary.",
        items: {
          type: "object",
          properties: {
            id: { type: "integer", description: "A kept photo of this product.", example: 1 },
            key: {
              type: "string",
              description: "A NEW photo's R2 key, minted by `/products/images/upload-url`.",
              example: "products/3f9d2c1a-8b4e-4f6a-9c2d-1e5b7a9d3c0f.webp",
            },
            isPrimary: { type: "boolean", example: true },
          },
        },
      },
    },
  },
  CreateProductImageUploadsRequest: {
    type: "object",
    required: ["files"],
    description:
      "Requests presigned R2 PUT URLs for product gallery uploads (1–8 per call). Each file's " +
      "content type must be a whitelisted image type and its size within the 5 MB cap — both are " +
      "bound INTO the signature, so a minted URL only works for exactly that file.",
    properties: {
      files: {
        type: "array",
        minItems: 1,
        maxItems: 8,
        items: {
          type: "object",
          required: ["contentType", "contentLength"],
          properties: {
            contentType: {
              type: "string",
              enum: ["image/jpeg", "image/png", "image/webp", "image/avif"],
              example: "image/webp",
            },
            contentLength: {
              type: "integer",
              minimum: 1,
              maximum: 5242880,
              description: "Exact file size in bytes (≤ 5 MB).",
              example: 245760,
            },
          },
        },
      },
    },
  },
  ProductImageUploads: {
    type: "object",
    description:
      "The minted presigned uploads, in the same order as the requested files. PUT each file to its " +
      "`uploadUrl` (with the exact content type + length), then reference `key` in `POST /products`.",
    properties: {
      uploads: {
        type: "array",
        items: {
          type: "object",
          properties: {
            uploadUrl: {
              type: "string",
              format: "uri",
              description: "Short-lived (5 min) presigned PUT URL — upload the file bytes here.",
              example:
                "https://account.r2.cloudflarestorage.com/bucket/products/3f9d2c1a-8b4e-4f6a-9c2d-1e5b7a9d3c0f.webp?X-Amz-Signature=abc123",
            },
            key: {
              type: "string",
              description: "Object key to reference in the product create body.",
              example: "products/3f9d2c1a-8b4e-4f6a-9c2d-1e5b7a9d3c0f.webp",
            },
            publicUrl: {
              type: "string",
              format: "uri",
              description: "Public read URL the image will be served from once uploaded.",
              example: "https://cdn.example.com/products/3f9d2c1a-8b4e-4f6a-9c2d-1e5b7a9d3c0f.webp",
            },
          },
        },
      },
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
