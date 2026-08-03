# EPIC-2 — Driver availability & the logistics pad

**Status: BUILT (2026-07-30), except the calendar (§6, deferred with notifications).** Read this
before touching spacing, assignment, the availability probe, or the `.ics` export. It supersedes
nothing; it *reframed* the rule `buildSpacingConflictWhere` used to implement — and that reframing
is the whole point.

> **What shipped.** `ozari-api/src/modules/orders/logistics/` is the engine: `logisticsEvents`,
> `pendingLogisticsEvents` (the OCCUPANCY rule — **§4.5**, added 2026-07-31), `padMinutesFor`,
> `maxPadMinutes`, `eventsOverlap`, `buildDriverConflictWhere`, `refineConflicts`,
> `selfOverlap`, `findDriverConflicts`, `assertDriverAvailable`, `projectDriverAvailability`, and the
> two errors (`OrderDriverConflictError` / `OrderSelfOverlapError`). `buildSpacingConflictWhere` and
> `OrderSpacingConflictError` are **gone** — do not reintroduce a global variant. Create and edit call
> `assertDriverAvailable` where the old spacing probe stood (inside the transaction, after the product
> locks, before any write); `POST /orders/availability` answers both halves on one request; the order
> form lands driver errors on the DATE inputs (never on a line) and offers "Ver pedido".
>
> **Answers (owner, 2026-07-30):** **Q-D1 → per DRIVER.** Two drivers may legitimately be in two
> places at the same minute; if the van is the real constraint, that is the vehicles door, not this
> rule. **Q-D2 → the assignee is REQUIRED** at the validator; "unassigned" is deleted rather than
> modelled. **Q-D3 → the calendar is NOT built here**; §6 is the contract it must honour when it is.

Sibling docs: `EPIC-2-ORDERS.md` (§6b is the feasibility audit this grew out of),
`EPIC-2-ORDER-LIFECYCLE.md` (the status machine).

---

## 0. The problem in one paragraph

Today the system enforces "at least N minutes between any two logistics events, anywhere in the
business". That is a *global* rule with no owner: it silently assumes one vehicle and one driver. The
owner's framing is different and better — **the constraint belongs to a DRIVER**, each event occupies
a chunk of that driver's day, and how big the chunk is depends on things we do not model yet
(distance, whether the van is being emptied or filled, how many stops fit in one trip, which vehicle).
The MVP number stays the same (one hour between events), but the *shape* has to change now, because
the shape is what decides whether multi-driver, vehicles, capacity and routing are additive or a
rewrite.

---

## 1. The reframing (the single most important decision here)

**From:** "there must be a gap of N minutes between two orders' events."
**To:** "every logistics event OCCUPIES a block of its driver's time; two blocks on the same driver may
not overlap."

```
        13:30        14:00        14:30        15:00
          |------------|------------|            |          ← order A delivery @14:00, pad ±30
                                    |------------|------------|   ← order B delivery @15:00, ok
```

- An event's block is `[at − padBefore, at + padAfter]`.
- MVP: `padBefore = padAfter = 30 min` ⇒ any two events on one driver must be ≥ 60 min apart.
  **Numerically identical to today.** Semantically, it now has a resource and a reason.
- A block is not only a conflict rule: it is also **exactly the calendar event** we export
  (`DTSTART = at − padBefore`, `DTEND = at + padAfter`). One concept, two consumers — see §6.

Why this shape opens every door the owner listed:

| Future capability | What changes | Cost |
|---|---|---|
| More drivers | the resource id in the `where` | free (already scoped) |
| Vehicles & capacity | resource becomes the vehicle; capacity is a SECOND predicate over a trip's lines | additive |
| Distance-aware gaps | `padFor()` takes the neighbour and returns travel time | additive (see §5) |
| Deliver-then-collect is cheaper | `padFor()` reads both events' KINDS | additive |
| One trip, many stops | events sharing a trip are exempt from the overlap test | additive |
| Per-event-type gaps | `padFor()` reads the event type / status row | additive |

None of these require touching the call sites, the transaction script, or the schema — **provided §5
is respected.**

---

## 2. Owner decisions (2026-07-30)

1. ✅ **Calendar (`.ics`) and notifications are now IN the MVP cut** (they were on the defer line).
   Implemented in a later session; this doc only fixes the contract they depend on.
2. ✅ **MVP gap = 1 hour between any two events of the same driver**, expressed as ±30 min of padding
   per event.
