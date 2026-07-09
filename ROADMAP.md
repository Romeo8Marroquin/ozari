# Ozari — Product Roadmap (post-auth)

The build plan for the business features, now that the **auth flow is complete**. This is the
step-by-step to execute across sessions. Each **step** is sized to be a self-contained unit of work
(one focused session), and every step must clear the project's standing bar (§0).

> **Context.** The rentals domain is **already fully modeled** in `ozari-api/prisma/schema.prisma`
> and the reference data is **already seeded** (`prisma/seed.ts`). We are building the API + panel UI
> over an existing data model, not designing it. See the memory note *ozari-business-domain* for the
> domain map.

---

## 0. Standing bar (every step honors these)

- **Backend layering:** `*.route.ts` → `*.validator.ts` (Zod) → `*.controller.ts` → Prisma; `*.models.ts`
  for types. Responses only via `sendOzariSuccess`/`sendOzariError`. All strings through `i18next.t`
  (`src/locales/es-GT/translation.json`).
- **Mirrored validation:** backend Zod (`validators.ts`/module validators) and frontend Zod
  (`utils/formFields.ts`/module schemas) must accept/reject identical values, changed in the same commit.
- **Role gating:** `verifyJwt` + `isGrantedRoles([...])`. **Admin does everything; Employee does the
  business operations (inventory, orders, availability, deliveries); Client is view/request only and is
  NOT in scope until a client portal epic.**
- **Docs + tests in the same commit as the endpoint:** add the path to `openapi.paths.ts`
  (+ schemas in `openapi.components.ts`) **and** its operation id to `openapi.test.ts`'s
  `EXPECTED_OPERATIONS`, or the suite fails. Both packages are at **enforced 100% coverage**.
- **Green gate:** `pnpm test` + `pnpm type-check` (`tsc -b` on the app) + `pnpm lint` clean on both
  packages before a step is "done".
- **When products stops being WIP:** remove its "work-in-progress" note from `CLAUDE.md` and mount the
  route in `app.ts`.

---

## 1. Answers to the open design questions (decided)

**Roles — no DB change needed.** `RolesEnum { Client=1, Admin=2, Employee=3 }` already exists **and is
seeded** (`seed.ts` → `Cliente`/`Administrador`/`Empleado`). So:
- **Admin** (role 2) — full access to everything.
- **Employee** (role 3) — the business operations: inventory management, creating/confirming rentals
  (which reserves availability for the delivery→pickup window **without** changing a product's total
  `quantity`), deliveries, availability.
- **Client** (role 1) — created by register today, but **no client portal yet**; not gated into any
  panel feature in this roadmap.
- **Promotion to Admin stays a manual DB operation** (the API never grants Admin) — fine for the
  current single-admin reality; a proper "manage employees/roles" screen is a later epic when growth
  needs it.

**Reference data — already seeded, nothing to ask the owner for now.** `seed.ts` already provides,
with sensible Guatemala values (all editable later, and the plan is to add admin CRUD for them in a
later step, not Epic 1):
- `product_business_type`: **Alquiler** (rent) / **Venta** (sell).
- `product_category`: Mesas, Sillas, Mobiliario, Mantelería, Accesorios, Decoración, Otros.
- `product_detail_types`: Color, Material, Dimensiones, Capacidad, Peso.
- `currency`: GTQ (Q). `service_status`: Pendiente/Cancelado/Entregado/Recolectado.
  `payment_status`: Pendiente/Pagado/Reembolsado. `user_phone_types`, and the Guatemala geo chain
  (Country→Department→Municipality→Zones 1–16).
- **Admin-managed reference data** (categories/types) is deferred to **Epic 1.5 / a later "settings"
  slice** — the seed is enough to build and ship inventory now.

**Images — Cloudflare R2 via presigned uploads (recommended).** R2 is S3-compatible, so the backend
uses **`@aws-sdk/client-s3`**. The clean, secure design (respects the app's 10 kB body cap — image
bytes never flow through Cloud Run):
1. Frontend asks the API for a short-lived **presigned PUT URL** (API authorizes + validates
   content-type/size intent).
2. Frontend uploads the file **directly to R2** using that URL.
3. Frontend saves the resulting **public URL** on the product (`Product.imageUrl`).
4. On image replace/delete, the API calls R2 `DeleteObject` with credentials.
- **Reads are public** (bucket public URL / custom domain) — no credentials, no private data there.
- **Envs** (implemented; see `DEPLOYMENT.md` §3b): plain — `R2_ENDPOINT`, `R2_BUCKET_NAME`,
  `R2_PUBLIC_URL`; secret — `R2_ACCESS_KEY` (→ `ozari-r2-access-key`), `R2_SECRET_KEY`
  (→ `ozari-r2-secret-key`). `R2_TOKEN` is **not used** by the S3 SDK. **Frontend needs no R2 creds**
  (it uses the presigned URL + the public read URL). Backend integration (SDK + `src/helpers/storage.ts`
  + `appConfig.storage` + tests) is **done**; only the Epic 1 product UI/endpoint remains.

---

## 2. Epic sequence (dependency-ordered)

| # | Epic | Why here | Depends on |
|---|---|---|---|
| **1** | **Inventory (Products)** | The catalog + stock everything references. WIP module already scaffolded. | — |
| 2 | **Clients** | Manage the people orders are for (users + phones + addresses). | 1 |
| 3 | **Orders / Events (Services)** | The core transaction: client rents products for a time window to an address. | 1, 2 |
| 4 | **Availability engine** | Derived automations: is a date free? next event? enough stock? units available now/over a window? | 3 |
| 5 | **Delivery calendar + automations** | Sync Services to the (single) delivery calendar; reminders. | 3, 4 |

