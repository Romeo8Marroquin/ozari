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
    },
    // Hosted logo for the email header. MUST be a publicly reachable PNG (email clients block data:
    // URIs and don't render SVG — Gmail strips both). Served from the frontend's `public/` — so it
    // only renders once the frontend is DEPLOYED with `email-logo.png`; update this URL if the
    // frontend moves to the apex domain (e.g. https://www.partyrentalsgt.com/email-logo.png). Set to
    // "" to fall back to the text wordmark. Many clients block remote images by default, so the
    // wordmark still carries the brand when the image doesn't load.
    logoUrl: "https://ozari-c28.pages.dev/email-logo.png",
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
