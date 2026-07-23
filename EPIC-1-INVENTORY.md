# Epic 1 — Inventory (Products)

> **STATUS: COMPLETED (2026-07-15, PR'd from `feat/rems`).** Every step (0–5) shipped, including
> the update/delete rebuild (RECONCILE + the no-trash policy), the gallery with drag-reorder, and
> the §5 reconcile script. This file is retained as the **decision record** — the owner decisions
> and patterns here are inherited by later modules and cross-referenced from `CLAUDE.md`.
> ONE known supersession: the "Employee sees products read-only" role model below is OUTDATED —
> the owner redefined employees as DRIVERS with no product access (see `EPIC-2-ORDERS.md` §3,
> the EPIC-2A refactor, which is the next epic's mandatory first step).
>
> The high-level, cross-epic compass is `ROADMAP.md`. Decisions here were made with the
> product owner (2026-07).

---

## 0. North star & where this sits

Ozari is the internal ops tool for a **party-rentals** business. Epic 1 builds the **product catalog +
inventory** — the foundation every later module (orders, availability, calendar) reads. We build the
**admin experience fully**; employee/client paths are *architected for* but not feature-built yet.

**Compass for what's next (rough — will change):**
`1. Inventory (this) → 2. Clients → 3. Orders/Events → 4. Availability engine → 5. Delivery calendar.`
**North star:** an admin runs the entire rental operation from one panel — *what we own, who rents it,
what's out right now, what's free on a given date, and the delivery schedule.*

---

## 1. Architecture decisions locked in this epic

### Roles — the model the whole app is built around
| Role | Products (this epic) | Business ops (later epics) |
|---|---|---|
| **Admin** | **Full** — create/update/delete, stock, images | Everything |
| **Employee** | **View only** (same shared product screens as everyone, no write controls) | Operate the business — orders, deliveries, availability, sell/rent — but **never create/delete/modify entities** |
| **Client** | **View only** (sees the catalog / empty state; no write controls) | *future portal:* view + create their own orders |

- **The panel is OPEN to every authenticated role** (Client, Employee, Admin). Role does **not** gate
  panel *access* — it restricts *capabilities* **within the shared views**. Same route, same component,
  same everything; the difference is which controls render. (Decided with the owner, 2026-07 — this
  supersedes the earlier "panel = staff only / bounce clients" idea.)
- **Settings is available to everyone** (account/security is every user's own).
- **Products view is shared:** Client and Employee see the catalog / empty state with **no** write
  controls; **only Admin** sees the "add product" action + management. **Product reads = all
  authenticated; product writes = Admin only.**
- **Focus is ADMIN now.** Employee/Client capabilities may legitimately be "not implemented yet" —
  fine, as long as their (shared) view never *breaks* and never shows a control they can't use.

### Role enforcement — a security requirement, not just UX
- **Backend:** a role middleware taking an **array of allowed roles**, where the role is **verified
  against the DB (the source of truth), not just trusted from the JWT claim** — so a changed/revoked
  role is enforced on the very next request. Deny → **`403`** (distinct from `401` not-authenticated
  and `422` bad-input). Efficient: fold the user's current `roleId` into the existing `verifyJwt` DB
  session lookup so there's **no extra query**.
- **Frontend:** role drives **what's visible** (action buttons, empty-state CTAs, any role-specific
  tabs) — a **UX layer, NOT the security boundary.** The backend `403` is the real guard. Controls a
  role can't use are **hidden** (`RoleGate`/`useHasRole`) so the call never fires.
- **A `403` should therefore never happen in normal use** (defense-in-depth). If one does — a
  stale-role race, a bug, or someone poking devtools — it is **not** a screen takeover: surface the
  backend's localized message as a **non-blocking toast** ("no tienes permiso") and leave the app
  where it is. (No "forbidden" full-screen; that's reserved for genuine dead-ends like crash/outage.)

### Pricing model
- A product is **exactly one** business type: **Venta** (sell) **or** **Alquiler** (rent).
- **Venta →** `sellPrice` (its only price).
- **Alquiler →** `rentPrice` **per a per-product-selectable period unit** — **dynamic**, chosen at
  product creation: a **time unit** (Hora/Día/Semana/Mes) **or "Evento"** (a flat rate for the whole
  event, duration-agnostic). Logistics slippage (a late pickup, extra hours) is **handled by the
  calendar/orders later** and **never** alters the product's standard period or price.
- **Replacement value** (`replacementPrice`, optional but always captured) — what a **lost/damaged**
  rental is billed "as new". Stored even though billing consumes it later, so the catalog can represent
  every real business case.
- The form shows the relevant price(s) + the rent-period unit by business type; the schema keeps prices
  nullable.

### Images — a multi-image gallery
- **Multiple images per product**, stored in **R2** (via the presigned-upload flow already built),
  presented with a **beautifully designed gallery** — hero + thumbnails, a **lightbox** (keyboard +
  swipe), and for admins **drag-reorder + set-primary + delete** — while gracefully handling the
  **single-image** and **zero-image** cases.
- **The first image is the highlighted/primary one** — it's what appears in the product grid/list and
  as the hero. The default is the first uploaded, but the admin can **set any image as primary**
  (`ProductImage.isPrimary`).
- **Display standard for product photos:** a consistent **vertical 4:3 (portrait) frame** with
  `object-fit: cover`; the lightbox shows the full image (`contain`). *(Other galleries — events,
  landing examples — can use a different/adaptive ratio; the portrait 4:3 rule is product photos only.)*
  Accept jpg/png/webp/avif (already in `appConfig.storage`), ≤ 5 MB, optional client-side downscale
  before upload to keep R2 lean.
- Needs a schema change: a **`product_images`** relation (supersedes the single `Product.imageUrl`).

### Navigation
- The panel nav shows **only built modules.** Now that Settings is real, we start "seriously": nav =
  **Products + Settings** (remove the placeholder tabs kept only for animation testing). Default
  `/panel` → **`/panel/productos`** (a dashboard lands later). Nav is **role-filtered**.

---

## 2. Steps

Each step is ~one focused session and ships end-to-end: **backend + frontend + tests + docs**, both
packages **green at the enforced 100% coverage**, `tsc`/`lint` clean, and OpenAPI + `EXPECTED_OPERATIONS`
updated for any endpoint. (Standing bar: see `ROADMAP.md` §0.)

### Step 0 — Schema refinement & migration  *(decisions locked — see §3)*
- Add **`ProductImage`** (id, productId FK, `r2Key`, `url`, `sortOrder`, `isPrimary`, `isActive`,
  timestamps); **retire `Product.imageUrl`** (the relation + `isPrimary` replaces it).
- Add **`Product.replacementPrice`** `Decimal(15,2)?` (always captured).
- Add the **rent period unit** — `Product.rentTimeUnitId` → a seeded **`rent_time_units`** lookup:
  **Hora, Día, Semana, Mes, Evento** (Evento = flat per-event, duration-agnostic). Default "Día".
- Author via Prisma migration (mind the shadow-DB note in `CLAUDE.md`), extend `seed.ts` (new lookup),
  verify `migrate status` clean. Everything downstream depends on the final Product shape, so lock here.

### Step 1 — Role-access foundation *(the bedrock)*
**Backend**
- Harden the role middleware: array-of-roles + **DB-verified current role** (fold `roleId` into the
  `verifyJwt` lookup); `403` on deny with the standard error envelope + i18n. Confirm the
  `401`/`403`/`422` split holds.
**Frontend**
- `useRole()` / `useHasRole(roles)` (decoded token for instant UX; `useMe` for the verified profile).
- `<RoleGate roles={…}>` for conditional UI; **role-filterable** panel nav (mechanism in place; both
  current tabs are visible to everyone).
- **Panel route guard = authenticated only (any role).** The panel is open to Client/Employee/Admin;
  role restricts capabilities *within* the shared views, not access.
- **`403` handling:** a non-blocking **toast** with the backend's localized message. A 403 is
  defense-in-depth (controls are role-hidden, so it shouldn't happen in normal use); it is never a
  full-screen takeover.
- **Nav refactor:** Products + Settings only; default → products; remove placeholder tabs.

### Step 2 — Products read + list
**Backend** `GET /products` (search by name; filter by category/businessType/active; pagination) +
`GET /products/:id` (detail incl. images). Read = Admin+Employee. Map `Decimal→number`; include
category/businessType/currency/details/images. Mount the route + un-comment the module. OpenAPI + tests
+ i18n.
**Frontend** `/panel/productos` list (grid), search + filters, **skeletons**, **role-aware empty
states** (admin → "Agregar producto" CTA; employee → friendly message, no CTA), graceful error
fallback. `useProducts` query.

### Step 3a — Product CREATE  *(Admin only)* ✅ shipped
**Backend** `POST /products` (create + nested details; the **conditional price rule** by business
type in the rebuilt validator) + `GET /products/catalog` (the five seeded lookups the form's selects
need — ids, which the role-projected reads never expose). OpenAPI + tests + i18n done.
**Frontend** a dedicated **PAGE** `/panel/productos/nuevo` (decision revised 2026-07 with the owner —
supersedes this step's original "create/edit Modal": ~10 fields + a details sub-editor + the Step-4
gallery outgrow a 512px dialog; modals stay for confirmations/quick actions). Wired through the
panel's animated transition (`PanelPath` extended; the Products tab stays lit via `startsWith`).
`ProductForm` (reusable by the future edit page) + mirrored Zod + conditional pricing UI + details
sub-editor + seeded-lookup selects (new `CustomSelect`/`CustomTextarea` primitives) + **silent
sessionStorage draft** (autosave/restore/discard — no blocking "leave?" dialogs; cleared on submit
and on logout). Non-admin deep-links get a friendly no-permission panel. Cache invalidation +
`toFormError` (concern-#4).

### Step 3b — Product UPDATE / DELETE  *(Admin only — pending)*
**Backend** `PUT /products/:id` (update — **fix** detail add/remove/update, not just in-place),
`DELETE /products/:id` (soft-delete, cascade to details/images). Follow `createProduct`'s shape.
**Frontend** edit page reusing `ProductForm` (mode prop / initial values), soft-delete confirm
`Modal`. The likely companion: a product **detail page** `/panel/productos/:id` (view for all
roles, admin sees Editar/Eliminar) — decide when building.

### Step 4 — Image gallery (R2)
**Backend** presigned endpoint for **multiple** uploads (reuse `storage.ts`), persist `ProductImage`
on confirm, endpoints to **reorder / set-primary / delete** (delete calls `deleteObject`). Admin only.
OpenAPI + tests.
**Frontend** the **gallery**: hero + thumbnails, **lightbox** (keyboard + swipe, focus-trap via
`Modal`), admin **drag-reorder + set-primary + delete**, multi-file upload to presigned URLs with
progress + optional client downscale, graceful single/zero-image. Reusable `ProductGallery` +
`ImageUploader`, a11y throughout.

### Step 5 — Polish & un-WIP
- Full a11y pass (roles, labels, keyboard, reduced-motion); every empty/loading/forbidden state per
  role; responsive. OpenAPI complete; **remove products from the `CLAUDE.md` WIP list**; both suites
  100%; `tsc`/`lint` clean; manual smoke across all three roles (admin full · employee read-only ·
  client gracefully bounced).

---

## 3. Decisions (were open items — now locked, 2026-07)
1. **Rent period** → a seeded **`rent_time_units` lookup**, per-product selectable, values
   **Hora/Día/Semana/Mes/Evento** (Evento = flat per-event). Default "Día".
2. **`Product.imageUrl` is retired** in favour of the `ProductImage` relation; the **primary** image
   (`isPrimary`, defaults to the first, admin-changeable) is what shows in grid/list/hero.
3. **`replacementPrice` is included now** (always captured, even though billing uses it later).
4. **Product photos use a vertical 4:3 (portrait) frame.** Other galleries (events/landing) may vary.
5. **Entity create/edit = a dedicated PAGE, not a modal** (revised with the owner, 2026-07; supersedes
   Step 3's original "create/edit Modal"). The decision tool: a modal only fits ≤ ~5-6 fields / one
   decision / seconds / no sub-editors / no media / never needs a URL; anything with sections, dynamic
   rows, media, growth, or draft-loss risk is a page. Product forms hit every page criterion;
   delete confirms stay modals.
6. **Unsaved work = silent draft persistence, never `beforeunload` nagging.** The create form
   autosaves to sessionStorage (survives refresh/navigation, dies with the tab), restores with a
   visible note + an explicit discard, and clears on success and on logout (user-scoped state).

## 4. Definition of done
Admin fully manages inventory (CRUD + multi-image gallery + stock + pricing) from `/panel/productos`;
employee sees a clean read-only view; a client is gracefully kept out of the panel; **every** endpoint
is role-gated + documented; both packages green at 100%; the nav shows only built modules with products
as the default landing.

## 5. Pending — verify before "functionality complete" / production cutover
- **RE-RUN `pnpm db:seed` AFTER ANY MIGRATION THAT ADDS SEEDED REFERENCE TABLES — per environment,
  right after `prisma:migrate:deploy` (a REQUIRED deploy step, not optional).** Migrations create
  the *structure* (empty tables); the seed fills the *reference data*, and it runs SEPARATELY (never
  part of `migrate deploy`, by design so a deploy never touches data). **Concrete case (Epic-2,
  2026-07-16 migration `20260716120000_epic2_orders_schema`):** it added `event_types`,
  `contact_types`, and `app_preferences` — the order-create form's `/orders/catalog` returns them,
  and an empty `event_types`/`contact_types` makes the form show the "Falta configuración →
  preferencias" state (correct behavior, but it means unusable until seeded). Dev hit this on
  2026-07-20 (migration applied, seed not re-run → empty `eventTypes`/`contactTypes` while
  `serviceStatuses` were already populated from an older seed run). The seed is idempotent (upserts;
  `app_preferences` is create-only so it never clobbers admin edits) — safe to re-run anytime.
  **Staging/prod: after the Epic-2 migration deploys, run `pnpm db:seed` against that DB once**
  (same as the Repartidor rename was seeded). Login/register already require this on any fresh DB
  (`user_roles`/`token_types`); order creation now does too (`event_types`/`contact_types`).
- ✅ **R2 ↔ DB orphan reconcile script — BUILT (2026-07-15)**: `ozari-api/scripts/reconcile-product-images.ts`,
  run locally with `pnpm reconcile:images` (report-only dry run; `-- --fix` applies; `--grace-hours=N`
  widens the 24h in-flight-upload safety window). English-only local telemetry; NEVER deployed (lives
  outside `src/`, excluded from `tsconfig.build.json` and the Docker runner image; only its env
  secrets are sensitive, the code is fine in the public repo). Reports BOTH orphan kinds; `--fix`
  deletes aged orphan objects (batched `DeleteObjects`) and broken rows (ONE transaction with
  in-transaction re-verification). Exit codes: 0 clean/fixed · 1 dry-run findings · 2 errors.
  Verified against dev (13 rows ↔ 13 objects, CLEAN). Run before the production cutover and
  periodically after.
- The delete/edit flows' post-commit R2 deletes are live (RECONCILE design), so the diff should
  normally be empty — the script is the auditable proof.
- If staging catalog data is migrated to production at MVP: `pg_dump` the product tables +
  bucket-to-bucket object copy + remap `R2_PUBLIC_URL` hosts — then run the reconcile script on
  prod as the post-migration check.
- **Custom domain BEFORE real mobile users (session-critical — a production-cutover GATE, not a
  nice-to-have).** Deployed FE (`ozari-c28.pages.dev`) and API (Cloud Run `run.app`) are different
  registrable domains, so the 30-day refresh cookie is a **third-party cookie** there — Safari/iOS
  (all WebKit) and Firefox/Brave strict modes block it: sessions on those browsers die when the
  15-min access token expires and can never silently rehydrate. Desktop Chrome currently tolerates
  it — do NOT ship mobile-facing MVP without this. (The 2026-07-16 refresh-reuse GRACE window fixed
  the other session killer — the lost-rotation-response nuke.) **Cutover checklist** — serve both
  under `partyrentalsgt.com` subdomains (first-party, same-site everywhere):
  1. FE: add `app.partyrentalsgt.com` as the Cloudflare Pages custom domain.
  2. API: put `api.partyrentalsgt.com` in front of Cloud Run. Check first whether Cloud Run
     **domain mapping** is available in `northamerica-south1` (it's region-limited); if not, the
     fallbacks are a global external HTTPS LB (~$18/mo) or a Cloudflare-proxied Worker/origin-rule
     — decide by cost at cutover.
  3. Config sweep, all in the same change: `APP_HOST` (Terraform `_APP_HOST` substitution +
     `cloud-run.tf`, no trailing slash — CORS + API-key origin check compare it to `Origin`),
     Cloudflare Pages `VITE_API_URL`, and `appConfig.email.logoUrl` (the welcome/security emails
     point at the FE origin for the logo PNG).
  4. Optional hardening once same-site: the refresh cookie no longer needs `SameSite=None` —
     tighten to `Lax`.
  5. **Acceptance test (the actual gate): a real iPhone/Safari.** Log in → background or close the
     tab for >15 min (access token expired) → reopen: the panel must silently rehydrate with NO
     login screen. Repeat once in Firefox with Enhanced Tracking Protection strict. If either
     bounces to login, the cookie is still being treated as third-party — do not cut over.
- **Orders epic — availability follow-ups.** The projection derives `available` (fleet minus units
  on active rentals — `buildRentedNowWhere` in `products.service.ts` is the business rule: DELIVERED
  holds unconditionally, PENDING holds inside its event window, CANCELLED/COLLECTED free). The old
  `inStock` list filter was REMOVED in favour of `sort` (owner decision, 2026-07-15 — availability
  means different things per role). When orders land: (1) order-time validation must run the same
  rented-now rule against the **event's window**, not `now` — incl. rejecting a Client buying a
  zero-stock Venta product (Clients see no stock info by design, so the backend is the only guard);
  (2) add the deferred **"Populares" sort** (aggregate `service_details` counts per product — same
  groupBy shape as rented-now, without the window).
