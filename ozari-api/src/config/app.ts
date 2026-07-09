import { isDeployedEnvironment } from "./environment.js";

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
    // URIs and don't render SVG — Gmail strips both). Served from the frontend's `public/` — so it
    // only renders once the frontend is DEPLOYED with `email-logo.png`; update this URL if the
    // frontend moves to the apex domain (e.g. https://www.partyrentalsgt.com/email-logo.png). Set to
    // "" to fall back to the text wordmark. Many clients block remote images by default, so the
    // wordmark still carries the brand when the image doesn't load.
    logoUrl: "https://ozari-c28.pages.dev/email-logo.png",
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

  sensitiveKeys: ["password", "token", "secret", "creditCard", "cvv", "auth"],
  basePath: "/api",
} as const;
