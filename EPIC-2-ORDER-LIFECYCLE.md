# EPIC 2 — Data-Driven Order Lifecycle Engine (design + full implementation plan)

> ## ⚡ BUILD STATUS (2026-07-27) — Phases 0–3 are IMPLEMENTED and green; Phase 4 is not started.
>
> **Owner decisions that closed §11 (2026-07-27):**
> - **Q1 →** a distinct **`Listo` step EXISTS** after `Recolectado` (there is a real **washing
>   period** between collection and the units being usable again). Seeded as pipeline step 5, id 6,
>   `appliesTo: RENTAL`. Consequence, deliberately: **`Recolectado` still HOLDS inventory** (units are
>   back but dirty) and only **`Listo` releases them** — availability is now honest about the wash.
> - **Q2 →** evidence counts are **both**: global bounds (`orders.evidenceMinPhotos` /
>   `orders.evidenceMaxPhotos`) define the allowed range and the fallback; each status carries a
>   `requiresEvidence` switch **plus optional per-status `minEvidence`/`maxEvidence`**, always clamped
>   into the global bounds.
> - **Q3 →** re-seeding **never overwrites admin edits** by default; `pnpm db:seed:force` (`prisma db
>   seed -- --force`) is the explicit escape hatch that restores the seeded defaults. A DB that
>   predates the machine gets a one-time backfill of the flag columns only.
> - **Q4 →** a **Driver may advance AND cancel (with a reason)** orders assigned to them — never
>   rewind. Rewind stays Admin-only.
>
> **Two design refinements the answers forced (they supersede §3.1/§4.3 below):**
> - `holdsInventory` is **not a boolean** — it is `inventoryHold: NONE | WINDOW | OUT`. `WINDOW`
>   holds only inside the order's billed period (Pendiente); `OUT` holds unconditionally (En ruta,
>   Entregado, and now Recolectado). One field expresses the whole availability rule.
> - Tracked actuals are stamped by a declared **`tracksEvent: DELIVERY | COLLECTION`** flag, never by
>   a status id or a pipeline position — so inserting a step can never mis-stamp `deliveredAt` /
>   `collectedAt`, and `readyAt` is stamped purely by "this move completed the applicable pipeline".
>
> **What shipped (all green: 696 API tests / 1193 app tests, 100% coverage both packages, lint +
> type-check clean, OpenAPI validated):**
> - **Phase 0** — `service_status` capability columns + `@@unique(sortOrder)`, engine-authored
>   migration `20260727000000_epic2_order_lifecycle_machine` (**NOT applied — the owner applies it**),
>   seed rewritten (6 statuses incl. `Listo`, create-only mask + `--force`), evidence prefs,
>   `ServiceStatusEnum` demoted to seed anchors.
> - **Phase 1** — `modules/orders/lifecycle/` (cached catalog, pure derivations, `resolveTransitions`
>   / `transitionKindFor` / `describeActions`, evidence-bound resolution); `buildRentedNowWhere` +
>   `buildRentedInWindowWhere` now read `inventoryHold` (the En-ruta TODO is resolved);
>   `computeNextActionAt` derives from actuals; `/orders/catalog` publishes the flags; list/detail
>   projections carry `status.colorKey`, `nextStatus` and per-actor `actions`; create uses
>   `initialStatus`.
> - **Phase 2** — frontend consumes it: `statusTone` (colorKey → classes), `useOrderLifecycle`,
>   ticket tones + quick-action label from data, `orderNextActionAt` from actuals.
> - **Phase 3** — `POST /orders/:id/advance` (one door for advance/rewind/cancel: row lock,
>   re-authorisation under the lock, evidence bounds, history row, flag-driven stamping) +
>   `POST /orders/evidence/upload-url`; `OrderAdvanceModal` + `useAdvanceOrder` +
>   `useOrderEvidenceUploads` — **the agenda's quick action is LIVE**.
>
> **Phase 4 (the admin "Estados del pedido" screen) is DEFERRED, not pending** — owner decision
> 2026-07-27: it belongs to the preferences surface, which doesn't exist yet, and the machine is
> already fully editable by re-seeding. **§14 holds the complete brief** (endpoints, invariants,
> reorder gotcha, cache invalidation, UI) — pick it up as one slice after the order DETAIL page.
> Nothing shipped depends on it.
>
> **Also shipped alongside the phases (2026-07-27):** evidence RETENTION (`pnpm purge:evidence`, §6b);
> the agenda ticket's live state transition (`MorphSwap` — the chip and next-step button adapt their
> width while their labels cross-fade); the warm-list diff so a newly created order opens its space
> instead of popping in (the products grid's `useGridListTransition`, generalized); and a shared
> single-subscription `useBreakpoint` (it was one resize listener PER ROW — the agenda's jank).
>
> **⚠️ To run this: apply the migration (`pnpm prisma:migrate:deploy`) and re-seed (`pnpm db:seed`).**
> Without the seed there is no `isInitial` status and order creation answers a clean 409.

> **Status:** PLAN (authored 2026-07-27) — §0–§13 below are the original design and remain the
> reference for intent. This is the single source
> of truth for turning the order-status lifecycle from a hardcoded enum into a **data-driven,
> admin-managed state machine** designed as a **reusable foundation** for every current and future
> order flow (admin create, agenda, tracking advance, client self-service orders, auto-assignment,
> per-status notifications…). Execute it phase by phase; each phase ends green (100% coverage, lint,
> type-check, OpenAPI, i18n, docs). Owner decisions that produced it are recorded inline.
>
> **What the owner is actually asking for (2026-07-27):** the *background* architecture must be
> perfect and complete now, even though the only surfaces visible today are **order creation** and the
> **agenda list**. Future endpoints should just *consume* this structure, never re-invent it. Admin is
> the ONLY actor who edits the lifecycle definition; if the admin misconfigures it, that is the admin's
> responsibility (no heavy guard-rails, **no definition-level audit log**). Keep the current flow as the
> seeded default. Keep the soul of the business (owner-trust, MVP-pragmatic, exact counts, es-GT,
> mobile-first, NO-TRASH, mirror the products module's proven patterns).

---

## 0. The problem, in one paragraph

Order statuses today are a fixed `ServiceStatusEnum` (PENDING=1, CANCELLED=2, DELIVERED=3,
COLLECTED=4, EN_ROUTE=5) mirrored by seeded `service_status` rows. Code branches on those literal
ids in three live places (`buildRentedNowWhere` availability, the frontend chip tones, the inert
`nextStepKey`). That means the admin cannot rename, recolor, reorder, or add a step, and every future
flow would re-hardcode the same ids. We want the **rows to declare their own behavior** (position,
inventory effect, evidence rule, display) so the machine is configured in data, while **code keeps
only the invariants that cannot be data** (mode-aware completion, actor permissions, transactional
inventory recompute, locking).

---

## 1. Design principles (the non-negotiables)

1. **Data = vocabulary + declarative behavior. Code = invariants + orchestration.** The DB says WHICH
   statuses exist and their flags; code enforces what flags can't express (who may move where, the
   `$transaction` + `SELECT … FOR UPDATE`, inventory recompute, mode-aware completion).
2. **One source of truth per concern.** Status vocabulary → `service_status`. Transition/permission
   rules → one backend service. The rental-holding rule → the `holdsInventory` flag, read in exactly
   one query builder. Never a second copy.
3. **The enum degrades to SEED ANCHORS.** `ServiceStatusEnum` stays only so the seed and tests can
   name the default rows. **Runtime logic must never branch on a specific id** — it reads flags. A
   lint-comment on the enum will say so.
4. **Every flow reuses the same engine.** Admin advance, driver advance, client cancel, auto-assign
   hooks, notification hooks — all call the ONE transition service with a different *actor*. Adding a
   flow = a new caller, never a new machine.
5. **Mirror the products module.** Reconcile-style writes, R2 presign for evidence (already the
   `service_evidence` pattern), seeded-lookup + `isActive` publication flag, role-projected reads,
   `sendOzariSuccess`/`sendOzariError`, i18next keys, Zod validators mirrored FE/BE. No new idioms.
6. **NO-TRASH.** A status referenced by history/orders soft-deactivates (`isActive=false`); an unused
   one hard-deletes. Orders never delete — they cancel.

---

## 2. Domain model — the two concepts (owner's refinement, 2026-07-27)

There are **two different things**, modeled differently:

- **Pipeline steps** — the ordered happy path. Each has a `sortOrder` (drives *next*/*previous*).
  Seeded: `Pendiente(1) → En ruta(2) → Entregado(3) → Recolectado(4)`.
- **Disruptive states** — NOT a position in the chain; an **any-time exit** reachable from wherever
  the order sits. `sortOrder = NULL`, flagged `isDisruptive`. Seeded: `Cancelado`. Rare to add more,
  but extensible with **zero special-casing** (e.g. a future "No entregado" failed-delivery is just
  another `isDisruptive` row). The engine treats any disruptive state as "stop the flow, release the
  rental hold, stamp its timestamp/reason."

**How Cancel is handled (perfectly, no redundancy):** it is a `service_status` row (so it carries a
name/color/inventory rule from the same table) **flagged `isDisruptive`**, PLUS the already-existing
`services.cancelledAt` + `cancelReason` denormalize the *when/why* (the agenda history filter already
reads `cancelledAt`). Vocabulary/display from the table; the timestamp for fast queries and the
reason. If a second disruptive state ever appears we generalize the timestamp then — not now.

**Mode-aware completion is DATA-DRIVEN too** via an `appliesTo` flag (`ALL | RENTAL | SALE`): a
purchase-only (sale) order's pipeline ends at `Entregado` because the collection step is
`RENTAL`-only and simply doesn't apply. So "what's the next step / is it done" is derived, not
hardcoded — the only code input is "does this order have a rental line" (`service_details.isRental`,
already snapshotted per line). This removes ALL hardcoded sale-vs-rental branching.

---

## 3. Schema (Prisma) — exact changes

> Author with Prisma per repo rule: edit `schema.prisma`, then generate the migration SQL read-only
> via `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script -o
> prisma/migrations/<ts>_<name>/migration.sql` (or real `migrate dev` if `SHADOW_DATABASE_URL` is
> set). **Do NOT apply to the shared Neon dev DB** — the owner applies + seeds (no-DB-writes rule).

### 3.1 `service_status` — the capability model (reshape the lookup)

Add to the existing model (keep `id/name/description/isActive/timestamps`):

```prisma
model ServiceStatus {
  id          Int       @id @default(autoincrement())
  name        String
  description String?
  isActive    Boolean   @default(true) @map("is_active")   // publication flag (NO-TRASH)

  // --- NEW: declarative behavior (the state machine, in data) ---
  sortOrder        Int?    @map("sort_order")               // pipeline position; NULL = disruptive off-ramp
  isInitial        Boolean @default(false) @map("is_initial")        // create-time status (exactly one)
  isDisruptive     Boolean @default(false) @map("is_disruptive")     // any-time exit (Cancelado)
  holdsInventory   Boolean @default(false) @map("holds_inventory")   // a RENTAL line here is out of the fleet
  requiresEvidence Boolean @default(false) @map("requires_evidence") // advancing INTO it needs photos
  appliesTo        String  @default("ALL") @map("applies_to")        // ALL | RENTAL | SALE  (mode gating)
  colorKey         String? @map("color_key")               // chip tone token (frontend maps → classes)

  updatedAt   DateTime? @updatedAt @map("updated_at")
  createdAt   DateTime  @default(now()) @map("created_at")

  services          Service[]
  statusHistoryFrom ServiceStatusHistory[] @relation("StatusHistoryFrom")
  statusHistoryTo   ServiceStatusHistory[] @relation("StatusHistoryTo")
  serviceEvidences  ServiceEvidence[]

  @@unique([sortOrder])   // distinct pipeline positions; Postgres allows many NULLs (disruptive rows)
  @@map("service_status")
}
```

Notes:
- `@@unique([sortOrder])` enforces "one status per pipeline slot" while permitting unlimited
  disruptive rows (multiple NULLs are allowed in a Postgres unique index). To insert "En preparación"
  between 1 and 2, the admin reorders (a bulk re-number) rather than fractional slots — the reorder
  endpoint renumbers `1..N` in a transaction.
- `appliesTo` is a small string enum (validated in app; not a DB enum, to stay migration-simple and
  match the repo's string-lookup style). Seed `Recolectado = "RENTAL"`, everything else `"ALL"`.
- `colorKey` stores a **token** from a fixed palette (`amber|indigo|emerald|sky|red|slate|violet|…`),
  NOT Tailwind classes — the frontend owns the class map (design stays in code; unknown key ⇒ neutral).

### 3.2 `services` — no structural change needed

Everything required already exists: `serviceStatusId` (current status), `deliveredAt`,
`collectedAt`, `readyAt`, `cancelledAt`, `cancelReason`, and the billed window. The advance engine
just writes them. (Whether a distinct post-`Recolectado` "Listo/Finalizado" step exists is an
**open decision — see §11 Q1**; today `Recolectado` is the terminal pipeline step and completion sets
`readyAt`.)

### 3.3 `service_status_history` & `service_evidence` — already correct

- `ServiceStatusHistory` (append-only: `serviceId, fromStatusId?, toStatusId, byUserId, createdAt`)
  is the **per-order** audit — kept and written on every transition. This is NOT the "definition
  audit" the owner declined; it's the order's own trail (§4 dispute-proofing).
- `ServiceEvidence` (`serviceId, serviceStatusId, r2Key(unique), url, createdAt`) already links a
  photo to the **phase evidenced** — perfect for `requiresEvidence`. Reuse the products R2 presign +
  post-commit batched delete pattern.
- **Optional refinement (defer):** add `serviceStatusHistoryId` to `service_evidence` to bind photos
  to the exact transition event (not just the phase). Not needed for MVP; note as a door.

### 3.4 `app_preferences` — evidence + engine tunables (seed create-only)

Reuse the typed preference table for the global knobs (never clobbered on re-seed):
- `evidence.minCount` (int, default `1`), `evidence.maxCount` (int, default `10`) — global evidence
  bounds; `requiresEvidence` per status decides *whether* photos are demanded, these decide *how many*.
- (Existing/planned) `logistics.spacingMinutes`, etc. stay here. Per-status count overrides
  (`minEvidence`/`maxEvidence` columns) are a **future door**, not MVP.

### 3.5 Seed (`prisma/seed.ts`) — the current flow as default (idempotent upsert)

| id | name | sortOrder | isInitial | isDisruptive | holdsInventory | requiresEvidence | appliesTo | colorKey |
|----|------|-----------|-----------|--------------|----------------|------------------|-----------|----------|
| 1 | Pendiente | 1 | ✅ | | ✅ | | ALL | amber |
| 5 | En ruta | 2 | | | ✅ | | ALL | indigo |
| 3 | Entregado | 3 | | | ✅ | ✅ | ALL | emerald |
| 4 | Recolectado | 4 | | | | ✅ | RENTAL | sky |
| 2 | Cancelado | NULL | | ✅ | | | ALL | red |

(ids unchanged — the enum anchors stay valid. `upsert` by id + `update` the new flag columns, so
re-seeding staging is safe and never clobbers an admin rename because the seed is the *creation*
default; **once the admin edits a status the seed must not overwrite name/color/flags** — mirror the
`app_preferences` create-only stance: `create` sets everything, `update` only fills newly-added
columns / leaves admin-editable fields alone. Decide the exact update mask in Phase 0.)

---

## 4. Backend architecture — the reusable engine

New module layout (mirrors existing `orders/`):

```
ozari-api/src/modules/orders/
  lifecycle/
    lifecycle.service.ts     # THE engine: catalog cache, resolveTransitions, canTransition, advance
    lifecycle.models.ts      # StatusDefinition, TransitionSet, ActorContext, AdvanceResult types
    lifecycle.service.test.ts
  statuses/                  # admin CRUD of the DEFINITION (Phase 4)
    statuses.route.ts  statuses.validator.ts  statuses.controller.ts  statuses.models.ts
  advance/                   # the per-order transition endpoint (Phase 3)
    advance.route.ts  advance.validator.ts  advance.controller.ts
```

### 4.1 The status catalog (cached vocabulary)

`getStatusCatalog(): Promise<StatusDefinition[]>` — reads all `service_status` rows (incl. inactive,
flagged) ONCE and memoizes in-process (invalidate on any admin write). Everything else derives from
this array — no repeated DB reads per request. `StatusDefinition = { id, name, description, isActive,
sortOrder, isInitial, isDisruptive, holdsInventory, requiresEvidence, appliesTo, colorKey }`.

Derived helpers (pure, unit-tested):
- `initialStatus(catalog)` → the `isInitial` row (the create default; today Pendiente).
- `pipeline(catalog)` → active non-disruptive rows sorted by `sortOrder`.
- `disruptiveStates(catalog)` → active `isDisruptive` rows.
- `holdingStatusIds(catalog)` → `holdsInventory` ids (the availability source — see §4.4).
- `orderMode(order)` → `RENTAL` if any line `isRental` else `SALE`.
- `nextStatus(catalog, order)` → next pipeline row after the order's current `sortOrder` whose
  `appliesTo` matches `orderMode`; `null` ⇒ the order is at its last applicable step (complete).
- `previousStatus(catalog, order)` → prev applicable pipeline row (admin rewind).
- `isComplete(catalog, order)` → `nextStatus === null` and not disruptive.

### 4.2 Transitions + permissions (the reuse core)

```ts
type ActorContext = { userId: number; role: RolesEnum };  // extend later (client, system)

resolveTransitions(catalog, order, actor): {
  forward?: StatusDefinition;          // the mode-aware next pipeline step, if the actor may advance
  backward?: StatusDefinition;         // prev pipeline step, admin only
  disruptive: StatusDefinition[];      // reachable off-ramps for this actor (e.g. Cancelado)
}

canTransition(catalog, order, toStatus, actor): boolean   // the SINGLE authority; every flow calls it
```

**Permission matrix (the one place role rules live — reused by every flow):**

| Actor | Forward (next pipeline) | Backward (prev) | Disruptive (cancel) | Scope |
|-------|-------------------------|-----------------|---------------------|-------|
| **Admin** | ✅ any order | ✅ any order | ✅ any time, any order | all |
| **Driver** | ✅ only orders `assignedUserId === self` | ❌ | ❌ (MVP) | assigned |
| **Client** *(future)* | ❌ (system/admin-driven) | ❌ | ✅ cancel, only within the event-type edit window | own |
| **System** *(future: auto-assign / jobs)* | policy-scoped | ❌ | policy-scoped | — |

Adding client/driver/auto-assign flows later = extend this matrix + call `advance()`. No engine change.

### 4.3 `advance()` — the transactional mutation

```ts
advance(order, toStatus, actor, evidenceKeys?): Promise<AdvanceResult>
```
Inside ONE `$transaction` with `SELECT … FOR UPDATE` on the order (+ product locks when inventory
shifts):
1. Re-read the order + catalog under lock; assert `canTransition(...)` (else 409/403 — race/again).
2. If `toStatus.requiresEvidence`: assert `evidenceKeys.length ∈ [evidence.minCount, maxCount]`; the
   keys are pre-uploaded to R2 (presign, §4.5); create `service_evidence` rows (`serviceStatusId =
   toStatus.id`).
3. Write `service_status_history` (`fromStatusId = current`, `toStatusId`, `byUserId = actor`).
4. Update `services.serviceStatusId = toStatus.id` and stamp the matching actual:
   - moving to a status whose semantic actual exists → set it (`deliveredAt` when entering the
     delivered step, `collectedAt` for collected, `cancelledAt`+`cancelReason` for a disruptive move,
     `readyAt` when `isComplete` after the move). The mapping is **by flag/derivation**, not by literal
     id: "entering the first non-holding terminal pipeline step" etc. (Phase 3 pins the exact rules;
     the safe MVP: stamp `deliveredAt`/`collectedAt` when entering the step whose `sortOrder` matches
     the seeded Entregado/Recolectado *positions*, `readyAt` on completion, `cancelledAt` on disruptive.)
5. Inventory: rental holds are **derived live** from `holdsInventory` (no stored counter to mutate —
   `buildRentedNowWhere` recomputes on read), so step 4 alone changes availability. Sale stock is
   decremented at its own point (unchanged from today's create logic).
6. Post-commit, best-effort (never fail the request): R2 cleanup for replaced evidence; notifications
   (§7). Mirror the welcome-email non-fatal pattern.
Returns the re-projected order (same shape as `GET /orders/:id`).

### 4.4 Inventory integration (make the schema live)

`buildRentedNowWhere(productIds, now, holdingStatusIds)` — replace the hardcoded
`ServiceStatusEnum.DELIVERED / PENDING` list with `serviceStatusId: { in: holdingStatusIds }`, where
`holdingStatusIds = holdingStatusIds(catalog)`. This **auto-includes En ruta** (resolving the
standing ⚠️ TODO) and any future holding step, and honors the window exactly as today (holding still
requires `serviceStart ≤ now ≤ serviceEnd` for the not-yet-out steps). One-line semantic swap, big
correctness win. Callers pass the cached id set.

### 4.5 Evidence upload (reuse products presign)

`POST /orders/evidence/upload-url` (admin/driver) mints an R2 presigned PUT exactly like
`POST /products/images/upload-url`; the browser uploads, then passes the keys to `advance()`. Server
derives the public URL from the key (never trusts a client URL). Same bucket CORS.

### 4.6 Read projections + catalog exposure

- `GET /orders/catalog` gains, on each status: `sortOrder, isInitial, isDisruptive, holdsInventory,
  requiresEvidence, appliesTo, colorKey` (so FE derives tones + next-step + admin UI from data).
- `GET /orders` / `GET /orders/:id` projections gain a computed `nextStatus` (id+name, or null) and
  `availableActions` for the actor (so the FE button is data-driven, not hardcoded) — computed via
  `resolveTransitions`. Keep the existing `assignee`/`isMine`.

---

## 5. API surface (by phase)

| Method + path | Phase | Actor | Purpose |
|---|---|---|---|
| `GET /orders/catalog` (extended) | 1 | Admin (→ Driver) | statuses now carry flags + colorKey |
| `GET /orders`, `GET /orders/:id` (extended) | 1 | Admin/Driver | projections carry `nextStatus` + `availableActions` |
| `POST /orders/evidence/upload-url` | 3 | Admin/Driver | presigned R2 PUT for evidence |
| `POST /orders/:id/advance` | 3 | Admin/Driver | forward/backward/disruptive transition (+ evidence) |
| `GET /orders/statuses` | 4 | Admin | list status definitions (management) |
| `POST /orders/statuses` | 4 | Admin | add a step (pipeline or disruptive) |
| `PUT /orders/statuses/:id` | 4 | Admin | edit name/color/flags/evidence/appliesTo |
| `PUT /orders/statuses/reorder` | 4 | Admin | bulk re-number `sortOrder` (drag-reorder) |
| `DELETE /orders/statuses/:id` | 4 | Admin | NO-TRASH delete (deactivate if referenced) |

Every endpoint: `sendOzari*`, i18next keys, 401/403/404/409/422/429/500 conventions (the wrong-secret
422-not-401 split doesn't apply here; use 409 for a race/invalid-transition, 422 for a
semantically-bad definition edit), and an **OpenAPI paths + components entry in the same commit** (the
structural `openapi.test.ts` will fail otherwise — update its expected-operations list).

### Server-side definition invariants (minimal — admin owns the rest)
Enforced on `POST/PUT/DELETE/reorder /orders/statuses`:
- Exactly **one** `isInitial` active pipeline status (reassigning moves it).
- `sortOrder` unique among pipeline rows; disruptive rows have `sortOrder = NULL`.
- Can't deactivate/delete a status that **orders currently sit in** (would strand them) → 409 with a
  count; can't delete one referenced by history → soft-deactivate (NO-TRASH).
- `appliesTo ∈ {ALL,RENTAL,SALE}`; `colorKey ∈` the palette. Everything else (adding steps, evidence
  toggles, renames) is free — the admin owns the outcome.

---

## 6. Frontend architecture

- **`order.types.ts`**: `OrderStatus` gains `sortOrder, isInitial, isDisruptive, holdsInventory,
  requiresEvidence, appliesTo, colorKey`; `OrderListItem`/`OrderDetail` gain `nextStatus` +
  `availableActions`.
- **Tones from data**: replace `OrderTicket`'s hardcoded `STATUS_TONES` id-map with a `colorKey →
  Tailwind classes` map (fixed palette in code, neutral fallback) driven by the row's `colorKey`.
- **Next-step from data**: replace `orderDayGroups.nextStepKey` (hardcoded id switch) with the
  projected `nextStatus`/`availableActions` from the API. The agenda ticket's forward quick-action
  becomes **data-driven** (its label = `nextStatus.name`); it stays **inert until Phase 3** wires the
  advance mutation. The responsive ticket + skeleton (already done 2026-07-27) are unchanged.
- **`useOrderLifecycle(order)`** (FE mirror of `resolveTransitions`, UX-only; the backend re-validates)
  → `{ forward?, backward?, disruptive[] }` for rendering buttons.
- **Advance UI (Phase 3)**: the forward button → confirm; if `nextStatus.requiresEvidence` open an
  evidence modal (reuse `useProductImageUploads`/gallery presign) enforcing `evidence.minCount/max`;
  admin gets backward + cancel (with reason). Drivers: advance-only on assigned.
- **Admin management UI (Phase 4)**: a Preferences → **"Estados del pedido"** screen — a reorderable
  list (reuse `useGalleryDrag` + the pure `galleryReorder` geometry), add step (pipeline/disruptive),
  edit name + color (palette picker) + evidence toggle + `appliesTo`, deactivate. Follows the entity-
  form doctrine (dedicated page/section, RHF + mirrored Zod, `toFormError`, `configMissing` states).
- i18n: all copy under `modules.panel.orders.*` / `modules.panel.preferences.statuses.*`, es-GT.

---

## 6b. Evidence RETENTION (owner decision, 2026-07-27) — built as a script, designed for an admin UI

Every evidence-demanding step stores photos in R2 **forever**, and at ~5 photos per order a couple of
busy years is tens of thousands of objects nobody will open again. So evidence has a **retention
policy**, and the first implementation of it is `pnpm purge:evidence`
(`scripts/purge-order-evidence.ts`, LOCAL-only like `reconcile:images` — it lives outside `src/`, so
it is never deployed).

**What it deletes, exactly:** the PHOTOS — the R2 objects and their `service_evidence` rows — of
orders finished before a cutoff. **Nothing else.** The orders, their lines, their money, their
`service_status_history` and every timestamp survive untouched: the business record is permanent,
only the storage is recycled. That is the whole design constraint (owner: *"let's make sure that
we're not erasing the elements on db, but just the image, and the reference on the db"*).

- **Cutoff:** `-- --before=YYYY-MM-DD`, else derived from the **`orders.evidenceRetentionMonths`**
  preference (seeded at 24). The knob lives in `app_preferences` precisely so an admin screen or a
  scheduled job can share it later without moving the policy.
- **Only FINISHED orders** (`readyAt` or `cancelledAt` set) are ever considered — photos of an
  in-flight or never-completed order are exactly the ones a dispute needs. `--include-unfinished`
  overrides it deliberately.
- **Dry run by default** (`--fix` applies); rows are deleted in ONE transaction that re-verifies each
  one inside it, and the R2 objects go AFTER the commit — a failed object delete leaves a sweepable
  orphan, never a row pointing at a deleted file.

**What the UI shows afterwards:** a purged step simply has no photos, and the order detail (when it
lands) renders its evidence section from whatever rows exist. The step still PROVES it happened —
`service_status_history` records who moved it and when, which is the part that answers disputes; the
photos were supporting material with a shelf life. *Documented door:* if the business ever needs to
distinguish "no photos were taken" from "photos were purged", add a `purgedAt` receipt column to
`service_evidence` (making `r2Key`/`url` nullable) and keep the row as a tombstone — a one-column
migration, deliberately NOT taken now because the owner asked for the reference to be removed.

**Future (not built):** an admin-facing "Retención de evidencia" control in preferences (edit the
months, see how much would be freed, run it), a scheduled job that applies it automatically, and a
notification when a purge runs. All three are callers of the same policy + the same deletion logic —
promote the script's core into `src/` when the first of them is prioritized.

## 6c. Availability across the WHOLE lifecycle (owner rule, 2026-07-28) — the invariant

There are **two inventories**, and only one of them is ever written. Getting this wrong is how stock
silently drifts, so it is stated once here and implemented in exactly two helpers
(`releaseSaleStock` / `reclaimOrderStock` in `orders.service.ts`).

| | RENTAL units | SALE units |
|---|---|---|
| **How availability is known** | DERIVED, live, from the order's status (`inventoryHold`) — nothing is stored | A real column: `products.quantity`, decremented at creation |
| **Create** | nothing to write (the status holds it) | decrement, after the availability check |
| **Forward / backward** | follows the status automatically (En ruta/Entregado/Recolectado hold; Listo releases) | untouched — a sale is a sale from the moment it's confirmed |
| **Cancel** | released instantly (Cancelado holds nothing) | **restored** — the order stopped being real |
| **Uncancel (reopen)** | re-held automatically — but **re-checked first** against the fleet in its window | **re-taken**, and refused with a structured `409` if the goods were promised elsewhere meanwhile |
| **Finish (Listo)** | released (the washing period ended) | stays consumed — **a delivered sale never comes back** |
| **Delete** | vanishes with the row | **restored only while the order still HELD them** — not if it was already cancelled (they went back then) and not if it was delivered (the client has them) |
| **Edit** (`PUT /orders/:id`, DONE 2026-07-28) | re-checked for the new window/lines **excluding this order** — and only when its status actually holds (a finished/cancelled order reserves nothing, so its edit is pure paperwork) | the DIFFERENCE applied, up or down, and only while `holdsSaleStock` — a delivered sale is never restocked by a correction |

Two rules carry the whole table: **rental availability is never written, only derived**, and **every
point where a SALE order stops or resumes being real must move `products.quantity` exactly once**.

The second rule needs one predicate, `holdsSaleStock(order)` = *not cancelled and not delivered* —
the single answer to "would giving these back put real goods on the shelf, or invent them?". A sale
unit is HELD from creation (reserved for this client) until **delivery**, when it physically leaves
the business and is simply sold. So a cancelled order already returned them, and a delivered one
cannot: deleting the paperwork of a completed sale must not restock goods the client is holding.

Reopening is the only move that can FAIL — the goods may have been promised elsewhere while the
order sat cancelled — which is why it answers the same structured 409 as create, naming each line
and its real count. **The admin can never "just reopen" past a conflict**: uncancelling is for a
cancellation made in error, and the moment someone else has taken those units it stops being a
correction and becomes a double-booking.

### 6c-bis. The UI may never GUESS any of this (owner rule, 2026-07-28)

Every dialog that mentions inventory states the effect the **engine reports**, never one inferred
from the kind of move. The old copy said "sus productos volverán a estar disponibles" on every
cancel and "esas unidades vuelven al inventario" on every delete — both false on an order that had
already finished or been delivered, and both would have kept being false as steps were added.

Two derived fields carry it, and nothing else may be used for this:

- **`OrderAction.inventoryEffect`** (`release` | `reclaim` | `none`) — `inventoryEffectOf` in
  `lifecycle.service.ts` compares what the order holds NOW with what it would hold after the move
  (`currentHoldings` / `holdingsAfter`). `reclaim` wins a tie because it is the effect that can FAIL.
  It is the ONE thing the advance dialog's inventory sentence, its cancel description, and its
  reversibility note branch on.
- **`order.holdsInventory`** — does the order reserve anything at all right now? The delete dialog
  states its consequence from this, matching what `deleteOrder` actually does (`holdsSaleStock`).

`OrderAction.purgesEvidence` is the same idea for photos: a backward leg out of a step that demanded
evidence destroys it, so the single-step rewind dialog warns exactly as the multi-step jump does.

The multi-step jump has no single offered action for the server to describe, so the frontend mirrors
the rule in `walkInventoryEffect` (`orderStatusPath.ts`) — reading only the walk's ENDPOINTS, since
a walk is applied in one transaction. Like every mirror here it is UX only: the backend re-resolves
under the row lock and the 409 remains the authority. **Keep the two in step**; a new inventory rule
belongs in `inventoryEffectOf` first and is mirrored second.

Consequence worth stating: because all of it is derived from `inventoryHold` + the sale predicate,
inserting a step, renaming one, or changing which steps hold units rewrites every one of these
sentences with **no code change** — which is the whole point of the data-driven machine.

## 7. Reusability — the future doors this unlocks (explicit)

- **Client-created orders**: reuse `canTransition` with a `client` actor + the event-type
  `minLeadHours` guard; client cancel = a disruptive transition gated by the edit window. Zero engine
  change — a new actor row in the matrix.
- **Auto-assign to available employees**: assignment is orthogonal to status, but `advance()` exposes a
  **post-transition hook**; entering `En ruta` (or on create) can trigger an auto-assign policy using
  the existing `ASSIGNABLE_ROLES` + assignment model. The policy is a new module; the trigger point
  already exists.
- **Per-status notifications / emails / push**: the post-commit best-effort hook in `advance()` is the
  reuse point (mirror the welcome/security email pattern). "Notify the client on Entregado" = config +
  a hook subscriber, not engine surgery.
- **New disruptive states** (rare): add an `isDisruptive` row — handled generically.
- **Branching flows** (if ever): introduce `service_status_transitions(fromId,toId)`;
  `resolveTransitions` switches from sortOrder-derivation to reading the table. Door documented; NOT
  built (owner confirmed linear).
- **Reporting / dashboards**: `service_status_history` is already the append-only substrate for
  cycle-time and funnel metrics.

---

## 8. Business soul (keep it)

Owner-trust (admin owns misconfig, minimal guards, no definition audit). MVP-pragmatic (linear +
disruptive, no premature workflow-engine). Exact counts (holds derived live, never a drifting
counter). One-tap happy path. Evidence = quality over forced camera (gallery uploads, capped). es-GT
throughout. Mobile-first agenda (already responsive). NO-TRASH everywhere. Mirror the products module
so the codebase stays of one mind.

---

## 9. Edge cases & details to NOT miss

1. **Purchase-only completion**: sale order ends at `Entregado` (collection step is `appliesTo:RENTAL`)
   → `readyAt` = `deliveredAt`; no pickup, no collection.
2. **`En ruta` must hold inventory**: the whole point of §4.4 — resolves the standing TODO.
3. **Cancel from any step** releases the rental hold immediately (Cancelado `holdsInventory=false`) and
   sets `cancelledAt` + reason; history preserves where it was cancelled.
4. **Backward move** (admin) must UN-stamp the actual it's leaving (e.g. rewind from Entregado clears
   `deliveredAt`) and un-complete (`readyAt=null`) — define precisely in Phase 3.
5. **Evidence bounds** honored at advance; a `requiresEvidence` step can't be entered without the min
   count; replaced/removed evidence R2 objects deleted post-commit (NO-TRASH).
6. **Agenda history filter** stays "`readyAt` set OR `cancelledAt` set"; both are terminal signals.
7. **Reorder** renumbers `1..N` atomically; inserting "En preparación" between 1 and 2 shifts the rest.
8. **Deactivating a status orders sit in** is blocked (409 + count); referenced-by-history →
   soft-deactivate only.
9. **Catalog cache invalidation** on every admin write (single in-process memo; the FE `staleTime`
   for `/orders/catalog` must drop or be invalidated after an admin edit).
10. **Driver scope**: `advance` on a driver is allowed ONLY for `assignedUserId === self` (403 else) —
    reuses the row-scoping already added for `GET /orders`.
11. **Coldstart/`ServiceStatusEnum`**: keep for seeding + tests, add a comment "seed anchors only — do
    not branch on these at runtime."
12. **Payment is orthogonal** (paymentStatus + `paidAt`) — NOT part of this lifecycle; don't entangle.

---

## 10. Testing strategy (100% both packages, per phase)

- **Pure engine** (`lifecycle.service`): table-driven unit tests over `nextStatus`/`resolveTransitions`
  /`canTransition` for every (mode × current status × actor) combo, incl. disruptive + completion.
- **advance()**: mocked-Prisma `$transaction` tests — allowed/denied, evidence bounds, timestamp
  stamping, history write, race→409.
- **Availability**: `buildRentedNowWhere` now includes En ruta (extend the products.service tests).
- **Time-dependent tests**: freeze `Date.now` (the pattern established 2026-07-27) where windows matter.
- **statuses CRUD**: invariant rejections (two initials, strand-orders, palette/appliesTo).
- **FE**: catalog-driven tones + next-step; advance modal + evidence; admin reorder/edit; `useBreakpoint`
  mock for the responsive ticket/skeleton (already in place).
- **OpenAPI**: extend `openapi.paths.ts`/`components.ts` + the expected-operations list in
  `openapi.test.ts` for every new endpoint, same commit.

---

## 11. Open decisions (confirm before/at the relevant phase)

- **Q1 — Is there a distinct post-`Recolectado` "Listo/Finalizado" step**, or is `Recolectado` itself
  terminal (sets `readyAt` = `collectedAt`)? The EPIC copy hints at a final "listo" press after
  collection/cleaning. *Recommendation:* keep `Recolectado` terminal for MVP (one less tap); if a
  sanitation gate is wanted, it's just one more pipeline row later — the data model already supports it.
- **Q2 — Evidence counts global vs per-status:** MVP uses global `app_preferences` bounds + a per-status
  `requiresEvidence` bool. Per-status `min/max` columns are a documented door. Confirm global is enough.
- **Q3 — Re-seed vs admin edits:** the exact `upsert` update-mask so re-seeding staging never
  overwrites an admin rename/recolor (create sets all; update fills only newly-added columns). Pin in
  Phase 0.
- **Q4 — Driver disruptive rights:** MVP gives drivers advance-only (no cancel). Confirm they never
  cancel/rewind.

---

## 12. Phased execution plan (each phase ends fully green)

**Phase 0 — Schema + seed (foundation).**
`schema.prisma` flag columns + `@@unique([sortOrder])`; read-only migration authored (owner applies);
seed the 5 defaults per §3.5 with the create-only mask (Q3); `ServiceStatusEnum` comment "seed anchors
only"; add `evidence.minCount/maxCount` prefs. Tests: seed idempotency, schema shape. Deliverable: the
data model exists; nothing else changes yet.

**Phase 1 — Backend engine + make the schema live (no new mutating endpoints).**
`lifecycle.service.ts` (catalog cache + pure derivations + `resolveTransitions`/`canTransition`);
wire `buildRentedNowWhere` to `holdsInventory` ids (fixes En-ruta TODO); extend `/orders/catalog` +
read projections with flags + `nextStatus`/`availableActions`. Full unit tests, OpenAPI, i18n, docs.
Deliverable: availability is correct & data-driven; the API exposes the machine.

**Phase 2 — Frontend consumption (the surfaces visible today).**
Tones from `colorKey`; next-step/quick-action label from `nextStatus` (still inert); `useOrderLifecycle`.
The responsive ticket/skeleton already done. Tests to 100%. Deliverable: creation + agenda fully driven
by the data model (the two visible surfaces), engine ready underneath.

**Phase 3 — Advance + evidence flow (the tracking slice, now fully specced).**
`POST /orders/:id/advance` + `POST /orders/evidence/upload-url`; the transactional `advance()`
(permissions, evidence bounds, timestamps, history, backward/cancel); FE advance modal + evidence
uploader; driver/admin scoping; make the quick-action button LIVE. Tests, OpenAPI, i18n.

**Phase 4 — Admin management UI (Preferences). ⏸ DEFERRED by owner decision (2026-07-27) — spec
ready, see §14. Do NOT treat it as work-in-flight.**
The machine is already fully editable by re-seeding (`pnpm db:seed`, or `pnpm db:seed:force` to
restore defaults), and the preferences SURFACE this screen belongs to doesn't exist yet — building
the CRUD now would ship a screen with no home. It lands *after* the remaining order slices (the
order DETAIL page first), together with the other admin knobs, as one preferences epic.

**Phase 5 — Future-flow doors (as they're prioritized).**
Client self-service orders (new actor + edit-window cancel), auto-assign policy (advance hook),
per-status notifications (post-commit hook). Each reuses the engine; each its own epic.

---

## 14. Phase 4 — "Estados del pedido" (DEFERRED, spec ready)

> **Status: deliberately not built** (owner, 2026-07-27). Everything below is a complete brief — pick
> it up as one slice when the preferences surface is built, after the order DETAIL page. Nothing in
> the shipped system waits on it: the lifecycle is edited today by re-seeding.

**Why it's safe to defer.** The machine lives in `service_status` rows and every consumer already
reads it: seed a new step, rename one, recolor it, change its evidence rule or its `appliesTo`, and
the backend engine, the agenda chips, the quick-action label and the confirm dialog all follow with
no deploy. What's missing is only the *editing surface* — a nicety for the admin, not a capability
of the system.

**API (all Admin-only, all with OpenAPI + i18n in the same commit — `openapi.test.ts` enforces it):**

| Method + path | Purpose |
|---|---|
| `GET /orders/statuses` | The definitions as the editor needs them: RAW `minEvidence`/`maxEvidence` (not resolved) **plus** the global bounds, so the form can show "inherits 1–10" vs an override |
| `POST /orders/statuses` | Add a step (pipeline or disruptive) |
| `PUT /orders/statuses/:id` | Edit name/description/colorKey/flags/evidence/`appliesTo`/`tracksEvent` |
| `PUT /orders/statuses/reorder` | Bulk renumber `sortOrder` from a drag-reorder |
| `DELETE /orders/statuses/:id` | NO-TRASH delete: deactivate when referenced, hard-delete when not |

**Server-side invariants (minimal — the admin owns the outcome, EPIC §1):**
- exactly ONE active `isInitial` pipeline status (reassigning moves it);
- `sortOrder` unique among pipeline rows; disruptive rows keep it `NULL`;
- **can't deactivate/delete a status orders currently sit in** → `409` with the count (it would
  strand them); referenced only by history → soft-deactivate;
- `appliesTo ∈ {ALL,RENTAL,SALE}`, `inventoryHold ∈ {NONE,WINDOW,OUT}`, `tracksEvent ∈
  {DELIVERY,COLLECTION,null}`, `colorKey ∈` the palette (`STATUS_COLOR_KEYS`), per-status evidence
  counts inside the global bounds;
- **reorder renumbers 1..N in a transaction via a temporary negative pass** — `@@unique(sortOrder)`
  trips otherwise on any swap.

**⚠️ The one thing that must not be forgotten:** every write calls
`invalidateStatusCatalog()` **and** the frontend drops/invalidates its `/orders/catalog` cache.
The engine memoizes the catalog per process; the 60s TTL (`appConfig.statusCatalogTtlSeconds`) is the
safety net for out-of-band edits (a seed, another Cloud Run instance) — an in-app edit must feel
immediate, not "within a minute".

**UI:** a Preferences → "Estados del pedido" screen following the entity-form doctrine — a
reorderable list (reuse `useGalleryDrag` + the pure `galleryReorder` geometry), add/edit via RHF +
mirrored Zod, palette picker fed by `STATUS_COLOR_KEYS` (`statusTone.ts` is already the single
token→classes map), evidence toggle + optional per-status counts, `appliesTo` selector, deactivate
with the strand-check surfaced as an inline conflict. Copy under
`modules.panel.preferences.statuses.*`.

**Put on the same screen while you're there:** the evidence **retention** control (§6b) — months +
a "what would be freed" preview — since it's the same audience and the same preferences table.

**Doors this screen makes visible (still not built):** branching flows (a
`service_status_transitions` table swapped in behind `resolveTransitions`), per-status notification
subscribers on `advance()`'s post-commit hook, and a scheduled retention job.

## 13. Concrete current-code touch-points (grounding, so nothing's missed)

- **Schema/seed:** `prisma/schema.prisma` (ServiceStatus), `prisma/seed.ts` (§3.5), new migration.
- **Backend behavior swaps:** `products.service.ts::buildRentedNowWhere` (holdsInventory);
  `models/enums/serviceStatusEnum.ts` (anchor-only comment); `orders/orders.service.ts` (projections
  + include), `orders/orders.controller.ts::getOrdersCatalog` (flags/colorKey), `orders.models.ts`
  (status model + projections), plus new `lifecycle/`, `advance/`, `statuses/` modules.
- **Frontend swaps:** `orders/order.types.ts` (status flags + nextStatus), `orders/OrderTicket.tsx`
  (`STATUS_TONES` → colorKey map), `orders/orderDayGroups.ts` (`nextStepKey` → data-driven), new
  advance + statuses hooks/UI. `OrderTicket`/`OrderTicketSkeleton` responsive (done).
- **Cross-cutting:** OpenAPI (`docs/openapi.*` + `openapi.test.ts` list), i18n (`es-GT/translation.json`,
  app `es.json`), memory (`epic-2-orders-plan.md`), and this doc kept as the source of truth.
```
