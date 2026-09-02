# Ozari — Auth, sessions & security

The full record for the auth module on both sides: the request chain, sessions and rotation, MFA,
password reset, brute-force throttling, email, and the frontend integration. `CLAUDE.md` keeps only
the conventions a change anywhere in the repo must respect (the 422-vs-401 split, PII encryption, the
rate-limit tiers) — **read this file before touching anything under `ozari-api/src/modules/auth/`,
`src/middlewares/`, or `ozari-app/src/modules/sesion/`.**

---

## 1. The request chain (`app.ts`)

1. `helmet` (CSP `default-src 'none'`, HSTS preload), `trust proxy = 1`.
2. `express-rate-limit` tiers: public 30/min + authenticated 100/min (in `app.locals.rateLimiters`;
   `/auth` and `/products` both mount on the authenticated tier), plus a strict **credential limiter
   (10/min) applied PER-ROUTE in `auth.route.ts`** to the endpoints that verify a brute-forceable
   secret or create accounts (`/user`, `/signin`, `/mfa/verify-login`, `/change-password`,
   `/mfa/enable`, `/mfa/disable`); `/auth/refresh` has its own 5/min and forgot/reset their own 5/min.
   **Never put session reads (`/me`) on the credential tier** — the panel reads `/me` on every
   mount/focus, and 10/min starved it (the July 2026 dev 429s). The auth router also sets
   `Cache-Control: no-store` (its responses carry PII; also = no ETag/304 there — 304s elsewhere, e.g.
   `/products/catalog`, are the browser's normal conditional caching and fine).
3. CORS: strict allowlist of `APP_HOST` only, `credentials: true`.
4. Body size capped at `10kb`; 30s request/response timeout.
5. `validateApiKey` — requires `x-api-key` for non-browser callers; browser requests are trusted by
   `Origin === APP_HOST` (+ `sec-fetch-*` checks in deployed envs). Constant-time compare.
6. Per-request `X-Request-ID` validation + AsyncLocalStorage context; sensitive fields scrubbed via
   `sanitizeSensitiveData` (`appConfig.sensitiveKeys`).
7. Global error handler: stack traces only in `NODE_ENV=development`; 500s return a generic message.

Two routes are deliberately mounted **before** the API-key check (the docs' precedent), each with its
own 20/min limiter: the **Google OAuth callback** and the **ICS calendar feed** — see
`EPIC-2-CALENDAR.md` §6 for why each authenticates itself.

---

## 2. Sessions & tokens

- **Login** (`auth.controller.ts`): bcrypt verify (`@node-rs/bcrypt`, cost 12) → issue HS256 access
  (15 min) + refresh (30 days) JWTs, each with a `jti`. Sessions are persisted in the `jwt_sessions`
  table (one active access + one refresh per `deviceUuid`+`userId`), written in a `$transaction` with
  `SELECT … FOR UPDATE`.
- **Access token** is returned in the `Authorization` response header; **refresh token** in an
  HttpOnly cookie scoped to `/api/auth`. The CSRF token (double-submit, `csrf-token` cookie +
  `x-csrf-token` header) is set on login/refresh.
- **`verifyJwt` middleware** re-checks the DB session on every request (jti match, active, not
  expired) — tokens are effectively revocable.
- **Token issuance is centralized** in `auth.service.ts` (`issueAuthenticatedSession`), shared by
  login and the MFA login challenge.
- **Registration** (`POST /auth/user`) always creates a normal user (`roleId = RolesEnum.Client`); the
  API never grants admin — promote admins directly in the DB. Lookup tables (`user_roles`,
  `token_types`) must be **seeded** or register/login fail on FK constraints.
- **Login is constant-time** vs account enumeration: the "user not found" path runs a throwaway bcrypt
  compare against a fixed hash so it costs the same as "wrong password" (lookup is by `email_sha`, so
  bcrypt is otherwise skipped when no user exists).

### Refresh rotation, reuse detection & the grace window

`refreshToken` (protected by `verifyCsrfToken`) looks up the device's single active refresh row **by
device** (not by jti). A validly-signed token whose `jti` ≠ the device's current jti = a replayed
rotated token → **all** the user's sessions are **hard-deleted** (fail-secure, no tombstone garbage).

**One carve-out — the reuse GRACE window** (2026-07-16, migration
`20260716000000_jwt_sessions_rotation_lineage`): the refresh row records its rotation lineage
(`previousJti` + `rotatedAt`), and replaying exactly the **immediately-previous** jti within
`appConfig.session.refreshReuseGraceSeconds` (60s) is the LOST-RESPONSE race (reload/tab-close/network
drop killed the rotation response after the server committed — this NUKED dev sessions constantly and
could hit prod) → re-rotate instead of nuking.

- Lineage chains to the REPLACED jti, so the same old token can never ride the grace twice; an
  attacker/victim alternation collapses at the victim's next proactive refresh (outside grace → nuke).
- Rotation hard-deletes old rows + creates new ones in a `$transaction` with `SELECT … FOR UPDATE`;
  the grace predicate is re-evaluated UNDER the lock.
- An in-transaction mismatch (neither current nor grace) = a concurrent double-submit → clean `401`
  (not theft, not 500) — and the frontend `refreshAccessToken` **retries once on a 401** before
  declaring the session dead (the concurrent-tab loser recovers: the browser already holds the
  winner's cookie).
- Consequence: the cleanup job is NOT required for active users (no garbage) — only for expired rows
  from abandoned logins.

### Persistent login (works by design — don't "add" it again)

The access token is per-tab (sessionStorage) but the real session is the 30-day HttpOnly refresh
cookie + the **localStorage** CSRF token (stateless HMAC, no expiry — deliberately durable so a fresh
tab can refresh). Both route guards silent-probe `/auth/refresh` when the tab has no valid access
token (`routes/panel.tsx`, and `routes/sesion.tsx` once per tab), so a reopened browser rehydrates
straight into the panel until the refresh token ages out (30 days idle).

The /sesion probe's once-per-tab gate lives in `sessionLifecycle.ts`
(`shouldSilentProbeSession`/`markSessionProbeDone`) and **every teardown (`clearAuthState`) consumes
it** — landing on the login screen right after a logout must NOT probe the session that was just
revoked (the 403-refresh-after-signout bug, fixed 2026-07-16; the same change killed the double-probe
on a dead-cookie visit to a bookmarked /panel URL). The gate is deliberately one-way per tab: after
any probe or teardown the login screen never auto-rehydrates again without a hard reload.

⚠️ **Deployed caveat:** pages.dev ↔ run.app are different registrable domains, so the refresh cookie
is a THIRD-PARTY cookie there — Safari/iOS (and Firefox/Brave strict modes) block it, killing sessions
after the 15-min access token. The fix is serving both under `partyrentalsgt.com` subdomains
(pre-production checklist, EPIC-1 §5 / DEPLOYMENT.md §3c) — same-site first-party cookies everywhere.

---

## 3. Password reset (forgot / reset)

`POST /auth/forgot-password { email }` always returns a generic success (anti-enumeration, like
login); when the email IS known it mints a **single-use, 30-min, SHA-256-hashed** token
(`password_reset_tokens`; only the **hash + expiry** are stored, one live token per user) and emails a
tokenized link (`buildPasswordResetEmail`, CTA = the link, not sign-in).

`POST /auth/reset-password { token, newPassword, confirmPassword }` treats invalid/unknown/expired
tokens as one generic `400`, rejects reusing the current password, then in one `$transaction` sets the
password, consumes every reset token, and **hard-deletes ALL of the user's sessions on every device**
— unlike change-password (which keeps the current device), a reset has **no trusted current device**.

Both endpoints are **public + rate-limited (5/min)** and stay on `400`/generic errors (no session ⇒
not the 401/422 convention). Confirmation reuses `buildPasswordChangedEmail` (best-effort). Logic
lives in `auth.password.controller.ts`; config in `appConfig.passwordReset`
(`tokenBytes`/`tokenTtlMinutes`/`resendCooldownSeconds`); migrations
`20260707000000_password_reset_tokens` + `20260708000000_password_reset_drop_used_at`. The reset link
points at the frontend route `/sesion/restablecer?token=…`.

- **No garbage / no tombstones.** There is deliberately **no `usedAt`** column: a used token is
  **hard-deleted**, not marked (fail-secure, and nothing accumulates). Abandoned tokens (requested,
  never used, past TTL) are swept by `cleanupExpiredSessions` (`pnpm cleanup:sessions`).
- **Anti-bombing cooldown.** After an email is sent, a **per-account cooldown**
  (`resendCooldownSeconds`, 60s) suppresses re-sending to the same account — derived from the live
  token's `createdAt`, so it is **global (DB-backed), not per-instance** like the IP limiter. A
  throttled request still returns the identical generic success (leaks nothing).
- **Sessions are NOT revoked on the *request*, only on completion.** Revoking on the forgot request
  would let an unauthenticated attacker force-logout any user just by knowing their email — a DoS.
- **Residual: enumeration by *timing*.** The email-exists path does DB writes + an **awaited** email
  (~100–300 ms) vs an instant not-found return, so response *timing* still distinguishes registered
  emails (the body/status are identical). The email is awaited by necessity — on Cloud Run CPU is only
  allocated during the request, so fire-and-forget would drop it. Accepted: bounded by the rate limit
  + the cooldown (which removes the email from repeat requests); a task queue would be the full fix.

---

## 4. Brute force — the counters live in the DATABASE (2026-09-01)

Migration `20260901000000_auth_attempts`. `src/services/authThrottle.service.ts` is the ONE store
behind both `loginRateLimit.middleware.ts` (per-EMAIL, 5 / 15 min) and `mfaRateLimit.middleware.ts`
(per-USER, 5 / 15 min); the middlewares now only decide and audit. The move was about the STORE, never
the policy: same thresholds, window, `429` and audit events.

- **Why:** an in-memory `Map` is enforced once per instance — at `max-instances = 3` a "5 per 15 min"
  rule was really up to 15 — and a scale-to-zero service forgets every count when it goes cold.
  Postgres is already on the login path, so global + durable costs one indexed query and no new
  infrastructure. **Redis/Memorystore was deliberately NOT bought**: ~$40/mo to tighten a limit that
  bcrypt(12) + a 12-char policy already make hopeless to walk past is the wrong trade.
- ⚠️ **The stored subject for LOGIN is the email's SHA-256, never the address** — otherwise the table
  becomes a list of which emails have accounts, exactly what `/auth/signin`'s constant-time path
  exists not to leak. MFA stores the user id (not secret, and trusted: it runs after the challenge
  token is verified).
- **The increment is ATOMIC** (`updateMany` scoped to a live window, then an `upsert` only when there
  is none): a read-then-write would let two simultaneous guesses both read 4 and write 5, so a lockout
  could be walked past by racing it.
- **Every store failure FAILS OPEN and is logged.** The credential check needs the same database
  anyway, so refusing on a counter error would turn a blip into an outage for the honest user while
  denying an attacker nothing.
- Lapsed rows are swept by `cleanupExpiredSessions` — a live window is never deleted, since that would
  hand out a free reset.
- **`express-rate-limit`'s per-IP tiers are still in-memory and per-instance, on purpose** — they are
  fairness/DoS speed bumps, not account protection. The one thing worth verifying there is what
  `req.ip` resolves to behind the Cloudflare Worker (DEPLOYMENT.md §3c): if it collapses to an edge
  address, every visitor shares one bucket and the app throttles itself.

---

## 5. MFA / TOTP

Hand-rolled in `src/helpers/totp.ts` (RFC 6238, HMAC-SHA1 via `node:crypto`, **no dependency**;
validated against the RFC test vectors). The secret is AES-encrypted in `users.mfa_secret_kms`;
`mfa_enabled_at` flags activation; `mfa_last_used_at` enforces TOTP replay protection (a step cannot
be reused). Recovery codes are SHA-256-hashed, one-time, in `mfa_recovery_codes`. The MFA login
challenge uses a short-lived (5 min) `MFA_TOKEN` JWT (stateless, not a DB session).

---

## 6. PII at rest & roles

- Email / full name / phones / addresses are AES-256-GCM encrypted (`encryptKms`/`decryptKms`,
  `*_kms` columns) — the `kms` suffix just means "encrypted with our local AES key", **not** AWS KMS.
  A separate SHA-256 lookup column (`email_sha`) is used for unique/equality queries.
  `ENCRYPTION_KEY` must be 32 bytes hex. The `email_sha`/`email_kms` pattern is reused wherever a
  secret must be both matchable and re-displayable (the ICS feed token).
- **Roles:** `RolesEnum`, gated by `isGrantedRoles([...])` (`role.middleware.ts`).

---

## 7. Endpoints (all under `/api/auth`)

| Method + path | Middleware | Purpose |
|---|---|---|
| `POST /user` | validate | Register (create user) |
| `POST /signin` | validate + login rate limit | Password login → tokens, or `{ mfaRequired, mfaToken }` if 2FA is on |
| `POST /mfa/verify-login` | `verifyMfaChallengeToken` | Second login step: TOTP **or** recovery code → issues the session |
| `POST /refresh` | csrf + refresh limiter | Rotate tokens (reuse detection) |
| `POST /forgot-password` | validate + reset limiter (5/min) | **Public.** Request a reset; always a generic `200`; emails a tokenized link if the email is known |
| `POST /reset-password` | validate + reset limiter (5/min) | **Public.** Reset via the emailed token → set new password + **revoke ALL sessions on every device** |
| `POST /signout` | csrf | Logout; identity from the refresh cookie so it **works with an expired access token**; idempotent |
| `GET /me` | `verifyJwt` | Current user's decrypted profile (+ `mfaEnabled`) |
| `POST /change-password` | `verifyJwt` + csrf | Verify current pwd, reject reuse, revoke other-device sessions |
| `POST /mfa/setup` | `verifyJwt` + csrf | Generate TOTP secret + otpauth URI (pending until enabled) |
| `POST /mfa/enable` | `verifyJwt` + csrf | Confirm a code → enable 2FA, return one-time recovery codes |
| `POST /mfa/disable` | `verifyJwt` + csrf | Require password → clear secret + recovery codes |
| `GET /all` | `verifyJwt` + admin role | Admin user list |

### ⚠️ The wrong-secret status convention (422 vs 401)

On authenticated auth-flow endpoints, a supplied *secret* being wrong — wrong TOTP (`mfa/enable`,
`mfa/verify-login`), wrong password (`mfa/disable`, `change-password`) — returns **`422
UNPROCESSABLE_ENTITY`, NOT `401`**. `401` is reserved for a genuinely bad/expired/absent credential
caught by middleware (`verifyJwt`, the MFA challenge-token check).

The reason is a client contract: the frontend interceptor treats a `401` on a protected call as
"access token stale → silent refresh + retry", so returning `401` for a wrong code would fire a
spurious refresh and replay the bad input. **Keep every new auth endpoint on this split** (semantic /
input error = 422; not-authenticated = 401). Login (`/signin`, public, no session yet) stays `401` —
the textbook not-authenticated case, and it does not trigger a refresh.

---

## 8. Email

The `Mailer` abstraction (`src/helpers/mailer.ts`) has a real provider: **`ResendMailer`** (official
`resend` **SDK**; the earlier "native fetch" plan was superseded). `getMailer()` selects once per
process: **`EMAIL_KEY` set → `ResendMailer`** (real delivery in ANY env, so flows can be tested
locally); **else deployed → `NoopMailer`** (drops it, logs a warning **without** the token); **else dev
→ `LogMailer`** (logs the content). The **only** email env/secret is `EMAIL_KEY` (Secret Manager
`ozari-email-key`). Never log reset tokens/links in deployed envs.

- **Sender identity is code config, NOT an env var** — it is our brand and does not vary by
  environment. `appConfig.email.from` is a purpose-keyed map (`default`, `welcome`, `security`, …),
  all on the **verified** `partyrentalsgt.com` domain (e.g. `no-reply@`, `bienvenida@`,
  `seguridad@`). A `MailMessage` may set its own `from`; the mailer falls back to
  `appConfig.email.from.default`. Add a new per-purpose sender here, not as an env var.
- **Branded templates** live in `src/emails/` (`layout.ts` = the reusable shell mirroring the app —
  the auth screens' soft radial background, white paper card, cream→blossom gradient header, and the
  app's charcoal `components/Button` primary; per-email builders like `welcomeEmail.ts`, each picking
  its `from` from `appConfig.email.from`). Email HTML is table + inline styles. The **only** `<style>`
  block is progressive enhancement that cannot inline: the button `:hover` (a subtle **lift +
  shadow**, mirroring the app button — NOT a colour swap). **No animations** — email cannot run them;
  the design carries through colour/spacing/type.
- **Always light — NO dark variant.** The card is white in every client. `color-scheme: light` (meta +
  CSS) asks clients that honour it (Apple Mail/iOS) not to auto-dark it. Gmail's **mobile app**
  force-inverts regardless and ignores that signal — it **cannot be controlled**, so we do not chase
  it; the light design is the single source of truth (do not reintroduce a `prefers-color-scheme`
  block).
- **Logo:** `appConfig.email.logoUrl` (or a per-call `logoUrl`) renders a header `<img>`; `""` ⇒ the
  text wordmark carries the brand. It MUST be a **publicly hosted PNG** — Gmail blocks `data:` URIs
  and strips SVG, and many clients block remote images by default (so the wordmark is the reliable
  baseline). Currently a charcoal raster of `LogoMark` at **`ozari-app/public/email-logo.png`**,
  served from the frontend origin — so it only renders once the **frontend is deployed** with that
  asset; update the URL if the frontend moves to the apex domain.
- **i18n for templates = same as the app:** ONE template structure, strings per language via i18next
  (`email.*` keys per `locales/<lng>/translation.json`) — do **not** fork templates by language.
  Currently **es-GT only**. To localise per recipient later, pass `lng` to `i18next.t` (and store a
  user `locale`); the welcome builder uses the global default for now.
- **Copy fact:** registration makes an **active client immediately** (no admin-enablement gate — the
  old "an admin will enable your account" line was wrong), so the welcome CTA is **"Iniciar sesión"**
  → `/sesion/inicio`. Tone is cordial, not affectionate.
- **The reference wiring pattern is best-effort:** `createUser` sends `buildWelcomeEmail` awaited, but
  a failure is caught + logged and NEVER fails registration — the account already exists.
- **Security notifications** (`src/emails/securityEmail.ts`, shared `buildSecurityEmail` shell) are
  wired best-effort onto their existing endpoints — **password changed** (`change-password`), **2FA
  enabled** (`mfa/enable`), **2FA disabled** (`mfa/disable`) — all from `appConfig.email.from.security`,
  each with a "wasn't you?" safety line and a CTA to sign in.
- The Resend domain **`partyrentalsgt.com` is verified** (root domain; DKIM + SPF/MX on the `send`
  return-path subdomain), so sends go to any recipient in every env. (DMARC at `_dmarc` is a
  recommended future add for deliverability monitoring.)
- **Email verification is a deliberate FUTURE feature, NOT built** — clients use the app without it
  today. When needed, add a nullable `users.email_verified_at` + a verification-token flow (reuse the
  password-reset token machinery). No schema column exists for it yet.

---

## 9. Audit logging

Security/auth/user-management events are logged via `src/config/auditLogger.ts`, but **only when
`isDeployedEnvironment()`** is true (staging/production). See `ozari-api/AUDIT_LOGGING_GUIDE.md`.
Don't expect audit rows locally.

---

## 10. Frontend auth integration (reference — DONE)

`api/client.ts` interceptors attach `Authorization: Bearer <token>` (access token in
**sessionStorage**, not localStorage — see `utils/storage.ts`), attach `device-uuid` and
`x-csrf-token`, and on `401` perform a single-flight token refresh (`utils/tokenRefresh.ts`) with
request queueing. `tokenRefresh.ts` also runs a **proactive** timer that refreshes 60s before expiry.
Route guards: `routes/panel.tsx` `beforeLoad` validates the token (and tries a silent refresh) before
allowing the panel. `utils/jwt.ts` decodes (does **not** verify — that is the backend's job) for
expiry/timing only. `utils/deviceUuid.ts` generates + persists a per-device UUID.

### Two-step MFA login (in-card)

`POST /auth/signin` may return `200` with body `data: { mfaRequired: true, mfaToken }` and **no**
`Authorization` header. `LoginPage` holds a `step: 'credentials' | 'mfa'` + the `mfaToken` in
**component state (in memory only, never storage** — it is a 5-min credential). On `mfaRequired` it
does **not** navigate: `useAuthCard`'s **`swapFormColumn(commit)`** sweeps the login form-column out,
swaps in **`MfaLoginStep`**, and tweens the card height — the same "cover, settle, resize" motion as
the login↔register sweep. On verify success it reuses `redirectAfterSuccess`; a 401 sweeps back to the
credentials step.

- **`useMfaVerifyLogin`** posts `verify-login` as a **`public` request** with
  `Authorization: Bearer <mfaToken>` + `{ code }`. `public` is load-bearing: the request interceptor
  returns early **before** attaching the stored access token (so the Bearer `mfaToken` survives) and
  the response interceptor **skips the 401 refresh**. Success establishes the real session via the
  shared **`establishSessionFromResponse`** (`@utils/session`, also used by `useLogin`).
- **Status codes:** `422` = **wrong code** (valid `mfaToken`; `MfaLoginStep` shows it inline and lets
  the user retry); `401` = the 5-min `mfaToken` expired (sweep back to credentials); `429` = locked
  ~15 min (inline). This is the client half of the 422-not-401 convention.
- **One code field, two modes.** `@components/MfaCodeField` takes `mode: 'numeric' | 'text'` — numeric
  = 6-digit TOTP (`autocomplete="one-time-code"`, digits-only, `onComplete` fires on a **bulk fill**
  for auto-submit), text = 16-char base32 recovery code. `MfaLoginStep` toggles between them
  (`SchemaMfaLogin` swaps the active resolver). **Auto-submit** (GitHub/1Password one-tap) fires
  **only** on a paste/autofill that completes the field — never on typing — deduped by last value with
  **no auto-retry** (a manager re-filling the same wrong code is a no-op, so nothing
  loops/saturates). Recovery mode never auto-submits.

### The other flows

- **MFA setup:** `POST /auth/mfa/setup` → QR (`MfaQrCode`) + manual secret; confirm with
  `POST /auth/mfa/enable { code }` → `data.recoveryCodes` shown **once** (`RecoveryCodesPanel`, never
  persisted). The enable modal uses `useModalPhaseTransition` for the setup→recovery whole-panel
  sweep.
- **change-password:** `modules/panel/settings/ChangePasswordModal.tsx` — `Modal` + RHF
  (`SchemaChangePassword` mirrors the backend), `useChangePassword` with `skipErrorNotification`.
  Errors inline per field (422 → current-password [401 kept as a defensive fallback], 400 reuse → new
  password; ambient → toast); success toasts + closes (**no** local re-login — the backend revokes
  only other devices). This is the reference **authenticated panel-form + CSRF** pattern.
- **MFA disable:** `modules/panel/settings/MfaDisableModal.tsx` — the Settings → Security MFA switch
  is interactive when on; toggling it opens this confirm dialog (it never flips until `ME` says so).
  Turning off a factor is a **step-up** action: it re-requires the **account password**, states the
  consequence in an amber warning, and on success invalidates `ME`. Wrong password → 422 inline.
  It **deliberately keeps the user's other sessions** — session revocation is reserved for credential
  *changes*, not for toggling a factor off (the password was just re-verified; no credential changed).
- **register:** `useRegister` → `POST /auth/user`, `{ public: true }`. On success it shows a status
  line, then animates back to login. Mirrored Zod (`register/SchemaRegister.ts`): `fullName, email,
  password, confirmPassword` (must match) + `termsAccepted === true`.
- **signout** works even with an expired access token (reads the refresh cookie); still send the CSRF
  header. Idempotent — on any 2xx, clear local state.
- **Password reset, two halves.** **(1) Request = in-card**, like the MFA step: a "¿Olvidaste tu
  contraseña?" link runs `useAuthCard.swapFormColumn` to **`login/ForgotPasswordStep.tsx`** (email →
  `useForgotPassword`, a `public` + `skipErrorNotification` request). Because the backend response is
  deliberately identical whether or not the email exists, success just fires a **generic confirmation
  toast** and sweeps back to the credentials step — never revealing whether the email is registered.
  **(2) Reset = a dedicated route** `/sesion/restablecer` (`login/ResetPasswordPage.tsx`): it reads
  `?token=` and **redirects to login in `beforeLoad` when the token is absent**, wears the
  register-style auth card (`useAuthCard('register')`), and on success morphs to login via `leaveTo`
  with a success toast. An invalid/expired token or reused password (generic `400`) shows inline;
  429/5xx/offline go to toast/overlay. Mirrored Zod: `login/SchemaForgotPassword.ts` +
  `login/SchemaResetPassword.ts` (the token is a URL param, not a field).
- **Reset-link auth-state edge cases** (in the route guards, both coverage-excluded): the `/sesion`
  parent guard normally bounces a logged-in user to the panel, but **makes an exception for
  `/sesion/restablecer` WITH a token** (a signed-in user clicking their own reset link must reach it).
  No token → the parent sends a logged-in user to the panel and the child route redirects everyone
  else to login. On arrival with a token, if a local session exists it is **cleared
  (`clearAuthState`)** — the reset revokes every session on completion anyway, so a half-logged-in
  state would only confuse.

---

## 11. Validation policy (mirrored FE ↔ BE)

Both sides validate with **Zod 4**. The schemas are **deliberately mirrored** (same logic, separate
files — the two packages cannot import each other) and must accept/reject **exactly the same values**.
The backend is the security boundary; the frontend copy is UX only. **When you change any rule, change
it in both mirror modules in the same commit.**

- Backend: `ozari-api/src/helpers/validators.ts` (`emailField`, `passwordField`, `fullNameField`) +
  `regex.ts`. Auth validators compose these fields.
- Frontend: `ozari-app/src/utils/formFields.ts` (same three) + `constants/Regex.ts` (incl.
  `FULLNAME_REGEX`/`FULLNAME_*`, mirroring the backend `fullNameRegex`). `SchemaLogin` composes
  email+password; `SchemaRegister` also composes `fullNameField` + `confirmPassword` match +
  `termsAccepted`.
- **Email** via Zod `.email()`, max **254** chars (RFC 5321), trimmed/lowercased on the backend.
- **Password** 12–128 chars, ≥1 lowercase, ≥1 uppercase, ≥1 digit, ≥1 symbol (any non-alphanumeric);
  the allowed set is **all printable ASCII except space** (`\x21`–`\x7E`) — every keyboard symbol is
  fine, only spaces, control chars and non-ASCII (accents/emoji) are rejected. Passwords are
  bcrypt-hashed (never in SQL), so the character set is a policy/UX choice, not an injection defence.
- **Full name** 5–255 chars (letters incl. accents, digits, spaces, `'`, `-`).
- `deviceUuid` is sent as a **header** (`device-uuid`), not in the body; the backend validator merges
  it in (`auth.validator.ts`). Sign-in only checks the password is non-empty (never re-enforce the
  full policy on login).
- The shared length constants (`PASSWORD_MIN_LENGTH`, `EMAIL_MAX_LENGTH`, …) exist on both sides as
  the documented contract.

**Can we share one Zod schema across FE and BE?** Not as-is — two separate pnpm workspaces (no root
`package.json`). To truly share one module the repo must become a **single root pnpm workspace** (root
`package.json` + `pnpm-workspace.yaml` listing `ozari-api`, `ozari-app`, and a new `packages/shared`),
publishing the validators/regex as a workspace package both import. That is a real refactor
(lockfiles, Docker context, Cloudflare build, path aliases all change) — propose it explicitly; don't
do it as a drive-by.
