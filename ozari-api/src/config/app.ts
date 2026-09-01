import { getAppHost, isDeployedEnvironment } from "./environment.js";

export const appConfig = {
  accessToken: {
    algorithm: "HS256" as const,
    audience: "platform-users",
    expiresIn: 900, // 15 minutes in seconds
    issuer: "ozari",
  },

  refreshToken: {
    algorithm: "HS256" as const,
    audience: "platform-users",
    expiresIn: 2592000, // 30 days in seconds
    issuer: "ozari",
  },

  mfaToken: {
    algorithm: "HS256" as const,
    audience: "platform-users",
    expiresIn: 300, // 5 minutes in seconds
    issuer: "ozari",
  },

  // Session-lifecycle knobs that are NOT jwt.sign options (accessToken/refreshToken above are
  // passed raw into jwt.sign, which rejects unknown keys — never fold extras into them).
  session: {
    // Rotation-reuse GRACE: a replay of the device's IMMEDIATELY-PREVIOUS refresh jti within this
    // window is treated as a lost rotation response (a reload/tab-close/network drop killed the
    // response after the server committed the rotation — the client still holds the old cookie),
    // and re-rotates instead of nuking every session. Anything older, or outside the window, still
    // triggers the fail-secure all-sessions delete. 60s covers the real-world race; the residual
    // exposure (a stolen already-rotated token usable once, within a minute of its rotation) is
    // negligible — and an attacker/victim alternation collapses at the victim's next proactive
    // refresh (~14 min), which lands outside the grace and fires the nuke.
    refreshReuseGraceSeconds: 60,
  },

  passwordReset: {
    // Raw token bytes (sent in the email link); only its SHA-256 hash is stored. Single-use, and
    // short-lived so a leaked/forgotten link can't be replayed long after.
    tokenBytes: 32,
    tokenTtlMinutes: 30,
    // Anti-abuse: once a reset email is sent, suppress re-sending to the SAME account for this
    // window (a persistent per-account cooldown, derived from the live token's createdAt) so an
    // attacker who knows an email can't bomb the victim's inbox by hammering the endpoint. This is
    // in addition to the per-IP rate limiter and, unlike it, is global (DB-backed, not per-instance).
    resendCooldownSeconds: 60,
  },

  mfa: {
    // User-facing brand shown in the authenticator app (Google Authenticator, 1Password, …) — the
    // commercial name, NOT the internal project codename. Distinct from the JWT `issuer`/`iss` claim
    // above, which is an opaque internal identifier users never see (and must stay stable).
    issuerLabel: "Party Rentals",
    secretBytes: 20,
    totpDigits: 6,
    totpStepSeconds: 30,
    totpWindow: 1,
    recoveryCodeCount: 10,
  },

  email: {
    // Sender identities — OUR brand, defined HERE (not per-environment env vars: the `from` doesn't
    // vary by environment, staging and prod both send from the verified domain). Each only delivers
    // because partyrentalsgt.com is verified in Resend. Per-purpose local parts let recipients/filters
    // recognize the kind of message; `default` is the fallback for any email that doesn't set its own.
    // The API key is separate — the EMAIL_KEY secret, read by the mailer (never placed here).
    from: {
      default: "Party Rentals <no-reply@partyrentalsgt.com>",
      welcome: "Party Rentals <bienvenida@partyrentalsgt.com>",
      // Security notifications (password changed, 2FA enabled/disabled) — a recognizable sender for
      // account-safety mail.
      security: "Party Rentals <seguridad@partyrentalsgt.com>",
    },
    // Hosted logo for the email header. MUST be a publicly reachable PNG (email clients block data:
    // URIs and don't render SVG — Gmail strips both). It is served from the FRONTEND's `public/`,
    // so it always lives at `<frontend origin>/email-logo.png` — which is why this is **DERIVED
    // from `APP_HOST`** instead of written down. A hardcoded host is a URL that goes stale in
    // silence: it still pointed at the old `pages.dev` origin after the frontend moved to its own
    // domain, so every email quietly rendered a broken image. Empty when `APP_HOST` is unset (local
    // scripts, tests), which falls back to the text wordmark — and many clients block remote images
    // anyway, so the wordmark always carries the brand when the image doesn't load.
    //
    // A getter, not a constant: `getAppHost()` reads `process.env` on each call by design (see
    // `environment.ts`), and caching it at module load would defeat that.
    get logoUrl(): string {
      const host = getAppHost();
      return host ? `${host}/email-logo.png` : "";
    },
  },

  calendar: {
    // ── Google Calendar (the only calendar with a real write API — see EPIC-2-CALENDAR §1) ──────
    google: {
      authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      revokeUrl: "https://oauth2.googleapis.com/revoke",
      apiBase: "https://www.googleapis.com/calendar/v3",
      userInfoUrl: "https://www.googleapis.com/oauth2/v3/userinfo",
      // The NARROWEST scopes that do the job: write events (not `calendar`, which would also let us
      // create, rename and delete whole calendars) plus the address to show in the UI. Asking for
      // less is not a detail here — a broad calendar scope is what makes Google's verification
      // review heavier, and it is what an admin sees on the consent screen.
      scopes: [
        "https://www.googleapis.com/auth/calendar.events",
        "https://www.googleapis.com/auth/userinfo.email",
      ],
      // How early a cached access token is treated as expired. Google's tokens last an hour; a
      // minute of slack means a request never dies in flight on a token that expired mid-call.
      accessTokenSkewSeconds: 60,
      // Google's own bound on a reminder override. Anything larger is rejected by the API, so the
      // clamp has to know it (`reminderMinutesFor`).
      maxReminderMinutes: 40320, // 28 days
    },
    // How much daylight to leave between NOW and the reminder instant when the configured lead does
    // not fit (`reminderMinutesFor`). Landing the trigger exactly on `now` is a race nobody can win:
    // the request still has to reach Google, or the .ics still has to be fetched and parsed by a
    // phone, and neither vendor DOCUMENTS what it does with a trigger that has just gone by — the
    // plausible answers include "fires immediately" and "never fires", and the second is a delivery
    // nobody was told about. Five minutes is small enough to still be a warning and large enough to
    // cover request latency, a cold start and clock skew between us and them.
    reminderSafetyMinutes: 5,
    // The OAuth `state` is a short-lived signed JWT carrying the user id: the consent redirect comes
    // back as a plain top-level navigation with no session of ours attached (the refresh cookie is
    // scoped to /api/auth), so the state is the ONLY thing that says who is connecting. Short TTL
    // because it is a bearer credential in a URL.
    stateTtlSeconds: 600,

    // ── The ICS subscription feed (every other calendar) ────────────────────────────────────────
    // Raw token bytes for the feed URL. It is the ONLY credential on that request, so it is sized
    // like a password-reset token and stored the way an email is: SHA for lookup, encrypted for
    // redisplay (a second device needs the same URL).
    feedTokenBytes: 32,
    // How much of the schedule the feed carries. A subscription is a WINDOW, not an archive: a year
    // ahead covers every real booking, and a month back keeps last week's jobs visible without
    // shipping the whole history to a phone on every refresh.
    feedPastDays: 30,
    feedFutureDays: 365,
    // What a subscribing client is ASKED to poll at. Apple honours it as a hint (the user can
    // override per-subscription); Google ignores it entirely and refreshes on its own slow schedule
    // — which is precisely why Google gets the API integration and not the feed.
    feedRefreshMinutes: 15,
    // The `PRODID` every generated calendar carries — identifies US as the generator, per RFC 5545.
    icsProductId: "-//Party Rentals GT//Ozari//ES",
    // The business's zone, published as a HINT (`X-WR-TIMEZONE`) so a client shows the calendar in
    // the zone the business thinks in. Every instant is still emitted in UTC, which is the only
    // form that needs no VTIMEZONE block and stays unambiguous on a phone that travels. Guatemala
    // has no DST, which is what makes a single fixed zone honest here (EPIC-2 §1).
    timeZone: "America/Guatemala",

    // How long before an event the calendar should remind, when the `calendar.reminderMinutes`
    // preference is missing or corrupt. A day's notice is the point of the feature.
    defaultReminderMinutes: 1440,
  },

  storage: {
    // Cloudflare R2 (S3-compatible) object storage for public assets (product images, …). Only the
    // NON-secret policy lives here; the connection/credentials are read from env by the storage helper
    // (R2_ENDPOINT/R2_BUCKET_NAME/R2_PUBLIC_URL + the R2_ACCESS_KEY/R2_SECRET_KEY secrets) — mirroring
    // how appConfig.email holds `from` while the mailer reads EMAIL_KEY. The bucket is PUBLIC-READ, so
    // never put anything private in it.
    //
    // Uploads never pass through the API: a caller requests a short-lived presigned PUT URL and uploads
    // straight to R2 (keeps image bytes out of Cloud Run and honours the 10 kB body cap).
    uploadUrlTtlSeconds: 300, // 5 min: long enough to upload, short enough that a leaked URL dies fast.
    // Max upload size, bound INTO the presigned signature (ContentLength) so a client can't exceed it.
    maxUploadBytes: 5 * 1024 * 1024, // 5 MB
    // Gallery cap per product — bounds both a single upload-url mint and the `images` a create accepts.
    maxImagesPerProduct: 8,
    // Whitelisted upload content types → their canonical file extension (the object key's suffix).
    allowedImageTypes: {
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/webp": "webp",
      "image/avif": "avif",
    } as Record<string, string>,
    // Key namespace per asset kind (keeps the bucket organized; lets a lifecycle policy target a prefix).
    keyPrefixes: {
      product: "products",
      // Order tracking evidence (the photos a step demands before it can be entered).
      orderEvidence: "orders/evidence",
    },
  },

  cookieConfig: {
    httpOnly: true,
    sameSite: isDeployedEnvironment() ? ("none" as const) : ("lax" as const),
    secure: isDeployedEnvironment(),
    maxAge: 2592000000, // 30 days in milliseconds (matches refresh token expiration)
    path: "/api/auth",
  },

  maxGlobalAmount: 1000000,
  maxGlobalQuantity: 5000,

  // Product list pagination: the grid's default page size and the hard upper bound a caller can
  // request (so a single list call can never fetch an unbounded number of rows). 20 matches the
  // frontend's infinite-scroll batch AND the orders default below (owner: keep them congruent).
  defaultProductPageSize: 20,
  maxProductPageSize: 50,
  // Longest name-search string the list endpoint honours; longer input is truncated, not rejected
  // (the same clamp stance as the pagination params).
  maxProductSearchLength: 100,

  // Order list pagination: the agenda/history views' default page size and hard cap (same clamp
  // stance as products — a single list call can never fetch an unbounded number of rows).
  defaultOrderPageSize: 20,
  maxOrderPageSize: 100,
  // Most distinct products one order can carry (a hard input bound, far above any real party).
  maxOrderLines: 50,
  // Fallback when the `orders.logisticsSpacingMinutes` app preference is missing/corrupt — the
  // seeded default. It is the LOGISTICS PAD's gap: each event occupies ±half of it on its DRIVER's
  // day, so two events of the same driver end up ≥1h apart (EPIC-2-DRIVER-AVAILABILITY §1).
  defaultLogisticsSpacingMinutes: 60,
  // Fallback when the `orders.turnaroundMinutes` app preference is missing/corrupt — the washing
  // period after a collection. Rental units stay unavailable for this long past an order's billed
  // window, so two events can't be promised the same goods back-to-back with no time to clean them.
  defaultTurnaroundMinutes: 120,
  // Fallbacks when the `orders.evidenceMinPhotos` / `orders.evidenceMaxPhotos` preferences are
  // missing or corrupt. These are the GLOBAL bounds: a status that leaves its own `minEvidence`/
  // `maxEvidence` unset inherits them, and a per-status count may never fall outside them.
  defaultEvidenceMinPhotos: 1,
  defaultEvidenceMaxPhotos: 10,
  // Fallback when the `orders.evidenceRetentionMonths` preference is missing/corrupt — how long
  // evidence PHOTOS are kept before `pnpm purge:evidence` may remove them (orders are permanent).
  defaultEvidenceRetentionMonths: 24,
  // How long the in-process lifecycle catalog (`service_status` + its flags) is trusted before it
  // is re-read. Admin edits invalidate it explicitly, so this TTL exists for the changes that
  // CAN'T call back: a `pnpm db:seed`, a hand-edited row, and — on Cloud Run with more than one
  // instance — an admin edit made on a DIFFERENT instance. Without it a stale process serves a
  // machine that no longer exists (no pipeline ⇒ no next step ⇒ no quick action) until it restarts.
  // 60s: the definition changes rarely, so this is ~free, and it bounds every kind of staleness.
  statusCatalogTtlSeconds: 60,

  // Whether the create forms keep a silent draft of half-finished work. ON: losing twenty fields to
  // a mis-tapped back button is the failure worth preventing, and the draft is per-tab and dies with
  // it. Admin-editable — a shared machine is a real reason to want it off.
  defaultSaveFormDrafts: true,

  // Fallbacks for the `documents.*` preferences — the letterhead of every quote and order document
  // (EPIC-2-DOCUMENTS §6). The business NAME has a real default because a document with no
  // letterhead is broken, and this is the business the whole deployment belongs to; the phone and
  // the terms default to EMPTY on purpose — inventing a phone number would print a wrong one, and
  // an unwritten terms block is simply a document without that paragraph.
  defaultDocumentBusinessName: "Party Rentals GT",
  defaultDocumentBusinessPhone: "",
  defaultDocumentTerms: "",
  // The short conditions a document PRINTS, and the free-delivery line. Both default to EMPTY for
  // the same reason the terms do, and it matters more here: these are statements made in the
  // business's own voice on a page handed to a client. A missing row must print nothing rather than
  // put a policy nobody wrote into their mouth. The SEED, which knows which business this is, starts
  // them at the lines the old hand-made template carried — and the admin edits them from there.
  defaultDocumentConditions: "",
  defaultDocumentFreeDeliveryNote: "",
  // How long a quote states it is valid for (owner decision 2026-08-26: ONE WEEK). Long enough for
  // a client to decide, short enough that a stale document cannot be waved at us after prices or
  // availability have moved — and a week is the unit the business actually thinks in. Admin-editable
  // in Preferencias → Documentos, so this is only the value a database that has never seen the
  // setting resolves to.
  defaultQuoteValidityDays: 7,

  sensitiveKeys: ["password", "token", "secret", "creditCard", "cvv", "auth"],
  basePath: "/api",
} as const;
