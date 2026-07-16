# EPIC 2 — Orders, Availability & Logistics

> **Status: PLANNED (owner interviewed 2026-07-15).** Epic 1 (products CRUD) is COMPLETE. This
> file is the single source of truth for what comes next: owner decisions are marked ✅, still-open
> questions live in §9. Future sessions: read this FIRST; do NOT start coding orders before
> EPIC-2A (§3) is done. Update this file as things land.

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
- ✅ **Only the ADMIN can move a step BACKWARD** (any order). Drivers only ADVANCE their ASSIGNED
  orders. Clients only VIEW their own order.
- ✅ **CANCELLED** can happen at any step by the admin (even en route); by the client only within
  their edit window.
- ✅ **Payment is an order STATE, not a step**: it can happen at any moment. Support **anticipo**
  (partial deposit, amount recorded) → "pagado" flag when complete (total is known). Not the
  usual case but must be recordable.
- ✅ **Event types are a parameterizable lookup** (the purpose of the rental). Each type carries a
  **min-lead-time in hours** (default 24): clients can CREATE orders only if delivery is at least
  that far away, and can EDIT/CANCEL only until that many hours before delivery. Admin: NO time
  restrictions — only conflict restrictions (stock + 1h spacing).
- ✅ **Assignment**: MVP = admin assigns orders to a driver manually (the admin is also a driver).
  Auto-assignment (vehicles/capacity/feasibility) is a future door.

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
  decide the cheapest shape at migration time, never a redesign.

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

## 3. EPIC-2A — the Driver refactor (PREREQUISITE, plan only — NOT yet implemented)

**Do this as its own first step of Epic 2, in one focused session.** It corrects Epic-1 surface
that assumed "Employee sees products":

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

New/changed (author with `prisma migrate diff`, per CLAUDE.md rules):

- `event_types` lookup: name, description, `minLeadHours Int @default(24)`, isActive (publication
  flag). FK from `services`.
- `services` additions: `eventTypeId`, `deliveryAt DateTime`, `pickupAt DateTime` (planned, hour
  precision), `deliveredAt/collectedAt DateTime?` (actuals), `readyAt DateTime?` (stock released),
  `assignedUserId Int?` (the driver), `depositAmount Decimal?` (anticipo), `paidAt DateTime?`,
  `cancelledAt/cancelReason?`. `serviceStart/serviceEnd` become the BILLED period (days).
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

1. EPIC-2A driver refactor.
2. Event types lookup + admin CRUD-lite (or seed-only first).
3. Admin creates/edits/cancels orders (client picker; lines with per-day pricing; delivery/pickup
   times; atomic stock + 1h-spacing validation; RECONCILE pattern for lines).
4. Tracking flow with taps + photo evidence + backward-only-admin + explicit final "listo".
5. Orders list + detail + the dashboard (next actions + week agenda).
6. Receipt/quote PDF.
7. `.ics` for delivery/pickup (±30min padding).
Defer: client self-service ordering, driver assignment UI beyond a simple picker, notifications
engine (start with the hourly "ready?" reminder + per-delivery email), refunds/damages (Q-2),
role-management UI, vehicles/routes/slots, FEL.

## 6. Doors that must stay open (never make these harder)

Multiple vehicles/capacities/load & route optimization; time slots; more employee types with
per-type permissions; auto-assignment; FEL invoicing; WhatsApp notifications; multi-country/TZ;
role-management UI; camera-enforced evidence; client-visible availability calendar (if ever);
**hourly billing** (rentTimeUnit stays functional); **damage/loss billing** (extras/adjustments);
**refunds** (negative payments); **admin discounts/coupons**; the **admin preferences UI** over
the seeded `app_preferences`; additional per-step "requestables" beyond photos.

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

### Still OPEN (ask before building the affected slice)
- **Q-A Consumables-only purchases**: the flow starts with dates, but a pure-purchase order
  (consumables: delivered, never picked up) doesn't need a pickup. A "solo compra" toggle? A
  delivery-date-only mode? Owner explicitly unsure — propose the best practice at order-form
  design time. Mixed rent+purchase orders exist (purchases just skip the pickup half).
- **Q-B Comms**: email content & cadence to clients (cheapest channel wins; WhatsApp is a future
  door); which events notify whom.
- **Q-C Dashboard week window**: exact shape (current week vs ±3 days vs 6 ahead) — decide by
  design feel, owner has no strong preference.
- **Q-D Walk-in identity**: minimal guest record (name+phone) vs forced account for admin-created
  orders (owner handles WhatsApp people today; schema needs `services.userId` nullable OR a guest
  users row — decide at order-create design time).