3. ✅ **"Add to calendar" defaults to ON** for a new order; the event is created with the order.
   Create/update/delete of calendar events must be possible (⇒ stable `UID` + `SEQUENCE`, §6).
4. ✅ **The rule is about the DRIVER, not the products.** Error copy, endpoints and field placement
   must never mix the two. A product conflict is "we don't have the units"; a driver conflict is "we
   can't be there".
5. ✅ **Keep one admin-facing setting.** The screen keeps saying "Minutos entre eventos" (60). The pad
   is derived (`gap / 2`) — see §4.1. Adding a second, half-sized knob would be a worse screen for the
   same generality.
6. 🔓 **Doors that must stay open** (not built, must not become harder): multiple drivers, vehicles +
   capacity + fee multipliers, trips with several stops, distance-based gap shrinking, per-event-kind
   gaps, client self-service seeing availability without seeing the business's internals.

---

## 3. What existed BEFORE this epic (kept for the reasoning; the code has moved)

- `buildSpacingConflictWhere(events, spacingMinutes, excludeServiceId?)` in `orders.service.ts` — a
  **pure function returning a Prisma `where`**. Symmetric ± window per event, exclusive bounds
  (exactly N apart is allowed), skips cancelled and inactive orders. **Not scoped to a driver.**
  → **Now `logistics/buildDriverConflictWhere` + `refineConflicts`.**
- Called from exactly two places, both inside the transaction, both after the product locks:
  `createOrder` and `updateOrder` (the latter passing `excludeServiceId`).
  → **Still exactly those two places, now calling `assertDriverAvailable`.**
- `timing.spacingMinutes` comes from `loadOrderTimingPreferences` → the `orders.logisticsSpacingMinutes`
  preference (default 60), never a literal.
- Conflicts throw `OrderSpacingConflictError(conflictingDeliveryAt)` → a 409 carrying only the other
  order's delivery time.
- `assignedUserId` is **optional in the body but never null in practice**: the controller defaults it
  to the creating admin, and the validator requires an ACTIVE user in `ASSIGNABLE_ROLES` (Admin +
  Driver). The order form defaults the picker to the current user.
- `POST /orders/availability` exists and is **Admin-only**: takes a window + product ids, returns
  per-product availability. It does NOT know about drivers.
- The FE surfaces a stock 409 by mapping `data.conflicts` onto the offending line's quantity field.

### 3.1 A hole this reframing exposes (CLOSED 2026-07-30 — `selfOverlap`)

On CREATE, the new order's own two events are never compared **to each other** — the order does not
exist in the table yet, and on EDIT it is explicitly excluded. So an order with a delivery at 14:00 and
a collection at 14:15 passes today. Physically the same driver cannot do both. **Fix it in this
epic** (a pure in-memory check before the query; see §4.2 step 3).

---

## 4. MVP scope

### 4.1 The setting

Keep `orders.logisticsSpacingMinutes` (admin-facing, "Minutos entre eventos", default 60). Introduce
**no new preference key.**

```ts
/** Half the configured gap, applied on EACH side of an event — so two events need the full gap
 *  between them. One setting, because an admin thinks in "an hour between deliveries", not in pads. */
const padMinutesFor = (_event: LogisticsEvent, gapMinutes: number): { before: number; after: number };
```

It takes the event **today already**, and returns an object, **today already** — even though both
numbers are `gapMinutes / 2` and the argument is unused. That signature is the door: per-kind,
per-event-type and distance-aware pads all arrive as changes to this one function's body.

> Odd gaps: a 45-minute setting yields 22.5 per side. Round the *pad*, never the gap, and round UP so
> the effective distance is never less than what the admin asked for.

### 4.2 The rule

New module `ozari-api/src/modules/orders/logistics/` (sibling to `lifecycle/`), because this is a
second cross-cutting engine and `orders.service.ts` is already the busiest file in the module.

1. `logisticsEvents(order): LogisticsEvent[]` — `{ at, kind: 'DELIVERY' | 'COLLECTION' }` from
   `deliveryAt` / `pickupAt`. ONE place that knows an order's events, so per-EVENT assignment (the
   fork recorded in EPIC-2-ORDERS §6b) later changes only this.
2. `buildDriverConflictWhere(events, { gapMinutes, driverId, excludeServiceId? })` — today's builder
   **plus `assignedUserId: driverId`**, and widened by the MAXIMUM pad (§5).