Availability (§4) and the calendar (§5) **cannot come earlier** — they read from orders, and orders
need inventory. We can enrich Admin-MVP tooling within each epic as needed.

---

## 3. EPIC 1 — Inventory (Products) — detailed steps

The WIP module exists (`src/modules/products/`: controller/validator/models/route all commented out;
route not mounted). Steps below take it to production quality + build the panel. Read = Admin+Employee;
write = Admin+Employee (both operate the business).

### Backend

- [ ] **1.1 — Products read + list API.**
  Un-WIP `getAllProducts` to the standing bar; add **search + filter + pagination** (by name,
  `categoryId`, `businessTypeId`, active). Mount `GET /products` (authenticated tier) in `app.ts`.
  Response maps `Decimal → number`, includes category/businessType/currency/details names. Validator
  for the query params. OpenAPI + `EXPECTED_OPERATIONS`. i18n keys. Tests (mirror the auth controller
  test style with mocked Prisma).

- [ ] **1.2 — Products create / update / soft-delete API.**
  `POST /products` (create, incl. nested `productDetails`), `PUT /products/:id` (update; **fix the
  detail sync** so details can be added/removed/updated, not only updated-in-place), `DELETE
  /products/:id` (soft delete → `isActive=false` cascading to its details). Admin+Employee gated.
  Mirrored validators (compose shared field helpers; prices are `Decimal(15,2)`, `quantity` is total
  units owned). OpenAPI + `EXPECTED_OPERATIONS` + components. i18n. Tests (success + validation + not-
  found + conflict paths).

- [ ] **1.3 — R2 asset service + presigned-upload endpoint.**
  Add `@aws-sdk/client-s3`. A small `assets` helper/module: `POST /assets/upload-url` → presigned PUT
  URL (auth'd, validates content-type/size, namespaced key e.g. `products/<uuid>.<ext>`), and a
  server-side `deleteAsset(key)` used when a product image is replaced/removed. Config in
  `appConfig` + env reads (§R2). OpenAPI + tests. **No secrets in the repo.**

### Frontend (`/panel/productos`)

- [ ] **1.4 — Products list panel.**
  Replace the placeholder route with a real inventory view (table/grid), search + filter, loading
  **skeletons**, empty state — all in the design system (radius/motion tokens, notifications). A
  `useProducts` React Query hook. Role-aware (Admin+Employee).

- [ ] **1.5 — Product create/edit modal + form.**
  `Modal` + RHF + **mirrored Zod** (`SchemaProduct`), the concern-#4 error pattern
  (`skipErrorNotification` + `toFormError`), a product-details sub-editor, business-type/category/
  currency selects (seeded lookups via a `useProductRefData` query), create/edit/deactivate with
  cache invalidation + success toasts. 100% coverage.

- [ ] **1.6 — Image upload UI.**
  A reusable image-upload control: request the presigned URL (1.3), upload directly to R2, preview,
  store the returned public URL on the product; handle replace/remove. Wire into the product form.
  100% coverage (mock the upload).

**Epic 1 exit criteria:** products route mounted + un-WIP'd in `CLAUDE.md`; Admin/Employee can fully
manage inventory incl. images; OpenAPI documents every products/assets endpoint; both suites green at
100%; `DEPLOYMENT.md` R2 section done.

---

## 4. Epics 2–5 — outlines (detailed when we reach them)

- **Epic 2 — Clients.** Admin/Employee manage `User` (Client) records + `UserPhone`s + `Address`es
  (geo selects from the seeded chain, `domicilePrice`/`deliveryTimeMinutes`, encrypted PII via the
  existing `encryptKms` helpers). List/search/create/edit/deactivate panel; reuse Epic 1 patterns.

- **Epic 3 — Orders / Events (Services).** Create a rental: pick client + address + phone, set the
  **time window** (`serviceStart`/`serviceEnd`), add line items (`ServiceDetail` = product × qty ×
  price) + `ServiceExtra`s, statuses (`ServiceStatus`/`PaymentStatus`), totals, invoice number.
  Backend must **check availability at create/confirm time** (see §4-Epic4) inside the transaction.
  This is the heart of the tool.

- **Epic 4 — Availability engine.** Read models over Products + active Services:
  `available(product, [start,end]) = quantity − Σ(overlapping ServiceDetail.quantity)`; "next event"
  (nearest future `serviceStart`); "enough for this order?"; per-item availability now / over a window.
  Surfaced as API queries + panel views (an availability calendar/checker). Confirming a rental
  reserves stock for its window **without** touching `Product.quantity`.

- **Epic 5 — Delivery calendar + automations.** Push confirmed Services to the single delivery
  calendar (e.g. Google Calendar), reminders/notifications, delivery/pickup scheduling. Builds on the
  order + availability data.

---

## 5. Cross-cutting infra picked up along the way

- **Cloudflare R2** (Epic 1.3/1.6) — bucket + envs + deploy sequence: **see `DEPLOYMENT.md` → "Object
  storage (Cloudflare R2)"**.
- **Admin-managed reference data** (categories/types) — a small later "settings" slice once inventory
  and orders are live.
- **Employee/role management UI** — deferred until the business grows past a single admin; promotion
  stays a manual DB op for now.
