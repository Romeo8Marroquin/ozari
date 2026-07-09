# Epic 1 — Inventory (Products)

> **Living plan.** Check off steps as they ship; revise as we learn. The high-level, cross-epic
> compass is `ROADMAP.md`; this file is the deep plan for Epic 1. Decisions here were made with the
> product owner (2026-07) and set patterns every later module inherits.

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
| **Employee** | **Read-only** | Operate the business — orders, deliveries, availability, sell/rent — but **never create/delete/modify entities** |
| **Client** | none yet | *future portal:* view + create their own orders |

- **Focus is ADMIN now.** Employee/Client actions may legitimately be "not implemented yet" — that's
  fine, as long as their view never *breaks*.
- **Panel = staff only (Admin + Employee).** A curious Client who has a session must get a graceful
  bounce/forbidden, **never** a broken panel.
- **Product writes = Admin only. Product reads = Admin + Employee.**

### Role enforcement — a security requirement, not just UX
- **Backend:** a role middleware taking an **array of allowed roles**, where the role is **verified
  against the DB (the source of truth), not just trusted from the JWT claim** — so a changed/revoked
  role is enforced on the very next request. Deny → **`403`** (distinct from `401` not-authenticated
  and `422` bad-input). Efficient: fold the user's current `roleId` into the existing `verifyJwt` DB
  session lookup so there's **no extra query**.
- **Frontend:** role drives **what's visible** (nav tabs, action buttons, empty-state CTAs) — a **UX
  layer, NOT the security boundary.** The backend `403` is the real guard. Denial is handled
  **gracefully**: hide the control so the call never fires; if it fires anyway (poking), degrade to a
  friendly forbidden/empty state — never a jarring error.

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
- `<RoleGate roles={…}>` for conditional UI; **role-filtered** panel nav.
- **Panel route guard → Admin + Employee only**; Client → graceful redirect/forbidden.
- **`forbidden` `ErrorScreen` variant** (on-brand, friendly) + interceptor handling so a role-denied
  `403` degrades gracefully (not a jarring toast).
- **Nav refactor:** Products + Settings only; default → products; remove placeholder tabs.

### Step 2 — Products read + list
**Backend** `GET /products` (search by name; filter by category/businessType/active; pagination) +
`GET /products/:id` (detail incl. images). Read = Admin+Employee. Map `Decimal→number`; include
category/businessType/currency/details/images. Mount the route + un-comment the module. OpenAPI + tests
+ i18n.
**Frontend** `/panel/productos` list (grid), search + filters, **skeletons**, **role-aware empty
states** (admin → "Agregar producto" CTA; employee → friendly message, no CTA), graceful error
fallback. `useProducts` query.

### Step 3 — Products create / update / delete  *(Admin only)*
**Backend** `POST /products` (create + nested details), `PUT /products/:id` (update — **fix** detail
add/remove/update, not just in-place), `DELETE /products/:id` (soft-delete, cascade to details/images).
Mirrored validators incl. the **conditional price rule** by business type. OpenAPI + tests + i18n.
**Frontend** create/edit `Modal` + RHF + mirrored Zod, conditional pricing UI, details sub-editor,
seeded-lookup selects (business type / category / currency / rent unit), soft-delete confirm. Write
actions **hidden for non-admins** (backend `403` as defense-in-depth). Cache invalidation + `toFormError`
(concern-#4).

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

## 4. Definition of done
Admin fully manages inventory (CRUD + multi-image gallery + stock + pricing) from `/panel/productos`;
employee sees a clean read-only view; a client is gracefully kept out of the panel; **every** endpoint
is role-gated + documented; both packages green at 100%; the nav shows only built modules with products
as the default landing.