3. `selfOverlap(events, gapMinutes)` — the §3.1 fix, pure, no query.
4. `refineConflicts(candidates, events, gapMinutes)` — the code-side pass (§5). Today it returns
   candidates unchanged; it exists so that tomorrow it doesn't have to be invented under pressure.

Call sites stay exactly where they are: inside the transaction, after the locks, before the writes.

### 4.3 The endpoint

Extend `POST /orders/availability` rather than adding a sibling — it already receives the window, and
the form needs both answers on the same keystroke.

```jsonc
// request  += { "assignedUserId": 3 }
// response += {
//   "driver": {
//     "available": false,
//     "conflicts": [{ "orderId": 42, "at": "2026-08-01T20:00:00Z", "kind": "DELIVERY" }]
//   }
// }
```

- `assignedUserId` optional; absent ⇒ the `driver` block is omitted (the FE simply has nothing to say
  yet).
- **Admin tier only.** The projection MUST go through a `projectDriverAvailability(actor, …)` function
  from the first commit, mirroring `projectOrder*`. A future client tier returns `{ available }` and
  nothing else — no order id, no time, no name (§7).
- Advisory only. The 409 raised under the transaction lock stays the authority; the probe exists to
  stop the admin filling a form that cannot be saved.

### 4.4 The frontend

**When to check** (`OrderForm`, create and edit):
- on the assignee select changing,
- on `deliveryAt` / `pickupAt` changing (debounced with the existing product probe — one request),
- always again on submit, by way of the server's 409.

**Where the error lands** — this is the part that must not be borrowed from the stock flow:

| Conflict | Field | Tone |
|---|---|---|
| Product stock / rental availability | the line's quantity input | "no hay unidades" |
| Driver availability | the **delivery / pickup date-time inputs**, plus the form banner | "no podemos estar ahí" |

A driver conflict is never a line-level error. Reusing `data.conflicts` for it would be the single
easiest way to make this confusing.

**Copy** (es-GT, professional, short — new `orders.driverAvailability.*` namespace, NOT under the
stock keys):

| Case | Message |
|---|---|
| Probe, conflict found | `Ese horario se cruza con otro evento de {{driver}} a las {{time}}.` |
| Probe, conflict + admin can see it | + a link: `Ver pedido` |
| Save rejected (409) | `No fue posible guardar: {{driver}} ya tiene un evento a las {{time}}. Debe haber al menos {{gap}} entre entregas y recolecciones.` |
| The order's own two events collide (§3.1) | `La entrega y la recolección de este pedido están demasiado cerca. Deja al menos {{gap}} entre ambas.` |
| No driver chosen yet | *(nothing — never nag about a field the admin has not reached)* |

`{{gap}}` is formatted from the preference ("1 hora", "45 minutos"), never hardcoded — the admin can
change it, and copy that lies about a configurable number is worse than copy that omits it.

### 4.5 OCCUPANCY — how long an event holds its driver (✅ owner decision, 2026-07-31)

The pad says how BIG a block is. This says how long it EXISTS:

> **An event occupies its driver's time from the moment it is scheduled until the moment it actually
> HAPPENS — or never at all, if the order was cancelled.**

`pendingLogisticsEvents(order)` is the single predicate, and it is deliberately used on **both**
sides of the comparison:

- the order being **saved** is checked only for what it still has to perform, so editing a cancelled
  or finished order asks the driver's day for nothing and can never 409;
- a **candidate** blocks only with what it still has to perform, so a driver's completed morning
  does not reserve their afternoon.

It reads the lifecycle's **actuals** (`deliveredAt` / `collectedAt`), never a status id — and a
rewind clears the actual it stamped, so a mistaken tap that is corrected re-occupies the day by
itself. A half-finished rental is the interesting case and it comes out right for free: the delivery
is history, the collection is still a promise, so exactly one block is checked.

**Why this is the right shape, not a special case.** The stock rules already said the same thing in
their own vocabulary (`holdsSaleStock`, `inventoryHold` → `holdsRental`/`holdsSale`): *an order that
reserves nothing is not competing with anyone.* The pad was the only rule that hadn't been told. The
owner's framing settled it (2026-07-31): a cancelled or completed order isn't taking availability of
any kind, so **no availability of any kind is checked for it** — goods or driver.

Three things this closed, all of which shipped in the same pass:

1. The **sale** branch of the edit checked the shelf even when the order held nothing — refusing a
   correction that moves no stock whatsoever. It now `continue`s, symmetric with the rental branch.
2. `POST /orders/availability` never passed `excludeOrderId` to the **goods** half (only the driver
   half), so the probe answered a stricter question than the save: an edit competed with its own held
   units, and the "adjust to available" reconcile silently shrank the admin's own quantities.
3. The **form** enforced caps that the server had stopped enforcing — `max` on the quantity input,
   the availability hint, the resolver's line errors and the reconcile. All four now hang off
   `order.holdsInventory`, the fact the API already publishes for the delete dialog.

The frontend mirrors it with ONE flag (`enforcesStock`) and no new endpoint field: the driver half
needs nothing at all, because the probe itself answers "free" for an order that occupies no day.

### 4.6 Out of scope for this epic

Trips, vehicles, capacity, distance, auto-assignment, client-facing availability. §5 is what earns the
right to add them later without a rewrite; none of them get built here.

---

## 5. THE structural rule (the thing that prevents a refactor)

A symmetric constant pad can be expressed as one SQL `where`. **A pad that depends on the PAIR of
events cannot** — the database would have to know the travel time between two addresses.

So the shape, from the first commit:

```
1. SQL selects CANDIDATES using the MAXIMUM possible pad   ← always over-selects, never under-selects
2. a PURE function decides which candidates actually conflict
```

Today the maximum pad *is* the only pad, so step 2 is the identity and costs nothing. Tomorrow, when
`padFor()` can return 12 minutes for a nearby collection and 50 for a cross-town delivery, step 1
widens by the 50 and step 2 filters — **the same two functions, the same call sites, no schema
change.**

If instead the conflict were written as a single clever `where` and nothing else, the first
distance-aware rule would force every call site, the probe, and the transaction script to be rewritten
at once. That is the refactor this rule exists to prevent.

Corollaries:
- **Never inline the gap.** It is a preference, and soon a function.
- **Never let a conflict rule leak into a controller** (already the standing rule, EPIC-2-ORDERS §6b).
- `refineConflicts` takes the candidate ROWS, not ids — so a later `tripId`, vehicle, or geo column is
  a filter inside it, not a new query. **Do not add those columns now**; the point is that adding them
  later touches one function.

---

## 6. How this feeds the calendar (`.ics`)

The block IS the event. When the calendar slice is built:

- `DTSTART = at − padBefore`, `DTEND = at + padAfter`. Back-to-back orders therefore *show* the
  one-hour rule as touching blocks in the driver's calendar — the logistics constraint becomes visible
  in a tool they already use.
- Stable `UID` per event (`order-{id}-delivery@partyrentalsgt.com`) + an incrementing `SEQUENCE`, so a
  re-import after a reschedule UPDATES the entry instead of duplicating it. This is what makes the
  owner's "create / update / delete events" possible at all with plain `.ics`.
- Deleting = re-issuing the same `UID` with `STATUS:CANCELLED`.
- MVP mechanism: per-order download (exact, no auth surface). A subscribable feed needs a capability
  URL (calendar clients send no auth header) and is cached for hours by Google — evaluate later.
- Timezone `America/Guatemala`; a purchase-only order has no collection event.

---

## 7. Client tier (NOT built — recorded so we do not make it harder)

When client self-service lands (EPIC-2-ORDERS §11), a client changing their dates needs to know
whether *anyone* can serve them — without learning anything about the business.

- The check becomes "is ANY assignable driver free for this window", not "is driver X free".
  `buildDriverConflictWhere` already takes a driver; the pool version is a `driverId: { in: [...] }` —
  additive.
- A client is told **only**: `Ese horario no está disponible. Elige otro.` — optionally with the
  nearest free slots. Never a name, never an order, never a count, never "we only have one driver".
- This is the same doctrine as product availability confidentiality (§10.C): reveal only what the
  actor is ordering. Enforce it through the projection function from §4.3, so the client tier is a new
  branch in ONE place rather than a new endpoint that forgets the rule.

---

## 8. Build order for the session

1. **Read** this doc, EPIC-2-ORDERS §6b, and `orders.service.ts`'s spacing section.
2. `logistics/` module: `logisticsEvents`, `padMinutesFor`, `buildDriverConflictWhere`, `selfOverlap`,
   `refineConflicts` + unit tests (pure functions — cheap, high value).
