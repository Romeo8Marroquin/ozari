# EPIC 2 — Orders, Availability & Logistics

> **Status: EPIC-2A DONE (2026-07-16); orders themselves not started.** Epic 1 (products CRUD) is
> COMPLETE. This file is the single source of truth for what comes next: owner decisions are marked
> ✅, still-open questions live in §9. Future sessions: read this FIRST. The §3 driver refactor is
> implemented (branch `feat/rems`); **all schema-blocking questions (Q-D/Q-A/Q-E) were resolved
> 2026-07-16 (§9)** — only Q-B (comms) and Q-C (dashboard window) remain, neither blocks the
> schema. The §4 schema is AUTHORED + applied. **Step 2 (orders READ slice) is DONE (2026-07-16)**:
> `modules/orders/` mounts `GET /orders` (paginated, **`view=agenda|history`** — history ⇔
> `readyAt` set OR cancelled, agenda sorts soonest-first / history newest-first, optional
> `statusId` filter, clamp-never-reject), `GET /orders/:id` (full detail: decrypted snapshots,
> money breakdown, lines with `isRental`, extras, status audit trail; 404 on bad/unknown id) and
> `GET /orders/catalog` (eventTypes+minLeadHours, statuses, paymentStatuses, contactTypes, zones) —
> all **Admin-only** (widen ONLY together with Client/Driver row-scoping), authenticated rate tier,
> OpenAPI + i18n + tests same-commit. Pagination is **congruent at 20 per page across products AND
> orders** (owner, 2026-07-16 — `PRODUCTS_PAGE_SIZE`, `defaultProductPageSize`,
> `defaultOrderPageSize`). **The frontend agenda is BUILT (2026-07-16)**:
> `ozari-app/src/modules/panel/orders/` + the Admin-only `/panel/pedidos` route + sidebar tab
> (`ORDERS_ROLES` in navConfig, same single-source pattern as products; other roles bounce to
> `panelHomeFor(role)`). Day-grouped ticket list (Hoy/Mañana/Ayer/dated headers via
> `orderDayGroups.ts`), an accessible **tablist segmented control** (Agenda/Historial, roving
> tabindex + arrow keys, URL-held `?view=historial`), per-view empty states, cold-error retry
> panel, infinite scroll with append shimmer + `.order-appended` stagger, skeleton
> sweep-out→body-stagger-in resolve, panel motion pair registered. Tickets are deliberately
> **non-interactive** until the detail page lands. **The WRITE slice is BUILT (2026-07-16)**:
> `GET`/`POST /client-registries` (new `modules/clientRegistries/` — walk-in clients, encrypted
> PII, ≥1 contact/address with exactly one principal/favorite, defaulted to the first) and
> **`POST /orders`** — **STRICTLY Admin** (owner rule: no employee role ever inherits creation; a
> future call-center role widens the guard only via a deliberate owner-approved commit). Identity =
> `clientRegistryId` only for now — the platform-user `userId` variant is a documented door in the
> SAME endpoint/model, never a second endpoint. Delivery snapshots arrive as TEXT (the form
> prefills from the registry, or the admin types a one-off venue). Pricing is 100% server-side
> (`priceOrderLine`: Día × billed days, Evento flat; Hora/Semana/Mes = a clean 400
> `unsupportedRentTimeUnit` until the billing engine grows — never silent wrong billing). ONE
> `$transaction`: `SELECT … FOR UPDATE` product locks → window availability
> (`buildRentedInWindowWhere` — PENDING by overlap, DELIVERED/EN_ROUTE unconditional) → sale-stock
> decrement → the spacing rule read from `app_preferences` → create as PENDING + the first
> status-history row. Stock conflicts are a structured **409** (`data.conflicts` — the error
> envelope gained an optional `data` field); spacing conflicts 409 too (phantom-insert race on
> spacing accepted + documented; the product locks serialize the real stock race). **The admin
> order-create FRONTEND is BUILT (2026-07-20)**: `/panel/pedidos/nuevo` (`OrderCreatePage` +
> `OrderForm`, Admin-gated route + a "Nuevo pedido" button on the agenda). Flow: **mode fork**
> (`OrderModeSelect` radiogroup — filters the product picker + drives pickup visibility) → **client
> picker** with an inline **`ClientRegistryModal`** (v1 = ONE contact + ONE address, multi is a
> documented fast-follow; seeds the picker cache + prefills the delivery snapshots) → **event +
> window** (pickup shows only when a rental line exists) → **lines** (mode-filtered, dedup) →
> **delivery snapshot** (prefilled, editable) → **money** with a **live estimate** (`orderEstimate.ts`
> mirrors the backend `priceOrderLine` — labelled an estimate; backend total authoritative). A stock
> **409 maps `data.conflicts` back onto each line's quantity field** with the real count; 400 →
> banner; ambient → toast. Mirrored Zod (`SchemaCreateOrder`/`SchemaCreateRegistry`) + hooks. Also
> fixed: the agenda's lateral view-swap carries through first load / refresh (body enters from the
> side, chrome keeps the app-wide rise). **Next**: the **order DETAIL page** (tickets become links;
> tracking-stepper hero), then the tracking flow + driver "Mis entregas" + the dashboard.
> Update this file as things land.
>
> **CLIENT-REGISTRY + ZONES + PAYMENTS slice DONE (2026-07-23; migration
> `20260723000000_epic2_zone_fee_payment_methods` — additive/nullable, must be APPLIED +
> re-seeded per env before use):** (1) all **22 Guatemala City zones** seeded (numbers 1–25 except
> 20/22/23; ids 1–9 preserved, 10–22 appended) with a nullable per-zone **`deliveryFee`** (NULL = not
> configured; the zone drives the order form's fee suggestion, a per-address `domicilePrice`
> overrides). (2) A seeded **`payment_methods`** lookup (Efectivo/Transferencia; card door open) —
> `services.paymentMethodId?` snapshots the order's method (nullable, settle-later), and
> `client_registries.preferredPaymentMethodId?` is the client default. `GET /orders/catalog` now
> returns `paymentMethods` + zones-with-`deliveryFee`; `POST /orders` accepts an optional
> `paymentMethodId`; the detail projection exposes `paymentMethod`. (3) Registries went **multi**:
> **≥1 contact** (one principal) + **0..many addresses** (one favorite; a walk-in may have none and
> type the venue per order) + an optional preferred method — the modal is now field-array rows with
> principal/favorite radios; the validator relaxed addresses to 0..MAX. (4) The order form:
> **receiver name defaults to the client name**, the favorite address's zone fee **autofills the
> delivery fee**, the preferred method **pre-selects the payment select**, and **saved-data quick-fill
> pickers** (derived value — no convergent effect) let the admin swap to another saved contact/address.
> OpenAPI + i18n + tests same-commit; both suites green at 100% coverage. Per-address **instructions**
> stay a documented fast-follow (the modal collects zone + address text only). The **searchable
> combobox (§10.A)** remains unbuilt.
>
> **MODE-FORK REMOVED + LIVE AVAILABILITY DONE (2026-07-23):** (1) the **rent/sell/both fork
> (`OrderModeSelect`) is GONE** — the order's kind is DERIVED from the picked products (any rental
> line ⇒ a pickup is required, else purchase-only). Both dates show ALWAYS (no abrupt toggle); pickup
> is required only with a rental and simply not sent otherwise (Q-A now handled at submit, not via an
> upfront fork). The picker offers ALL products. (2) The **`§10.D` live availability annotation is
> BUILT**: new **`POST /orders/availability`** (Admin-only; per-window per-product takeable amount —
> rentals = fleet minus held-in-window via `buildRentedInWindowWhere`, `null` until a pickup exists;
> sales = stock; exact counts for the admin, a future Client tier caps instead per §11.A) + the
> order form's debounced fetch on window change: it **annotates the picker** with amounts and
> **reconciles picked lines** with the owner-chosen **adjust-to-available + notify** rule (reduce to
> what's takeable, remove when none, toast the summary; lines with unknown availability untouched).
> Still ADVISORY — the create path re-checks under the product lock (the 409 stays the real guard).
> The delivery-fee hint is now generic (zone/distance), not "free in Hacienda Real". Both suites 100%.

## 1. The business, in one paragraph

Party-rentals in Guatemala City (single timezone, no DST — door open for more, unlikely). Clients
rent furniture per event. **Billing is ALWAYS per day** (flat day rate; using 2h or 24h costs the
same; exceeding 24h even by a minute bills the next day). **Logistics are per HOUR**: each order
has ONE delivery time and ONE pickup time (e.g. 1:58 PM), independent of the billed days. The
owner (admin) currently delivers everything himself with a small vehicle; employees are (for now)
exclusively **drivers**.

## 2. Owner decisions (✅ = final, 2026-07-15)

### Availability & stock
- ✅ **Confirmation freezes stock.** No reservations, no expiry, no pre-steps: the moment an order
  is confirmed (by client or by admin on a client's behalf), that stock is assigned. Editing or
  cancelling releases it.
- ✅ **NO overbooking, not even the admin.** The system exists to prevent conflicts; only the DBA
  can override in the database. Never build an admin bypass.
- ✅ **Stock returns via an EXPLICIT "listo" step**, not a timer: after pickup the items are
  cleaned, then someone presses "ready". Standard turnaround ~2h — after 2h the admin gets a
  (configurable) reminder every hour until pressed. No auto-available.
- ✅ ONE delivery window + ONE pickup window per order (never per line). A client needing different
  windows makes another order (or the admin edits, conflict-free).

### The travel-spacing rule (MVP logistics)
- ✅ **Minimum 1 HOUR between any two logistics events** (any delivery/pickup vs any other),
  globally — the single-vehicle simplification. The system must REJECT (client) / BLOCK (admin
  too) any delivery/pickup time closer than 1h to another confirmed order's events.
- ✅ Future (doors open, NOT MVP): multiple vehicles + capacities + load left after each stop +
  route optimization + time slots (franjas). Model logistics events as first-class rows so a
  vehicle/route layer can attach later WITHOUT reshaping orders.

### Order lifecycle
- ✅ **Tracking steps**: `LISTO → EN RUTA → ENTREGADO → RECOLECTADO → LISTO` (available again).
  Every advance is an explicit confirmation tap. **Photo evidence at ENTREGADO and RECOLECTADO**
  (gallery uploads OK — quality over forced camera; generous but capped count; reuse the R2
  presign machinery). No sanitization step in-flow (cleaning happens during RECOLECTADO; the final
  "listo" press ends it).
- 📎 **Status vocabulary — analysis (2026-07-27), NO schema change needed.** The order statuses are a
  **fixed LIFECYCLE, not a free lookup.** `service_status` is a seeded table
  (`Pendiente`/`Cancelado`/`Entregado`/`Recolectado`/`En ruta`) but the transitions + inventory
  meaning are **code**: `ServiceStatusEnum` hardcodes the ids and the engine keys off them
  (`buildRentedNowWhere` counts DELIVERED/EN_ROUTE as holding, `nextStepKey`/`computeNextActionAt`/the
  ticket tones map ids). So the admin **cannot** freely add/remove/reorder statuses — that's a state
  machine, and letting it drift would silently break availability + tracking. What a **future
  preferences UI CAN safely own** without a schema change: the **display name** (and tone) of each
  seeded status — the lookup row's `name` is already editable in the DB, so "rename *Pendiente* →
  *Confirmado*" is a pure presentation edit (the frontend already tolerates unknown ids with a neutral
  chip tone). Adding a genuinely NEW lifecycle state (e.g. an "En preparación" between Pendiente and En
  ruta) is a **code change** (enum + transition + holding rules), not config — and correctly so. **Bottom
  line:** keep it hardcoded now; expose *names/tones* as editable preferences later; no `service_status`
  reshape is warranted.
- 🔁 **SUPERSEDED (2026-07-27) — owner chose the FULL data-driven engine.** The analysis above is kept
  for context, but the owner decided to build the lifecycle as a **data-driven, admin-managed state
  machine** (capability flags on `service_status`: `sortOrder`/`isInitial`/`isDisruptive`/
  `holdsInventory`/`requiresEvidence`/`appliesTo`/`colorKey`; a linear pipeline + disruptive off-ramps
  like Cancelado; one reusable transition engine for future client/driver/auto-assign flows). The
  COMPLETE architecture + phased implementation plan lives in **`EPIC-2-ORDER-LIFECYCLE.md`** (repo
  root) — that doc is the single source of truth for this work; start there.
- ✅ **Only the ADMIN can move a step BACKWARD** (any order). Drivers only ADVANCE their ASSIGNED
  orders. Clients only VIEW their own order.
- ✅ **CANCELLED** can happen at any step by the admin (even en route); by the client only within
  their edit window.
- ✅ **Payment is an order STATE, not a step**: it can happen at any moment. Support **anticipo**
  (partial deposit, amount recorded) → "pagado" flag when complete (total is known). Not the
  usual case but must be recordable.
- ✅ **Event types are a parameterizable lookup** (the purpose of the rental). Each type carries a
  **min-lead-time in hours** (default 24): clients can CREATE orders only if delivery is at least
  that far away, and can EDIT/CANCEL only until that many hours before delivery. Admin: NO lead-time
  restriction — only conflict restrictions (stock + 1h spacing) **plus the ONE date guard below**.
  - ✅ **Delivery not in the PAST (create) — IMPLEMENTED (2026-07-27).** The admin has no lead-time,
    but a delivery can never be scheduled before now. Enforced on both pickers/validators: the frontend
    delivery `<input datetime-local>` gets `min={nowDateTimeLocal()}`, the mirrored Zod adds a
    not-in-past refine (`deliveryInPast`), and the backend `validateCreateOrder` rejects a past delivery
    with a `deliveryInPast` 400. A small **2-minute grace** (`DELIVERY_PAST_GRACE_MS`, mirrored both
    sides) absorbs the minute-granular picker + fill/submit latency so choosing "now" still saves. The
    **pickup inherits "not in the past" for free** — it's already constrained to be after the delivery.
    The future CLIENT flow layers the event-type `minLeadHours` on top of this same guard.
- ✅ **Assignment**: MVP = admin assigns orders to a driver manually (the admin is also a driver).
  Auto-assignment (vehicles/capacity/feasibility) is a future door.
  - ✅ **CREATE-TIME assignment is IMPLEMENTED (2026-07-27).** `POST /orders` accepts an optional
    `assignedUserId`; the create form's **"Asignar a"** select (in the delivery section) defaults to
    the **creating admin** (the token's `userId`), so an order made here is **never unassigned** (its
    creator's own orders then read as `isMine` → *Mis pedidos* + the quick action). The options are the
    **deliverable staff** exposed by `GET /orders/catalog` → `assignableUsers` (active users whose role
    is in **`ASSIGNABLE_ROLES`** = `[Admin, Driver]`, `orders.service.ts` — the SINGLE source: widen it
    to open assignment to a new delivering role everywhere at once). The validator accepts the field as
    optional (must be an active deliverable user when present) and the controller defaults it to the
    creator. **Re-assigning an EXISTING order** (a dedicated action / the detail page) is the next
    assignment slice; the frontend `assignedUserId` is a required-with-self-default mirror (stricter
    than the API on purpose).

### Pricing (product model change)
- ✅ The billing unit is **Día by default and in practice** — the immovable norm — but HOURLY must
  stay a live door, not a stone: keep `rentTimeUnit` fully functional (day-by-default UX; hour
  remains selectable per product). The products form's pricing section copy/behavior gets
  revisited accordingly (small Epic-1 touch-up, do it inside Epic 2).
- ✅ Billed days derive from the delivery→pickup window: `< 24h` = 1 day, then one more day per
  started 24h block (pickup time decides).
- ✅ **Custom discounts are admin-only and occasional** (recurrent clients, birthdays — relationship
  management; maybe coupons someday). NOT MVP, but the DB must not make them painful later: plan a
  nullable order-level `discountAmount`+`discountReason` (or an adjustments row) when orders land —
  decide the cheapest shape at migration time, never a redesign. (Taken as the two nullable columns
  in the 2026-07-16 schema.)
- ✅ **Delivery fee (envío) is charged separately, per order** (owner, 2026-07-16): distance-based,
  **admin-determined for now** — free inside Hacienda Real (the owner's village), the rest by how
  far it is. `services.deliveryAmount` snapshots what was actually charged; registry addresses
  carry a suggested `domicilePrice`; per-zone/distance automation is a future door, not MVP.

### Preferences — the parametrization architecture (✅ owner direction)
Everything currently "a constant" is really an **admin preference**: the 1h spacing, the 2h
turnaround + hourly reminder, the ±30min calendar padding, the default 24h lead (per event type),
whether tracking steps REQUIRE photo evidence (and how many), whether step advances are
tap-confirmed vs time-automatic, notification cadence (per-day/week/per-delivery-1h-before), and
the default billing unit. MVP: an `app_preferences` storage (typed key-value table, seeded
defaults; grouped as product-prefs / order-prefs / notification-prefs) that the CODE reads —
the admin SETTINGS UI for them can come later, but the values must never be hardcoded in more
than one place. New "requestables" (beyond photos) attach here too.

### Roles — the big correction (see §3)
- ✅ Employees are **DRIVERS** ("repartidor"): they must NOT see products at all, must NOT
  create/edit/delete orders — only view + advance the tracking of orders ASSIGNED to them, and
  manage their own profile settings. More employee types may exist later (cleaners, office) —
  permissions must be array-based front + back (they already are), don't close doors.
- ✅ The admin manages roles/users EXCEPT granting admin (DBA-only, already the rule).
- ✅ Order creation entry points: the CLIENT's own order form, and the ADMIN (for anyone — the
  WhatsApp/phone people; needs an admin flow for orders on behalf of persons, walk-ins door §9).
  The current product-detail "Ordenar" (employee/admin) action disappears with this model.

### Admin dashboard UX
- ✅ First: the **next actionable step** across tracked orders (nearest highlighted big, ~2 more
  visible but quieter). Then a **week calendar** of deliveries/pickups (navigable forward a
  limited amount; the FULL planning view lives on its own page). Delivery agenda is the heart —
  near-term urgency first, upcoming next. (Exact week-window shape: designer's call, see Q-3.)

### Documents & communication
- ✅ NOW: **recibos + cotizaciones** (receipts/quotes) as generated PDFs. NO FEL (electronic
  invoicing) yet — but architect so FEL can attach later (keep money fields clean, order totals
  authoritative, invoice number field already exists).
- ✅ Calendar: delivery/pickup events, **±30min padding** per event by default (back-to-back thus
  shows the 1h gap). Ideally connect each admin/driver's OWN calendar; MVP realism: `.ics`
  (no OAuth). **Notifications must be cheap-to-free, non-invasive, and admin-configurable**
  (per-day digest / per-week / per-delivery 1h-before) — parameters managed in an admin settings
  area.

## 3. EPIC-2A — the Driver refactor (✅ DONE, 2026-07-16)

**Implemented in one focused session, exactly as planned below.** It corrects Epic-1 surface that
assumed "Employee sees products". Implementation notes beyond the plan: the seed renames role 3 to
"Repartidor" in place (idempotent upsert — re-run `pnpm db:seed` per environment; staging gets it
on the next seed run); `/auth/me` now returns `role: "Driver"` (the enum NAME follows the rename);
frontend guards live in the route files (`productos.tsx` bounces non-[Admin,Client] to
`/panel/ajustes`; bare `/panel` lands via `panelHomeFor(role)` — both derived from
`PRODUCTS_ROLES`/`PANEL_NAV` in `navConfig.ts` so guards and sidebar can never disagree); the
"Ordenar" action was removed for ADMIN too (per §2 — the admin's order-on-behalf flow will be a
dedicated order form, so product cards are Client-CTA-only and the card of an Admin has no action);
the `available`-without-`total` stock-chip render path was KEPT (it serves Admin-on-Venta), only
its Employee framing died. The original plan, for the record:

1. **Naming/semantics**: role id 3 stops being generic "Employee" and becomes **Driver**
   (seed name e.g. "Repartidor"). Update `RolesEnum` (backend), `Role`/`Roles` constants +
   labels (frontend), seed, and every test fixture that used Employee semantics.
2. **Backend**: products reads (`GET /products`, `/products/:id`, `/products/catalog`) become
   `isGrantedRoles([Admin, Client])` — drivers get 403. DELETE the Employee branch from
   `projectProductForRole` (the `inStock`/`available`-for-Employee tier) and its tests/OpenAPI
   notes. Grep targets: `RolesEnum.Employee`, `Employee`, `projectProductForRole`, openapi
   descriptions mentioning Employee.
3. **Frontend**: `PANEL_NAV` products item gets `roles: [Admin, Client]`; driver's nav = (future)
   "Mis entregas" + Ajustes. Panel catch-all already redirects unknowns — add: a driver landing on
   `/panel/productos` redirects like any non-permitted page (extend the route guards the same
   silent way as `nuevo`/`editar`). Remove Employee-conditioned UI: `SELL_BUSINESS_TYPE` card
   action mapping ("Ordenar" for Employee), stock chips for Employee (`available` without `total`
   render path), ProductsFilterBar availability bits if any, and related tests.
4. **Docs**: CLAUDE.md role-model section + memory `ozari-role-model.md` must be updated (the
   "Employee gets availability" owner decisions of 2026-07-14/15 are SUPERSEDED for drivers — the
   availability tier moves to Admin-only until a future office-employee type needs it).
5. Keep the DOOR: permissions stay array-shaped everywhere; adding future employee types = new
   role rows + arrays, no structural change.

## 4. Schema plan (migrations for Epic 2)

> **✅ AUTHORED (2026-07-16): migration `20260716120000_epic2_orders_schema`** (engine-written via
> `prisma migrate diff`; apply with `pnpm prisma:migrate:deploy` + re-run `pnpm db:seed` per
> environment — safe because `services` is empty everywhere, the feature never existed).
> Implementation deltas vs the plan below: a **`contact_types`** lookup was added (WhatsApp /
> Teléfono / Correo / Otro — registry contacts include email, so `user_phone_types` didn't fit);
> registry addresses have **optional `zoneId`** (walk-ins are often outside the seeded city zones)
> plus a suggested `domicilePrice`; `services` **dropped `addressId`/`userPhoneId`** for encrypted
> snapshot columns (`delivery_contact_kms`, `delivery_address_kms`, alongside the existing
> `delivery_name_kms`) and gained `deliveryAmount` (fee charged — §2 delivery-fee decision),
> `discountAmount`/`discountReason` (the §2 door, taken now), and indexes on
> deliveryAt/pickupAt/userId/clientRegistryId/assignedUserId; `service_details` gained the
> **`isRental` per-line snapshot** (a product's business type is editable later; mixed orders need
> the line to know its own math); the userId XOR clientRegistryId rule is **app-layer-enforced**
> (a CHECK constraint would require hand-editing the engine-written SQL); `app_preferences` seeds
> **create-only** (`update: {}` — re-seeding never clobbers admin-edited values). `EN_ROUTE = 5`
> was added to `ServiceStatusEnum` + seed. ⚠️ **Step-2 obligation:** `buildRentedNowWhere`
> (products.service.ts) must count EN_ROUTE as holding (like DELIVERED) in the same slice that
> starts writing it — the units are on the truck.

Original plan, for the record (author with `prisma migrate diff`, per CLAUDE.md rules):

- `event_types` lookup: name, description, `minLeadHours Int @default(24)`, isActive (publication
  flag). FK from `services`.
- `client_registries` + `client_registry_contacts` + `client_registry_addresses` (Q-D, resolved —
  full shape + deletion rule in §9): guest clients for admin-created orders. Attribute rows
  (contacts/addresses) always hard-delete; the registry row itself follows the conditional
  NO-TRASH rule (soft only when orders reference it).
- `services` additions: `eventTypeId`, `deliveryAt DateTime`, `pickupAt DateTime?` (planned, hour
  precision; **NULL = purchase-only order**, Q-A), `deliveredAt/collectedAt DateTime?` (actuals),
  `readyAt DateTime?` (stock released), `assignedUserId Int?` (the driver),
  `depositAmount Decimal?` (anticipo), `paidAt DateTime?`, `cancelledAt/cancelReason?`. Identity:
  `userId` becomes nullable + `clientRegistryId Int?` (exactly one of the two set). Snapshot
  columns (Q-D): contact name, contact detail(s) used, delivery address — plain text captured at
  order time, NEVER an FK to a mutable address row. `serviceStart/serviceEnd` become the BILLED
  period (days).
- `service_status` seed: add `EN_RUTA` (and keep PENDING? — the confirmed-on-create model may
  make PENDING unnecessary for admin-created orders but the client-request flow may still want
  it; decide with Q-1). Status transitions AUDITED: `service_status_history` (serviceId, from,
  to, byUserId, at) — cheap, answers every dispute.
- `service_evidence`: serviceId, phase (ENTREGADO|RECOLECTADO), r2Key, url, createdAt — reuse the
  product-images R2 pattern (presign, keys server-derived, batch delete, no-trash hard rows).
- `app_preferences`: typed key-value (key, value, group) seeded with the defaults in §2's
  preferences list — code reads it from day one; the admin UI can lag.
- Availability engine v2 lives on these columns: a hold = confirmed service's `deliveryAt →
  readyAt(pending ? ∞)` per line quantity; the 1h-spacing check queries `deliveryAt/pickupAt` of
  active services ±1h (the hour itself a preference). Billing math = whole days over the
  delivery→pickup window.
- **Doors that cost nothing now** (do NOT build, do not preclude): damages ("on pickup, X was
  damaged → charge replacement") fit a future adjustments/extras row per line — `service_extras`
  already exists and can host it; refunds = a future negative payment record (never happened in
  2+ years; no MVP work); discounts per §2. None of these require columns today — just don't
  denormalize totals in ways that can't absorb an adjustment later (totals recomputable from
  lines + extras).

## 5. MVP cut (smallest thing that WORKS end-to-end)

1. ✅ EPIC-2A driver refactor (done 2026-07-16).
2. Event types lookup + admin CRUD-lite (or seed-only first).
3. Admin creates/edits/cancels orders (client picker; lines with per-day pricing; delivery/pickup
   times; atomic stock + 1h-spacing validation; RECONCILE pattern for lines).
4. Tracking flow with taps + photo evidence + backward-only-admin + explicit final "listo".
5. Orders list + detail + the dashboard (next actions + week agenda).
6. Receipt/quote PDF.
7. `.ics` for delivery/pickup (±30min padding).
8. **Notifications** — PULLED INTO the MVP (owner, 2026-07-30; was on the defer line below). Scope
   stays the cheap one: the per-delivery reminder + a digest, admin-configurable cadence. **Blocked on
   Q-B** (content + who gets notified).
9. ✅ **Driver availability & the logistics pad (BUILT 2026-07-30)** — the ±30min padding of item 7 is
   the SAME object as the old spacing rule, re-framed as "each event occupies a block of its DRIVER's
   time". Built in full per **`EPIC-2-DRIVER-AVAILABILITY.md`** (read it before touching spacing,
   assignment or the availability probe): `modules/orders/logistics/` is the engine,
   `buildSpacingConflictWhere` is gone, the assignee is required, and the hole found while planning —
   an order's own delivery and collection never checked against each other — is closed (`selfOverlap`).
   The calendar half (§6 of that doc) rides with item 8.
Defer: client self-service ordering, driver assignment UI beyond a simple picker, refunds/damages
(Q-2), role-management UI, vehicles/routes/slots, FEL.

## 6. Doors that must stay open (never make these harder)

Multiple vehicles/capacities/load & route optimization; time slots; more employee types with
per-type permissions; auto-assignment; FEL invoicing; WhatsApp notifications; multi-country/TZ;
role-management UI; camera-enforced evidence; client-visible availability calendar (if ever);
**hourly billing** (rentTimeUnit stays functional); **damage/loss billing** (extras/adjustments);
**refunds** (negative payments); **admin discounts/coupons**; the **admin preferences UI** over
the seeded `app_preferences`; additional per-step "requestables" beyond photos.

> **PENDING BINDING — the `config` form state → preferences (2026-07-20).** Both the order-create and
> product-create/edit forms distinguish a real request failure (RETRY panel) from a **config** state
> (every request succeeded but seeded reference/preference data is empty — event/contact types for
> orders, categories/currencies/etc. for products). The config state renders `ProductsStatus`
> `tone="config"` with the shared **`modules/panel/PreferencesCta.tsx`** button, which for now routes
> to **Settings (`/panel/ajustes`)** as the placeholder home. **When the admin preferences UI lands
> (door above), narrow `PreferencesCta`'s target** to the relevant preferences section (per-section
> tabs or pages — owner's call) so a missing-reference-data state deep-links straight to where the
> admin fixes it. No other change needed — the state detection + panel + i18n (`configMissing.*`,
> `dataStatus.goToPreferences`) are already in place.

## 6b. FEASIBILITY AUDIT — what the logistics/availability layer can absorb without a refactor
### (owner question, 2026-07-29 — read this BEFORE touching spacing, availability or assignment)

The question asked: *"will multiple drivers, vehicles + capacity, real locations, and a configurable
washing turnaround force us to redo the orders implementation?"* The answer, function by function.

**Why the answer is mostly "no".** Both conflict rules are expressed as **pure functions returning a
Prisma `where`** over the `services` table — `buildRentedInWindowWhere` (goods) and
`buildSpacingConflictWhere` (logistics events). Neither is welded into the order shape, the
controllers, or the UI. Every future variant listed below is a change to **what those two predicates
scope over**, which is why they stay small. Keep it that way: a conflict rule that leaks into a
controller is the thing that would make this expensive.

### What is actually implemented today (verified)

| Rule | State |
|---|---|
| **Goods conflict, future events** | ✅ Real. `buildRentedInWindowWhere` counts every line whose order's status holds: `OUT` unconditionally, `WINDOW` only when `serviceStart < windowEnd && serviceEnd > windowStart`. Re-checked INSIDE the create/update transaction under `SELECT … FOR UPDATE` product locks, so two concurrent bookings can't both pass. Edit excludes the order itself. |
| **Physical-delivery conflict (the logistics pad)** | ✅ Real, and it blocks the admin too. **Rewritten 2026-07-30 as a per-DRIVER rule** (`logistics/buildDriverConflictWhere` + `refineConflicts`, EPIC-2-DRIVER-AVAILABILITY): each event occupies `[at − gap/2, at + gap/2]` of its assignee's day and two blocks may not overlap — numerically identical to the old global `buildSpacingConflictWhere`, which is GONE. Exclusive bounds (exactly the gap apart is allowed). Also covers the order's own delivery vs collection (`selfOverlap`). |
| **Spacing is parametrized** | ✅ `app_preferences.orders.logisticsSpacingMinutes` (60), read from the DB inside the transaction — never hardcoded. An admin screen can change it with zero code change. |
| **Washing turnaround** | ✅ **Wired 2026-07-29.** `orders.turnaroundMinutes` (120) now widens the hold: a held row blocks while `serviceEnd > windowStart − turnaround`, so goods are not free the instant a billed window ends. Read with the spacing rule in ONE query (`loadOrderTimingPreferences`) by create, edit, reopen AND the availability probe — the probe must answer with the same rule the save enforces. `0` is a valid setting (no cleaning step) and restores the old behaviour exactly. |
| **Per-driver anything** | ✅ **Done 2026-07-30.** The pad is scoped to `assignedUserId`, so a second driver does not block the first; the assignee is required (Q-D2), so every event has an owner. |
| **Nothing is checked for an order that reserves nothing** | ✅ **Done 2026-07-31** (EPIC-2-DRIVER-AVAILABILITY §4.5). `pendingLogisticsEvents` gives the pad the same stance the stock rules always had: an event occupies its driver from scheduling until it actually HAPPENS (its actual is stamped), or never if the order was cancelled. Editing a cancelled or finished order is therefore pure paperwork — no goods check, no driver check, no possible `409` — and a driver's completed morning stops reserving their afternoon. The same pass fixed the probe (it never excluded the edited order from the GOODS half, so it answered a stricter question than the save) and the form (which kept capping after the server had stopped). |
| **Vehicles / capacity / geo** | ❌ Not modelled at all. |

### The turnaround gap (found + CLOSED, 2026-07-29)

Today's status flags handle the *live* case correctly — a collected order sits in `Recolectado`
(`inventoryHold: OUT`) and keeps holding its units until someone presses **Listo**, so nothing can be
promised out from under the washing. But that is a rule about the *current* status, while
availability for a FUTURE window was answered by the billed overlap alone. So:

> An order billed to Saturday 18:00 and a new request for Saturday 20:00 **both passed** — the units
> were counted free the minute the first billing window ended, with no washing gap.

Fixed by widening the `WINDOW` branch, exactly as predicted — one expression, no refactor. **Copy the
shape of the fix for the next rule:** the turnaround is subtracted from the REQUESTED window's start
rather than added to every held row's end. Same comparison (`heldEnd + turnaround > start` ⇔
`heldEnd > start − turnaround`), but it stays a plain column compare an index can serve instead of a
per-row computation. `loadOrderTimingPreferences` reads it with the spacing rule in ONE query, used
by create, edit, reopen **and the availability probe** — a probe answering by a different rule than
the save enforces is how a form offers units the save then refuses.

Per-product turnaround later = a nullable `products.turnaroundMinutes` overriding the global —
additive. One API note: `buildRentedInWindowWhere`'s trailing arguments are an **options object**,
because when the turnaround was first added positionally an existing call silently passed its order
id as the turnaround **and still type-checked**. Two adjacent `number` parameters is a trap.

### 6c. MAP LOCATIONS & NAVIGATION (✅ BUILT 2026-08-03)

**The rule: a pin is optional metadata on an address, and the address TEXT stays authoritative.**
Every surface must keep working without one — most walk-in orders will never have a pin, and a
feature that quietly becomes required would block order creation over a nicety.

| Question | Answer |
|---|---|
| Where does the pin live? | On the registry ADDRESS (reusable, prefills the form) **and** snapshotted on the ORDER (`services.delivery_coords_kms`) — the same doctrine as the contact/address text: editing a registry address later must never move a past order's delivery. |
| Who picks it? | The admin, in a dialog: search (Nominatim), pan the map, or paste a link/coordinates. Never a map embedded in the form — it invites fiddling instead of finishing, and on a phone it pushes the fields off screen. |
| Who navigates? | **Always an external app.** We hand Google/Waze/Apple a universal `https://` link and get out of the way; no turn-by-turn, ever. |
| Which app? | A **device-local** preference in Ajustes, available to every role (a driver sets it on their own phone) — not an admin preference, and not cleared on logout. |
| When does the button show? | When the next forward action's status declares `tracksEvent` — i.e. when somebody is actually about to drive. Derived from the lifecycle machine, so a new travel step needs no client change. |

**Dependency choice (free/permissive only, per the owner's constraint):** Leaflet (BSD-2) + OSM
tiles + Nominatim — no API key, no signup, no billing account, nothing to renew. `react-leaflet` was
**rejected**: it is Hippocratic 2.1, which is not OSI-approved and carries use restrictions;
wrapping Leaflet directly is ~60 lines and fits the GSAP/modal lifecycle better anyway. Google Maps
was rejected for requiring a billing account. The trade-off accepted: OSM's POI coverage in
Guatemala is thinner than Google's, so the flow is **search the street → drag the pin**, which
street-level OSM data serves well. Tile attribution is the LICENCE — it is rendered, not optional.

**Doors left open:** travel-time-aware spacing (EPIC-2-DRIVER-AVAILABILITY §5) now has real
coordinates to read the day it is built; a zone/geofence check could compare a pin against a zone
polygon; a client-facing "confirm your location" step reuses the same picker with a different
projection. None of them are built, and none are made harder.

### Cost of each future door (all additive unless marked)

| Door | What it touches | Verdict |
|---|---|---|
| **Multiple drivers** — spacing per driver, not globally | ✅ **BUILT** exactly as predicted: the resource id moved into the `where` and the two call sites pass `body.assignedUserId`. No model change. A composite `(assigned_user_id, delivery_at)` index is the only thing left, and only once the table is big enough to want it. |
| **Vehicles + capacity + fee multiplier** | New `vehicles` table + nullable `services.vehicleId`; spacing scopes by vehicle instead of driver (same parameter as above); capacity checked against the order's line volume — which needs a per-product volume/units field, a nullable column on `products`. | **Additive.** |
| **Real locations + travel-time-aware spacing** | `Address.coordsKms` and `ClientRegistryAddress.coordsKms` already exist; the ORDER snapshots address TEXT only, so it needs a nullable `services.delivery_coords_kms` snapshot. Spacing then becomes "gap ≥ travel time" instead of a constant — still the same predicate, with a computed bound. | **Additive.** |
| **Configurable turnaround, per-zone/per-product** | The global preference plus a nullable override column. | **Additive.** |
| **"Listo" earlier/later than the turnaround** | Already free: `Listo` is a manual step and `readyAt` is stamped when pressed. Turnaround is only ever an availability floor and a reminder, never a gate on the button. | **No change.** |
| **Per-EVENT assignment** (delivery by driver A, pickup by driver B) | ⚠️ The one real fork. Orders carry `deliveryAt`/`pickupAt` as **two columns**, not as first-class `service_logistics_events` rows (§2 anticipated rows; the MVP chose columns). Two nullable columns (`delivery_user_id`/`pickup_user_id`) absorb it cheaply; a full events table would mean migrating the agenda, spacing and sort. | **Decide before route optimization** — it is the only choice here that gets more expensive with time. |

### Where a logistics conflict surfaces (✅ ANSWERED + BUILT, 2026-07-30)

The thin payload flagged here is fixed. The `409` now carries `data.driverConflict`
(`{ orderId, at, kind, blocks, driverName, gapMinutes }`) or `data.selfOverlap` (`{ gapMinutes }`),
and the probe answers the same question live in `data.driver` before the admin ever submits.

Two rules came out of it, both load-bearing:

1. **It never reuses `data.conflicts`.** That is the STOCK shape and it lands on a line's quantity
   input. A driver conflict is about the DATES and lands on the delivery / pickup inputs — `blocks`
   says which of the two — plus the form banner. Reusing one for the other was identified as the
   single easiest way to make both confusing.
2. **The copy formats `gapMinutes`** (`gapLabelKey` → "1 hora" / "45 minutos"). The gap is an admin
   preference; copy that hardcodes an hour lies the moment they change it.

## 7. Reuse map (how it plugs into what exists)

Panel pages + transitions + scroll memory are automatic; entity forms = pages (form doctrine,
drafts for CREATE only); child collections edit via RECONCILE; R2 via presign + batch delete;
no-trash (orders are history: NEVER deleted, only cancelled — soft state, statuses + audit);
role projection single-source (`projectProductForRole` pattern → `projectServiceForRole`); i18n
es-GT both sides; OpenAPI + tests same-commit; 100% coverage.

## 8. Availability + conflict UX (admin)

On any create/edit: per-line availability for the requested window; on conflict show exactly which
lines lack stock and the counts (admin sees everything), plus nearby-day availability. The 409
conflict pattern from product updates applies (someone else confirmed first → reload, re-offer).

## 9. Resolved late + still OPEN

### Resolved (✅ 2026-07-15, second interview)
- **Client order flow (was Q-1/Q-3-visibility)**: the order STARTS by setting the window —
  delivery datetime + pickup datetime (= the paid period). Only THEN does the client see products,
  and **only those with ≥1 unit available for that exact window**; zero-availability products
  don't appear at all, and the add-to-order quantity is CAPPED at that window's availability.
  From dates + quantities a budget is computed → the client confirms + accepts terms → the order
  is created and the stock freezes (instant-confirm; no admin-approval step). This design leaks no
  fleet intelligence: a client only ever learns what's available for the window they committed to.
- **Damages/losses (was Q-2a)**: NOT recorded or billed today (informal micro-business — no NIT,
  no invoicing; cash/transfer transactions). Explicit DOOR: the "on pickup I found damage → charge
  replacement for that rented item" flow attaches later via extras/adjustments (§4).
- **Refunds (was Q-2b)**: never happened in 2+ years — zero MVP work; the door is a future
  negative-payment record, nothing more.

### Resolved (✅ 2026-07-16, third interview) — the last schema blockers

- **Q-D Walk-in identity → a reusable CLIENT REGISTRY (guest client), never a forced account.**
  The admin's order-on-behalf flow is a "quick order": pick (or create inline) a **client
  registry** — a lightweight non-platform client record. Shape:
  - `client_registries`: the **responsible person's name** (who receives updates, takes the
    delivery, hands back at pickup).
  - `client_registry_contacts`: one or MANY typed contact methods (phone / email / WhatsApp / …)
    — at least one required, never all forced.
  - `client_registry_addresses`: one or MANY delivery addresses, exactly one marked
    default/favorite (mirrors what platform-user addresses will look like).
  - **Reusable**: repeat WhatsApp/phone clients are picked from the registry list on later orders.
  - **Deletion (conditional NO-TRASH, same rule as products)**: when such a person registers a
    real account (or is just obsolete), the admin can delete the registry — the row soft-deletes
    ONLY if orders reference it; its contacts/addresses rows **hard-delete either way** (safe
    because of the snapshot rule below). No automatic registry→user linking/merge at MVP (a door).
  - **Normalized vs snapshot — DECIDED: snapshot the operational fields onto the order, keep a
    nullable reference for grouping.** `services` carries `userId?` XOR `clientRegistryId?` (who
    the order belongs to — grouping, history, "this client's past orders") **plus denormalized
    snapshot columns** of what logistics actually used: contact name, the contact detail(s) used,
    and the delivery address as plain text. Rationale: an order is an immutable historical record
    — editing an address later must never rewrite past orders; snapshotting makes address/contact
    rows **pure attribute rows** (always hard-deletable — the economy answer: one line of text per
    order costs ~nothing, while FK-referenced address rows could never be deleted and accumulate
    forever); and it's the standard e-commerce order-address-snapshot practice. The SAME rule
    applies to platform-user orders when user addresses land — snapshot at order time, always.

- **Q-A Consumables-only purchases → the order form FORKS FIRST.** Step zero of every order is the
  mode: **"¿Rentar, comprar o ambos?"** — before the dates. Purchase-only asks a **delivery time
  only** (no pickup event, no billed-days math — sell prices only; `pickupAt` is NULL); rent and
  mixed ask both (purchases inside a mixed order just skip the pickup half). Every downstream rule
  keys off which logistics events the order actually HAS: the 1h spacing applies per existing
  event; the availability window is delivery→pickup for rentals; a sale decrements sellable stock.

- **Q-E Client product-card CTAs → REMOVE the per-product buttons.** The catalog is exactly that —
  a menu/showcase (browse, see details); every order starts at the mode+window definition, so
  per-product "Rentar"/"Comprar" buttons would teach a product-first flow that doesn't exist and
  confuse the user. At most ONE **generic** entry point may be added later ("Iniciar pedido" on the
  grid/detail — generic, never per-product). The currently-disabled buttons stay inert until the
  order form lands, then get deleted (with their tests) in that same slice.

### Still OPEN (ask before building the affected slice)
- **Q-B Comms**: email content & cadence to clients (cheapest channel wins; WhatsApp is a future
  door); which events notify whom.
- **Q-C Dashboard week window**: exact shape (current week vs ±3 days vs 6 ahead) — decide by
  design feel, owner has no strong preference.

## 10. Product-selection UX & availability confidentiality (PLANNED, not built — 2026-07-20)

**Not a new epic — these are Epic-2 refinements** (they reuse the order form + backend + the client
self-service flow already deferred in §9). Recorded now so we build them intentionally when the pain
justifies it. Three layers, smallest-first:

### 10.A The line picker (near-term, small) — owner asked "dropdown w/ search, or one GET of all?"
- **Data: ONE GET of the whole active catalog is correct** at this scale. A party-rentals catalog is
  dozens, maybe ~100 items; the current `GET /products?pageSize=50` (`useOrderProducts`) is fine.
  Do NOT build server-side search/pagination for the picker unless the catalog outgrows ~a few
  hundred — premature. (If it ever does: a typeahead endpoint, not a bigger dump.)
- **UI: upgrade the per-line native `<select>` to a searchable COMBOBOX** (typeahead filter over the
  in-memory list, keyboard-navigable, ARIA `combobox`/`listbox`). This is THE best-practice fix for
  "not too many but tedious to scroll" — cheap, high-value, reuses the single GET, keeps the existing
  dedup (`optionsFor` hides already-picked products) + the max-lines cap. **Recommended first
  improvement.** (Today's native select already dedups + caps + is accessible; the combobox is a
  polish, not a correctness fix.)

### 10.B The "cart" flow (medium-term) — owner's idea for speed
- **Shape**: an admin adds products (+ qty) from the catalog grid/detail into a client-side **cart**
  (zustand or sessionStorage, per-admin-session), then "Ir al pedido" opens `/panel/pedidos/nuevo`
  **pre-filled** with those lines; the cart clears on successful create.
- **Reconcile with Q-E (no product-first flow for CLIENTS).** Q-E removed per-product CTAs for the
  CLIENT catalog to avoid teaching a product-first order flow. The cart is **ADMIN-only productivity**
  — the admin already knows the flow, so a cart doesn't "confuse"; it's a faster way to populate lines,
  not a competing entry point. So: cart = admin tool; the client catalog stays a showcase (window-first
  ordering per §9). If a generic "Iniciar pedido" ever lands on the client grid it stays generic (Q-E).
- **Availability timing (the tricky part the owner flagged).** The cart holds products BEFORE a window
  exists, so it CANNOT validate rental availability at add-time. That's fine: availability is validated
  where it always is — at order **submit**, inside the transaction (the existing structured **409 →
  per-line "solo N disponibles"** mapping). Optionally, once the admin sets the window on the pre-filled
  form, a **live availability probe** can annotate each rental line (admin is trusted — see 10.C) so the
  admin isn't surprised at submit. Sale lines never need a window (stock is stock).

### 10.C Availability confidentiality vs UX (the deep one) — REVEAL only what the actor is ordering
The owner's rule (Guatemala business norm): **never expose the fleet's full availability**, but don't
make the user blind-guess either. The resolution is an ACTOR + SCOPE split:

- **Admin (current + cart flow): reveal freely.** The admin runs the business — showing them real
  availability for a chosen window is not a leak. So a live per-line availability annotation on the
  admin form (once dates are set) is allowed and improves UX. The submit-time 409 already does this
  minimally ("solo N disponibles" for the exact products they're ordering).
- **Client self-service (future, §9): the window-first + capped-quantity contract.** Already decided in
  §9 — the client sets delivery→pickup FIRST, then sees ONLY products with ≥1 available for THAT window,
  qty **capped** at that window's availability. The confidentiality guarantees to enforce when built:
  1. The availability endpoint answers **per requested window** only (never "all windows"), and only for
     the products **currently in view** (paginated) — never a bulk fleet-availability dump.
  2. It returns a **capped orderable quantity** ("you can take up to N"), NOT the raw fleet total nor the
     count already booked. A devtools user learns only "≤N takeable for the window I committed to" —
     inherent to letting them order, and nothing about fleet size, other windows, or unviewed products.
  3. On a conflict, the message names WHICH line is short and by how much **relative to their request**
     (the same `409 data.conflicts` shape) — enough to fix it without trial-and-error, revealing only the
     product they already chose.
- **The principle, one line:** *reveal whether THIS actor's THIS request (their products, their window)
  can be fulfilled and by how much it's short — never the fleet's shape beyond that.*

### 10.D Build order when the time comes
1. Combobox picker (10.A) — small, do first if the dropdown annoys in practice.
2. Live admin availability annotation on the form once dates are set (10.C admin half) — needs a small
   `POST /orders/availability` (products + window → per-product takeable count, **Admin-only**).
3. The cart (10.B) — reuses everything above.
4. The client self-service flow (§9) — the window-first + capped endpoint (10.C client half); the
   confidentiality contract above is its spec.

## 11. Admin vs Client order flows — shared/separate architecture (PLANNED, not built — 2026-07-20)

The order-creation surface will serve TWO actors: the **Admin** (built now — trusted, sees everything)
and the future **Client** self-service (§9 — untrusted, tight confidentiality). This section fixes how
they relate so we build the ADMIN pieces reuse-friendly and never have to rewrite. **Governing
principle: shared CORE, role-projected EDGES, separate FRONTEND FLOWS, shared SUB-COMPONENTS.** (Both
actors can order for a THIRD-PARTY recipient — the delivery snapshot is decoupled from identity, which
is exactly why the snapshot columns exist. A Client's *identity* is always their own account; a Client
never touches client-registries — those are an admin-only tool.)

### 11.A `POST /orders` — ONE endpoint, role-branched (NOT two endpoints)
The core (atomic stock check + 1h spacing + snapshot + server-side pricing + freeze) is IDENTICAL for
both actors — duplicating it would drift. So widen the SAME endpoint (today it's Admin-only), branching
only at the edges:
- **Guard** → `[Admin, Client]`.
- **Identity (server-resolved — NEVER trust the body for a Client):**
  - Client → `userId = req.user.userId`, FORCED; reject any `clientRegistryId`/foreign `userId` in the
    body (a client must never order "as" someone else).
  - Admin → `clientRegistryId` (walk-in) XOR a chosen `userId` (registered client — the platform-user
    door; keep the validator/controller shaped to add this branch WITHOUT a rewrite).
- **Time rules:** Client → enforce the event type's `minLeadHours` (create only ≥ that far ahead;
  edit/cancel only until that many hours before delivery). Admin → NONE (only stock+spacing).
- **Delivery snapshot:** both capture a responsible-person snapshot (name/contact/address — may be a
  third party). Same columns, same validation.
- **Role-projected RESPONSE / errors (the confidentiality edge):**
  - Stock **409** — Admin: exact `{ requested, available }` per line (trusted). Client: SOFT — product
    names only or a generic "algunos productos ya no están disponibles, actualiza", **NO counts** (a
    client must not be able to probe fleet numbers by submitting orders; the window-first picker already
    caps qty, so a client 409 is only a rare race → "re-check", not a number).
  - Spacing **409** — Admin: which/when. Client: "ese horario no está disponible, elige otro" (never
    *why* — don't leak that another order sits there).
  - Success payload — role-project like the reads (Client sees their order without internal fields).

### 11.B Availability read — a NEW endpoint, NOT `GET /products` (see §10.C)
`GET /products` stays the catalog BROWSE (role-projected fields; Client sees no stock). Window-scoped
availability is a SEPARATE, tightly-scoped concern so the confidentiality contract is explicit + auditable:
- Client window-first browse: `GET /orders/available-products?deliveryAt&pickupAt&page` → only products
  with ≥1 available for THAT window, each with a **capped orderable qty** (never the fleet total).
- Line annotation (admin live check / client cart re-check): `POST /orders/availability` (productIds +
  window → per-product cap). Admin: exact; Client: capped-only.
- Never a bulk fleet-availability dump; per-window + per-viewed-products only (§10.C).

### 11.C Frontend — SEPARATE flows, SHARED sub-components
The STEP ORDER differs, so a single mega-form with role-branches everywhere would rot — build two pages,
share the pieces:
- **Admin (built):** mode → client (registry) → dates → all-products lines → snapshot → money (admin sets
  the delivery fee) → estimate → confirm.
- **Client (future):** mode → **dates FIRST (window)** → window-filtered, qty-capped products → delivery
  snapshot (self or third party) → **total to pay** (client does NOT set the delivery fee, does not see
  internal pricing/fleet) → confirm. No registry picker (identity = their account).
- **Reuse (keep these dependency-light NOW so extraction is trivial later):** `OrderModeSelect`, the
  datetime `CustomInput`, the delivery-snapshot field group, the estimate/total display, the product-line
  row, and `SchemaCreateOrder`'s field helpers + `toCreateOrderBody` (the client body is a SUBSET — it
  omits identity; the server fills `userId`). Don't pre-extract, but don't couple them to admin-only
  context either.

### 11.D Role-awareness doctrine — the "consciousness" for every new surface
Bake this in from now so nothing leaks by omission (fail-CLOSED — show the LEAST until a role grants more):
- **Endpoint** → declares its role guard AND a role-projected response (the `projectProductForRole` /
  `projectOrderListItem` pattern — the projection is the single source of field visibility). A Client
  read is a NEW tier on the projection, never a widening of the Admin one.
- **Page/route** → declares its `getStoredRole` guard; the backend 403 is the real boundary (the guard is
  UX only).
- **Component** → shows role-sensitive data only via `RoleGate`/`useHasRole` or a role-projected PROP;
  never re-derives the role or trusts client-passed identity.
- **Errors** → may carry MORE detail for Admin than Client (see 11.A) — decide the projection when the
  Client can first reach the code path.

### 11.E Awareness NOW so we don't regret it later
- Order read projections (`projectOrderListItem`/`projectOrderDetail`) are Admin-only today → ADD a Client
  tier when "mis pedidos" lands; don't widen Admin's.
- `POST /orders` identity is `clientRegistryId`-only today → the `userId` branch (admin-for-registered +
  client-self) is the SAME endpoint; keep it structured to add without a rewrite.
- The 409 conflict payload is Admin-detail today → project it (soft) the moment a Client can hit it.
- Do NOT overload `GET /products` with availability — separate endpoint by design.

### 11.F Scope decision (owner asked: separate flows, or shared?)
**Not a new epic, and not "forget the client."** The Client flow is a deferred Epic-2 slice (§9); this
doc is its spec. For NOW: finish the ADMIN flow (agenda + creation exist; next is order detail + tracking),
building the shared sub-components reuse-friendly per 11.C, and keeping the endpoint/projection doors open
per 11.A/11.E. When the Client flow lands it's a separate page + a widened `POST /orders` + the two
availability endpoints — no rewrite of what exists.