3. Wire into `createOrder` / `updateOrder`, replacing `buildSpacingConflictWhere`. Keep the old export
   only if something else uses it (it should not — verify).
4. Fix §3.1 (self-overlap) with its own error + copy.
5. Widen `OrderSpacingConflictError` into a driver-conflict error carrying `{ orderId, at, kind,
   driverName }` (EPIC-2-ORDERS §6b already flagged the thin payload).
6. Extend `POST /orders/availability` + `projectDriverAvailability`; update the OpenAPI docs and the
   `openapi.test.ts` expected list in the SAME commit.
7. Frontend: probe on assignee/date change, errors on the date fields + banner, new i18n namespace.
8. Update `CLAUDE.md` (the orders bullet) and this doc's status line.

Definition of done: both suites green at 100%, lint + build clean, OpenAPI updated, and a second
driver provably does NOT block the first (the test that proves the reframing did something).

## 9. Questions — ANSWERED (owner, 2026-07-30)

- **Q-D1 — scope: per DRIVER.** ✅ Two orders for the same driver at the same minute stay impossible;
  two orders for *different* drivers at the same minute are now allowed. This is the epic's one real
  behaviour change, and it only appears once a second assignable user exists. If the vehicle turns out
  to be the binding constraint, that is the vehicles door (`buildDriverConflictWhere` takes a resource
  id — it becomes a `vehicleId`), not a reason to keep a global rule.
- **Q-D2 — the assignee is REQUIRED.** ✅ `parseOrderBody` rejects a body without one, so the "order
  with no driver" case is deleted rather than modelled. The API no longer defaults it to the creating
  admin; the form has always sent it, and an edit sends the order's current assignee back (so saving
  an untouched form is not a silent reassignment, while changing the picker moves the order **and**
  re-checks the new driver's day).
- **Q-D3 — calendar: NOT in this slice.** ✅ It lands with notifications. §6 is the contract that slice
  must honour; the pad it needs (`padMinutesFor`) already exists and already returns per-side values.

## 10. What a future slice must not undo

- **`ServiceStatusEnum`-style temptation, logistics edition:** never re-express the rule as one clever
  `where`. SQL widens with the maximum pad, `refineConflicts` decides (§5). The two functions are
  already shaped for a pad that depends on the PAIR of events; a "simplification" that merges them is
  the refactor this epic exists to prevent.
- **Never surface a driver conflict through the stock plumbing.** `data.conflicts` is the stock 409;
  `data.driverConflict` / `data.selfOverlap` are these. Different fields, different i18n namespace
  (`modules.panel.orders.driverAvailability.*`), different copy.
- **The client tier goes in `projectDriverAvailability`,** as a branch — never as a second endpoint.
- **The gap is a preference.** `gapLabelKey` formats it for copy; nothing anywhere says "1 hora".
- **Never check availability — of any kind — for an order that reserves nothing** (§4.5). The three
  places that must agree are the save (`holdsRental`/`holdsSale` + `pendingLogisticsEvents`), the
  probe (`excludeOrderId` drops the order from BOTH counts and its actuals decide what it still
  occupies) and the form (`enforcesStock` from `order.holdsInventory`). A new cap added to any one
  of them without the other two re-creates the bug: a form that refuses what the server accepts.

### 10.1 Known gap, deliberately left (2026-07-30)

**Reopening a cancelled order does not re-check the driver's day.** `POST /orders/:id/advance`'s
reopen leg re-checks GOODS (`reclaimOrderStock` — the units may have been promised to someone else
meanwhile) but not the pad, exactly as the old global spacing rule didn't either. So an order
cancelled and then reactivated can land on a driver who has since been booked at that hour. The fix is
one call to `assertDriverAvailable` inside the reopen transaction with the order's own id excluded,
answering the same `409` — deliberately not done in this slice, because it changes the advance
contract (a new refusal on a button that today only ever fails on stock) and that deserves its own
copy decision: what the dialog should say *before* the admin presses it.

The occupancy rule (§4.5) sharpened this rather than closing it: reopening is precisely the moment a
cancelled order's events become pending again, so it is exactly where `pendingLogisticsEvents` would
be consulted — `assertDriverAvailable(tx, pendingLogisticsEvents(reopened), { …, excludeServiceId:
order.id })`, one call, with the dialog told the consequence beforehand the way `inventoryEffect`
already tells it about goods.
