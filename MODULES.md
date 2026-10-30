# Ozari — module reference (what exists today)

Per-module state of the built product: what is live, and the rules that live nowhere else. Deep
rationale for a module with an epic file stays in that epic — this file points at it and keeps only
what a change must not break.

**Read order:** `CLAUDE.md` (conventions + tripwires) → this file (the module you are touching) → the
epic named in that section (before any structural change).

| Module | Code | Deep doc |
|---|---|---|
| Products | `ozari-api/src/modules/products/`, `ozari-app/src/modules/panel/products/` | `EPIC-1-INVENTORY.md` |
| Orders | `…/modules/orders/`, `…/panel/orders/` | `EPIC-2-ORDERS.md` |
| Order lifecycle | `…/modules/orders/lifecycle/` | `EPIC-2-ORDER-LIFECYCLE.md` |
| Logistics pad | `…/modules/orders/logistics/` | `EPIC-2-DRIVER-AVAILABILITY.md` |
| Maps & navigation | `…/utils/mapLinks.ts`, `components/LocationPicker.tsx` | this file (§4) |
| Dashboard | `…/modules/dashboard/`, `…/panel/dashboard/` | this file (§5) + `EPIC-2-ORDERS.md` §6e |
| Documents (PDF) | `…/panel/documents/` | `EPIC-2-DOCUMENTS.md` |
| Calendar | `…/modules/calendar/`, `…/panel/settings/` | `EPIC-2-CALENDAR.md` |
| Preferences | `…/modules/preferences/`, `…/panel/preferences/` | this file (§8) |

---

## 0. Cross-module rules these all obey

- **NO-TRASH deletion policy** (owner decision 2026-07-15, repo-wide): nothing tombstones unless
  referenced history demands it. Hard-delete when nothing references the row; soft-delete
  (`isActive: false`) only when order/audit history points at it. Seeded lookups' `isActive` is a
  *publication flag*, never a deletion marker. `users`/`services` legitimately soft-delete. Pure
  attribute rows (phones, addresses, contacts) follow the conditional rule.
- **Declarative full-state updates.** Products, orders and client registries all update by sending the
  entity's FINAL state; the server diffs it in one `$transaction`. Never build a per-movement
  endpoint. Create and update share ONE parsed body contract so the two doors cannot drift.
- **Role projections are the single source of tiering.** Widen an Admin-only guard only together with
  the row scoping for the role being admitted.
- **Pagination is congruent at 20/page** across products AND orders (`PRODUCTS_PAGE_SIZE`,
  `defaultProductPageSize`, `defaultOrderPageSize` — keep them aligned).

---

## 1. Products — COMPLETE

`GET /products` (paginated, **role-projected** reads — `products.service.ts` `projectProductForRole`;
**Admin + Client only** since EPIC-2A: role 3 is a **Driver** ("Repartidor", renamed from "Empleado",
`RolesEnum.Driver`) who gets a **403 on every products read**, and the old Employee availability tier
(`inStock`+`available`) was DELETED from the projection — Admin-only now. The base projection carries
the lookup **ids** (`businessTypeId`/`categoryId`/`rentTimeUnitId` + per-detail `detailTypeId`) —
public reference data the edit form prefills from).

- `GET /products/catalog` — the five seeded lookups the create/edit form's selects need; same
  Admin+Client guard.
- `POST /products` — Admin-only create + nested details + gallery images. The validator enforces the
  **conditional price rule**: Alquiler → `rentPrice` + `rentTimeUnit`; Venta → `sellPrice` only.
- `PUT /products/:id` — Admin-only **declarative full-state update, the RECONCILE design** (owner
  decision 2026-07-13): the client stages every gallery/detail movement locally and on save sends the
  FINAL state — kept gallery photos by `id`, new by uploaded `key`, exactly one of id/key per slot,
  one primary, array order = `sortOrder`; detail rows keep/update by `id`, create without, absent rows
  delete. `applyProductUpdate` diffs it in ONE `$transaction`; removed R2 objects are deleted
  best-effort only AFTER commit; a kept id that vanished mid-save = a clean **409** conflict.
- `POST /products/images/upload-url` — Admin-only presigned R2 PUT mint. The browser uploads photos
  straight to R2, then references the keys in the create/update body; the server derives the public
  URL from the key, **never trusting a client URL**. The R2 bucket needs the CORS policy in
  `DEPLOYMENT.md` §3b.
- `DELETE /products/:id` — Admin-only, the conditional NO-TRASH rule: the row soft-deletes
  (`isActive: false`) ONLY when `service_details` (order history) reference it, otherwise it
  hard-deletes. Its `product_details`/`product_images` rows hard-delete EITHER WAY (their `is_active`
  columns were dropped — migration `20260715000000_products_drop_gallery_tombstones`) and the
  gallery's R2 objects are removed post-commit in ONE batched call (`storage.deleteObjects`).
  The response says WHICH branch happened: `data.outcome` = `deleted` | `deactivated` (2026-10-29).
- **`securityDeposit`** (refundable deposit per unit, owner 2026-10-27): optional, Alquiler-only,
  `≤ replacementPrice` when both set (`securityDepositViolation`, shared by both validators). In the
  BASE projection (every role — a commercial condition like the price). Create and update write the
  scalars through ONE mapping, `productScalarData`.
- **Catalog order:** `GET|PUT /products/display-order` (Admin) — the full ordered list of ACTIVE ids,
  renumbered 1..N in one transaction (only changed rows written; a list that isn't exactly the active
  catalog = `409`). `display_order` 0 = never placed → leads the grid; all zeros = the old
  newest-first order (no backfill). `sort=catalog` is the list default.
- **Cross-environment copy:** `infrastructure/scripts/sync-products.ps1` (MERGE, dry run first —
  `EPIC-1-INVENTORY.md` §5; variation matching per §3b).

### Variations — backend (2026-10-29, migration `20261029000000_product_variations`; decision record `EPIC-1-INVENTORY.md` §3b)

- **Model.**
  - `product_options` → `product_option_values` (each value has its own photo set:
    `product_images.option_value_id`, NULL = the product's SHOWCASE).
  - `product_variants` = the OFFERED combinations: own `quantity`, nullable override columns
    (NULL = inherit), `is_default`, and `combination_key` = sorted value ids joined by `.`, unique
    per product. The join table is `product_variant_values`.
  - A variant product stores `products.quantity = 0`, and nothing reads it for availability.
- **Body.**
  - POST and PUT share ONE parser, `products.variations.ts` `parseProductVariations` (pure,
    coverage-held), with keys under `products.variations.validators.*`.
  - Values carry a client `key`, and variants reference values only by key.
  - `quantity` is required without options and forbidden with them (`quantityWithVariants`).
  - Every id is forbidden on create.
  - Limits live in `appConfig`: 3 options, 20 values, 60 variants, 4 photos per value, 8 showcase
    photos, 40 in total. The upload-url per-call cap is the 40.
  - Names use `variationNameRegex` (1–40 chars; the app mirrors it).
  - **The two routes parse up to 32kb** (`productWriteBodyLimit`; AUTH-AND-SECURITY §1).
- **Create** runs in ONE `$transaction` (`applyProductCreate`) through the same writers as the update.
- **Update** reconciles in the existing transaction (`applyProductUpdate(tx, id, body, holding)`), in
  this order:
  1. Scalars (they take the row lock).
  2. In-transaction id re-checks.
  3. The 409 guards.
  4. Options, then values.
  5. EVERY photo set at once (a photo may move between sets).
  6. Variants, with a two-phase key write (`tmp:<id>`, so swaps are safe).
  7. Leaving variants: referenced by any line → TOMBSTONE (`isActive`/`isDefault` false, key
     `retired:<id>`), else hard delete.
  8. Removed values, then removed options.
- **409s**, via `buildHoldingLinesWhere(holding)` in `orders.service.ts`:
  - `variantInUse`: the save drops a variant that open or future orders hold. `data.conflicts` =
    `[{ variantId, label, orderIds }]`.
  - `stockModeInUse`: the save adds the first options, or removes them all, while holding lines use
    the vanishing pool. Carries `data.orderIds`.
- **Projection** (`projectProductForRole(product, role, { rentedNow, usage })`):
  - `images` is the showcase only.
  - `coverImageUrl` = the showcase primary, else the DEFAULT variant's value photo. The arrangement
    tiles use it too.
  - `options[]`, and `variants[]` with the ACTIVE variants in canonical order (`describeVariants`).
    Each has `valueIds`, `label` "Rojo · Redondo", exactly one `isDefault`, EFFECTIVE prices,
    deposit and description, and `imageUrl` (its first value in option order with photos, else the
    showcase).
  - Admin adds per variant: `quantity`, `available`, `inStock`, `total` (Alquiler), the effective
    `replacementPrice` and raw `overrides`. On `GET /products/:id` and the PUT response it also adds
    `usage: { lines, holding }` (`loadVariantUsage`).
  - The product-level Admin stock is Σ over the variants.
  - Rented-now is grouped by `["productId","variantId"]` and keyed by `stockKey`.
  - The PUT response adds `variantOutcome: { retired, deleted }` only when it removed a variant.
- **Delete** (product): every photo set, details, options and values are hard-deleted; referenced
  variants tombstone and the rest are deleted.

### Frontend

- The whole products SECTION is role-gated: `PRODUCTS_ROLES = [Admin, Client]` in `navConfig.ts`
  drives the sidebar tab AND the `/panel/productos*` route guards (a Driver is bounced to
  `/panel/ajustes`; bare `/panel` lands via `panelHomeFor(role)`). Product cards/detail carry
  **Client-only** consumer CTAs — the old Employee/Admin "Ordenar" action is GONE (the admin's
  order-on-behalf flow is the order form).
- Create is `/panel/productos/nuevo`, edit is `/panel/productos/:id/editar` (`ProductEditPage` →
  `ProductForm mode="edit"`, behind the route's Admin guard). Both share `ProductForm` +
  `ProductImageGallery` / `useGalleryImages` / `useProductImageUploads`.
- The gallery supports **pointer drag-to-reorder** (`useGalleryDrag` + the pure `galleryReorder.ts`
  geometry — the card itself moves; `<img draggable={false}>` on purpose, the native phantom-image
  drag used to re-add the photo as a duplicate).
- **Catalog order** is `/panel/productos/ordenar` (`ProductArrangePage`, Admin-only route guard,
  entered from the list header's "Organizar" button — arrange, not the retired purchase CTA). One
  tile grid over `GET /products/display-order`, reordered three ways: pointer drag (the SAME
  `useGalleryDrag`, generalized to any `{ id }`), the tile's ‹ › buttons, and the keyboard on the
  focused tile (arrows / Home / End, announced through an `aria-live` region). Moves are a local
  draft (`productArrangement.ts`); "Guardar orden" sends the FULL ordered id list in ONE
  `PUT /products/display-order` (declarative full-state — no per-move endpoint). Never-placed
  products lead the grid with a "Nuevo" badge, and their presence alone enables save. A **409** (the
  active set changed underneath) swaps "Descartar cambios" for "Recargar catálogo"; a background
  refetch reconciles the draft (vanished ids drop, arrivals are prepended).
- The list's default sort IS that order: no `orden` param = "Destacados" (API sort `catalog`);
  "Más recientes" is the explicit `orden=recientes`.
- **Security deposit** (`securityDeposit`, per unit): an optional `decimalInput` beside "Precio de
  reposición", Alquiler-only (switching to Venta clears it, like the rent fields). The Zod mirror
  holds the API's rules — money in [0, 1,000,000], forbidden for Venta, ≤ the replacement price
  (`deps` re-checks it when the replacement changes). The edit form prefills it and sends it back
  (full-state save). Copy (owner 2026-10-27): the label is just **"Depósito"**, and BOTH hints say
  "Por unidad." first (deposit: given back at pickup if all returns in good shape; replacement: what
  each lost/broken unit costs); the detail page labels both "(por unidad)".
- **Variations** (2026-10-29; the pure rules live in `productVariations.ts`, the one
  name/label format too — `lineDisplayName` "Mantel — Rojo · Redondo"):
  - The form's **Variaciones** section (`ProductVariationsEditor`, a section of the page, never a
    modal) edits options + values in place (‹ › / ˄ ˅ reorder: option order = label order AND photo
    precedence) and lists every combination; the admin OFFERS the ones that exist (checkbox) and
    marks one default (radio). An offered row has its own stock and optional overrides whose
    placeholders show what it inherits. Adding a value offers the combinations it creates (an
    option's first value completes every existing variation); "Ofrecer todas" fills up to the cap.
    With options the product's single quantity steps aside (`quantityManaged`).
  - Form state carries `options` (values keyed `v<id>` saved / `n<k>` new) and `variants`
    (referencing values by key set); `productToFormValues` reads the RAW `overrides`, never the
    effective values, or the first save would freeze today's product price onto every variation.
    A type switch clears the overrides of the side it leaves (the API's `variantPricingMismatch`).
  - Each option VALUE has its own compact photo set (`useGalleryImages(…, { maxCount: 4 })`,
    registered by value key); submit uploads the showcase and every value set in ONE presign
    (`uploadImages(...sets)`) after checking the 40-photo product total.
  - Removal copy is the SERVER's `usage`: a saved variation with `holding > 0` cannot leave (its
    checkbox and every value/option removal that would drop it are disabled with the reason);
    `lines > 0` says it will be retired, none says deleted; no `usage` says nothing. A withdrawn
    saved row is parked and comes back with its id/stock if re-offered. The 409s
    `variantInUse` / `stockModeInUse` name the variations and orders (`PED-…`) in the banner; a PUT's
    `variantOutcome.retired` toasts and never enters the cache.
  - The card shows `coverImageUrl` (showcase primary, else the default variation's photo) and
    "Desde Q…" when the offered variations' prices differ (`formatHeadlinePrice`); its stock is the
    server's Σ. The detail page adds option chip pickers: a pick changes WHICH photos the 3:4 hero
    shows (`photoSetFor`: first picked value with photos → showcase → with nothing picked and no
    showcase, the default variation's photos), never the frame; a complete pick shows that
    variation's price/deposit/replacement/stock/description, an unoffered combination says so.
- Edit deliberately has **no sessionStorage draft** (server state is the source of truth; a stale
  draft would resurrect old values).
- Delete is `ProductDeleteModal` (confirm dialog on the detail page; success drops the detail cache,
  background-refetches the list, exits via the panel transition; a 404 = already gone = success).

---

## 2. Orders — read, create, edit, payment, deposit settlement (Admin) — `EPIC-2-ORDERS.md`

### Schema

Authored 2026-07-16, migration `20260716120000_epic2_orders_schema` (`services` was empty in every
env, so the reshape was safe): `event_types` (with per-type `minLeadHours`), `contact_types`,
`client_registries` + `client_registry_contacts`/`client_registry_addresses` (walk-in clients),
`service_status_history` (append-only audit), `service_evidence` (R2 photo evidence, product_images
pattern), and `app_preferences` (typed key-value, seeded **create-only** — never clobbers admin
edits).

`services` reshaped: `userId` nullable **XOR** `clientRegistryId` (app-layer-enforced — no
hand-written CHECK), encrypted **snapshot** columns (`delivery_contact_kms`, `delivery_address_kms`,
`delivery_coords_kms`, `delivery_instructions_kms` — orders never FK a mutable address;
`addressId`/`userPhoneId` dropped), `pickupAt` **nullable = purchase-only order**, tracking timestamps
(`deliveredAt`/`collectedAt`/`readyAt`), `assignedUserId` (driver), money fields (`deliveryAmount`,
`depositAmount`, `discountAmount`, `discountReason`, `paidAt`), `cancelledAt`/`cancelReason`, plus
agenda/spacing indexes. `service_details.isRental` snapshots rent-vs-sale per line.

### The lifecycle machine — ⚠️ read `EPIC-2-ORDER-LIFECYCLE.md` before ANY status/tracking work

Migration `20260727000000_epic2_order_lifecycle_machine`. `service_status` rows DECLARE their
behavior: `sortOrder` (pipeline position; NULL + `isDisruptive` = an any-time off-ramp), `isInitial`,
`inventoryHold` (`NONE|WINDOW|OUT` — the whole availability rule), `requiresEvidence` +
`minEvidence`/`maxEvidence`, `appliesTo` (`ALL|RENTAL|SALE` — mode-aware completion, so a
purchase-only order ends at Entregado with NO sale-vs-rental branch in code), `tracksEvent`
(`DELIVERY|COLLECTION`) and `colorKey` (a palette TOKEN; the FE owns the classes). Seeded pipeline:
**Pendiente → En ruta → Entregado → Recolectado → Listo** + Cancelado. `Listo` exists because there is
a real **washing period**: **Recolectado still HOLDS the units**, only Listo returns them to the fleet.

- ⚠️ **`ServiceStatusEnum` is SEED ANCHORS ONLY — runtime code must never branch on a status id.**
  Read the flags through `modules/orders/lifecycle/`: `getStatusCatalog` memoizes the table,
  `resolveTransitions`/`transitionKindFor` is the ONE permission matrix (Admin advance/rewind/cancel,
  an assigned Driver advance + cancel-with-reason, nobody else), and `describeActions` projects them.
  `buildRentedNowWhere` / `buildRentedInWindowWhere` read `inventoryHold`; `computeNextActionAt`
  derives from the ACTUALS.
- **`POST /orders/:id/advance` is the single mutating door** for every move (forward/rewind/cancel):
  it locks the row, re-authorises under the lock (409 stale / 403 wrong actor / 422 evidence), writes
  `service_status_history` + evidence rows, and stamps the actuals from the flags. Availability needs
  no write because holds are derived.
- ⚠️ **No dialog may GUESS an inventory consequence** (owner rule 2026-07-28, §6c-bis): the engine
  reports `OrderAction.inventoryEffect` (`release|reclaim|none`, from `inventoryEffectOf` comparing
  `currentHoldings` vs `holdingsAfter`), `OrderAction.purgesEvidence`, and `order.holdsInventory`, and
  the cancel/rewind/delete copy branches ONLY on those — cancelling or deleting an order that already
  finished frees nothing, and the old blanket "sus productos volverán a estar disponibles" was simply
  false. The multi-step jump mirrors the rule in `walkInventoryEffect` (`orderStatusPath.ts`,
  endpoints only); **keep the two in step — new rules go in `inventoryEffectOf` FIRST.**
- Photos go through `POST /orders/evidence/upload-url` (the products R2 presign pattern). Evidence has
  a RETENTION policy — `pnpm purge:evidence` deletes only the photos of finished orders past a cutoff;
  orders and their history are permanent.
- Seeding is **create-only**; `pnpm db:seed:force` deliberately restores defaults.
- The admin **"Estados del pedido" screen (Phase 4) is DEFERRED, not pending** (owner 2026-07-27): it
  belongs to the preferences surface, and the machine is fully editable by re-seeding meanwhile. The
  complete brief (endpoints, invariants, the reorder/unique gotcha, the mandatory
  `invalidateStatusCatalog()` on every write) is **§14 of `EPIC-2-ORDER-LIFECYCLE.md`**.

### Read slice (Admin-only, authenticated rate tier)

`GET /orders` (paginated `view=agenda|history` — history ⇔ `readyAt` set OR cancelled; agenda
soonest-first; optional `statusId`; clamp-never-reject), `GET /orders/:id` (`{ order }` envelope,
decrypted snapshots + lines/extras/status trail, plain 404 on bad/unknown id), `GET /orders/catalog`
(five lookups incl. eventTypes + `minLeadHours`). Widen the Admin-only guard ONLY together with the
Client/Driver row scoping; the `projectOrder*` functions are the future role-tier single source.

### `PUT /orders/:id` — the full EDIT (Admin-only, 2026-07-28)

DECLARATIVE like the products update: the body is the order's FINAL state, validated by the **same
contract as create** (`parseOrderBody`, shared by both validators). The ONE difference is that an
edit's **delivery date is unconstrained** (owner 2026-07-29: "not in the past" is a rule about
scheduling something NEW, and a correction isn't). The pickup-after-delivery rule still holds, and the
FE mirrors it as `updateOrderSchema`.

Everything is re-derived: prices from the product rows + the new billed window; sale stock by the
DIFFERENCE and only while `holdsSaleStock`; rental availability re-checked **excluding this order**
(it holds its own lines and cannot conflict with itself) and only when its status actually holds — a
finished or cancelled order is a pure paperwork edit that can never 409 on STOCK. The logistics pad is
likewise re-checked excluding this order, against the body's (possibly NEW) assignee. Lines reconcile
BY `(productId, variantId)` PAIR (kept rows keep their ids, dropped ones hard-delete).

⚠️ **An edit NEVER touches the lifecycle** (no status move, no actual, no history row — that is
`advance`'s job alone) **and never touches `paymentMethodId`, `paidAt` or `paymentStatusId`.**

Frontend: `OrderForm mode="edit"` (one component; `orderToFormValues` mirrors `toCreateOrderBody`) on
`/panel/pedidos/:id/editar`, reached from the detail page's Admin-only "Editar pedido".

### Variation lines — backend (2026-10-29, `EPIC-1-INVENTORY.md` §3b)

- **Line body.** `{ productId, variantId?: number | null, quantity }`. A product with active
  variants REQUIRES one (`variantRequired`); a product without forbids it (`variantForbidden`). An
  unknown, retired or other-product id is `invalidLineVariant`. The keys live in both validator
  namespaces.
- **Identity.** A line is identified by the pair `stockKey(productId, variantId)`, so the same pair
  twice is `duplicateLineProduct`.
- **Pricing.** `priceOrderLine(…, variantId)` uses EFFECTIVE values (`variant ?? product`) for the
  price, deposit snapshot and replacement snapshot, and writes the `variantLabel` snapshot
  (`variantLabelOf`, option order, `" · "`) on every save. The settlement guard
  (`assertSettlementSurvivesEdit`) keys on the pair. §12's deposit rules are unchanged.
- **Stock = per POOL** (EPIC-2-ORDERS §6b):
  - Availability groups by `["productId","variantId"]`.
  - `poolQuantity` returns the variant's own `quantity`, else the product's. `null` (deleted product
    or retired variant) → a conflict with `available: 0` plus `variantId`/`variantLabel`.
  - Sale units move ONLY through `moveSaleStock(tx, { productId, variantId }, delta)`. They sit on
    the VARIANT row when the line has one (EPIC-2-ORDER-LIFECYCLE §6c).
  - `advance` stock lines carry `variantId`, so reopening onto a retired variant → `409` with
    `available: 0`.
  - `POST /orders/availability` answers `variants: [{ variantId, available }]` for a variant product,
    and its `available` = their sum (`null` when any is).
- **Read side.** Lines, damages and stock conflicts carry `variantId?`/`variantLabel?`. A line's
  `imageUrl` (`lineImageUrl`) is its variant's photo (values in option order), then the product
  SHOWCASE primary, and never `coverImageUrl`.

### Variation lines in the order form — frontend (2026-10-29)

- A line of a product WITH variations shows one select per option, in option order, in an
  `@container` grid (1 column, 2 from 26rem, 3 from 40rem). The selects CASCADE (`orderLineVariants.ts`:
  `currentPicks` / `nextPicks` / `valueChoices`): each lists only the values that, with the earlier
  picks, still lead to a variation the line may take (not used by another line, in stock); the line's
  own pick always stays listed. Changing an earlier pick clears a later one that now leads nowhere.
  Partial picks live in the form-only `pickedValues`; a complete set resolves `variantId` through
  `matchVariant`. A product change resets the picks (a single-variation product preselects it); a
  stale `variantId` on a product without variations is cleared silently (the client side of the
  API's `variantForbidden`).
- **Line identity is the pair** `stockKey(productId, variantId)` — duplicates, the product picker
  (a product stays listed while any of its pairs is free and takeable), "add line", reconcile toasts
  and 409 stock conflicts all key on it, and lines are named with `lineDisplayName`.
- The stock cap is `takeableFor`: the window probe's per-pair figure (`variants[]`), else the
  variation's own `available`, else the product's for a line without variation. A variations line
  with no variation picked gets no hint, no cap and is never reconciled (the product-level window
  figure is the SUM of its variations, so it never caps one).
- The resolver blocks submit on `requiredLineVariant` / `invalidLineVariant` (shown on
  `lines.i.variantId` under the selects; a partial pick stays quiet until the first submit). The
  API's 400s (`variantRequired`, `variantForbidden`, `invalidLineVariant`, `duplicateLineProduct`)
  carry no line identity, so if one ever gets past the mirror it lands in the banner via
  `toFormError`.
- The estimate (`orderEstimate.ts`: `lineUnitPrice(product, variant?)`,
  `estimateLineSubtotal(…, variant?)`) and the deposit use `effectivePricing` — a variation's values
  arrive EFFECTIVE and are never topped up from the product (a deposit override of 0 = no deposit).

### Arrival instructions + in-place client editing (2026-08-04, migration `20260804000000_order_delivery_instructions`, EPIC-2-ORDERS §6d)

A pin says WHERE, not HOW TO GET IN, so "portón negro, preguntar por el guardia" is saved per registry
ADDRESS (`client_registry_addresses.instructions`) and **snapshotted on the order**
(`services.delivery_instructions_kms`), prefilled from the chosen address and independent thereafter —
exactly like the pin and the address text. A saved address without instructions CLEARS the field
(never keep details belonging to a different place).

The order form's "Nuevo cliente" button becomes **"Editar cliente"** once a client is selected, opening
the same `ClientRegistryModal` with a `registry` prop; it saves through **`PUT /client-registries/:id`**
(Admin-only), which **shares the create validator** and **replaces** contacts/addresses rather than
diffing them (nothing FKs to them — orders snapshot the text). Two rules generalize:

- ⚠️ **A full-state save means the FORM must carry every field the BODY carries.** `notes` was
  accepted server-side and never collected, so the first edit of any client would have erased it — it
  is a field now. Any new registry column lands in both halves in the same commit.
- **The picker cache is patched by id** (`onRegistrySaved` replaces on an edit, prepends only when the
  id is new — a blind prepend showed the client twice).

### The client's `notes` open the order's COMMENT (owner, 2026-08-31)

They are the standing facts about this client ("cliente frecuente", "cobrar al terminar"), and the
comment is where whoever packs the order actually looks. Collected on the client and then never shown
again, they were information the admin had written down and could not see. Prefilled by the SAME
effect as the address, the pin and the arrival instructions, and cleared the same way when the new
client has none. It is where the note STARTS, not what it must stay. **General rule: a field collected
on the client is either shown where the work happens or it is write-only storage — check both halves
when adding one.**

### Payment is ONE axis with ONE door (owner decision 2026-08-05)

`services.paymentMethodId` records how the order was **actually paid**, so it is written by
`POST /orders/:id/payment` and by nothing else. It used to be a field on the order create/edit form,
prefilled from the client's `preferredPaymentMethod` — which stored a *prediction* as a fact before a
quetzal had changed hands. It is gone from `parseOrderBody`, the create write, the form, its schema,
its body builder and `orderToFormValues`. A stale client that still sends the field is silently
dropped rather than rejected (it is meaningless here, not malformed).
`client_registries.preferredPaymentMethod` survives as client INFORMATION and deliberately pre-selects
nothing: a method must be observed, not guessed.

- **Recording payment is its own door, not a lifecycle step** (`POST /orders/:id/payment`,
  Admin-only). Payment and fulfilment are independent axes — a client may pay days before delivery, at
  the door, or a week after collection — so folding it into the pipeline would impose an ordering the
  business does not have and make "delivered but unpaid", the state the admin most needs to see,
  unrepresentable. It stamps `paidAt` + the PAID status (+ an optional method) and touches nothing
  else; an already-paid order answers **409, not a silent success**, because re-stamping would
  overwrite the real payment date with the moment of a second tap. Projections expose **`isPaid`**
  (derived from `paidAt`, never a status id). One `OrderPaymentModal` serves the agenda, the dashboard
  and the detail; on the two scannable surfaces it is ICON-ONLY, and a Driver's agenda never receives
  the handler at all.
- **A payment record can be DELETED** (`DELETE /orders/:id/payment`, Admin-only —  `useUndoPayment` +
  `OrderPaymentUndoModal`). The *inverse write*, not a new fact: `paidAt` cleared, the recorded method
  dropped (it describes a payment that no longer exists), status back to PENDING. A **hard delete** —
  so there is no "undone payment" state and no undo of the undo; re-recording is simply a new payment
  with the date it is actually made. An order with no payment answers `409`. The door exists because
  recording is one irreversible-looking tap offered on three screens and the POST answers `409` on the
  second, so the state was otherwise unreachable from the UI. It lives on the order DETAIL **only**:
  the agenda and the dashboard are scanning surfaces where the one money action that belongs is the
  one that moves the job forward, and an undo beside it invites the wrong tap at a glance.
- ⚠️ **The copy says what the act DOES, never why it is being done** (owner rule, 2026-08-30). It
  first read "esto corrige un registro equivocado", which tells the person something about
  *themselves* and is often simply wrong (a payment that fell through is the same operation). The note
  now states the outcome and then the ONE thing the act could plausibly be mistaken for: **it is not a
  refund.** Money travelling back to a client is a different event with its own amount, date and
  method, and would be its own door. Same rule for any confirm dialog here: describe the operation,
  not the user's supposed error.

### Security deposit + damage settlement — backend (owner 2026-10-27, EPIC-2-ORDERS §12)

- **Its own door like payment, never a pipeline step:** `PUT /orders/:id/settlement` (declarative —
  the settlement's FINAL state; re-sending corrects it without re-stamping `depositSettledAt`) and
  `DELETE /orders/:id/settlement` (hard delete of the record; moves no money). Admin-only, in
  `orders/settlement/`. Recordable once delivered and while not cancelled, only when a rental line
  carries a deposit > 0 or a replacement value (`isSettleableLine`) — else `409`.
- Lines snapshot `securityDeposit` + `replacementPrice` per unit (re-derived on every save like the
  prices, through `orderPricingProductSelect` + `pricedLineData` — ONE shape for create and edit) and
  carry `damagedQuantity`/`damageNote`, written ONLY by the settlement.
- **All money is `orders.service.ts`** (`computeDepositTotal`, `heldDeposit`, `computeSettlementMoney`,
  `projectSecurityDeposit`): applied = min(HELD, retained + damages), refund = the rest, balance =
  what the deposit can't cover. No stock moves. **HELD = `heldDeposit`** — the deposit only when its
  collection is RECEIVED, 0 while PENDING or WAIVED (owner 2026-10-28: only money received is in hand);
  every money figure, the history snapshot and the dashboard read it, never the nominal total. **The
  retention ceiling is the NOMINAL deposit** (`computeDepositTotal`, 400 `retainedAboveDeposit`) — in
  the settle AND the edit re-check — so a retention is billed even when the deposit was not received.
- **Deposit collection** (`orders/deposit-collection/`): `services.depositReceivedAt` /
  `depositWaivedAt` + `depositWaivedReason` → PENDING / RECEIVED / WAIVED (exclusive). Recorded at the
  delivery (the forward DELIVERY action's `depositToCollect` → the advance's optional
  `depositCollection`, applied only when `pendingDepositToCollect` holds, silently ignored otherwise —
  never blocks; the dialog is pre-report only) or any time — before OR after the damage report —
  through `PUT/DELETE /orders/:id/deposit-collection` (Admin; `409` when cancelled or no deposit;
  `canRecord` = not cancelled). ONE write, `applyDepositCollection`, shared by the PUT and the advance;
  a damage report NEVER writes it (2026-10-28). A re-send of the same answer changes nothing.
  Projected as `securityDeposit.held` + `.collection`.
- An order EDIT that would contradict a recorded settlement is a `409 settlementConflict`
  (`assertSettlementSurvivesEdit`); undo the settlement first.
- **Append-only trail** `service_deposit_history`: every settle/undo writes ONE row in its transaction —
  `RECORDED` (first), `CORRECTED` (re-send), `UNDONE` — with a money snapshot (`depositTotal` = HELD,
  `claimsTotal`, `refundAmount`, `balanceDue`; NULL on `UNDONE`) and `byUserId`; the collection adds
  `RECEIVED` / `WAIVED` (`note` = reason) / `COLLECTION_CLEARED` (nominal `depositTotal`). Projected as
  the detail's top-level `depositHistory[]`; deleted with the order (before the row — RESTRICT FK).
- User-facing API messages say **"depósito"**, never "garantía"/"liquidación" (owner 2026-10-27).

### Security deposit + damage settlement — frontend

- **Vocabulary (owner 2026-10-27):** the client-facing word is **"Depósito"** — no app copy says
  "garantía" or "liquidar/liquidación". The damage path is "Reportar daños"; its record is the
  "reporte de daños". (Code identifiers keep `settlement` — they are not copy.)
- **Order form:** the money summary adds a "Depósito" line (Σ product deposit × qty, rental lines
  only — `estimateDepositTotal`) BELOW the total and labelled as not part of it; the line exists only
  when > 0 (always-mounted `grid-rows` collapse). An edit's `409` settlement conflict lands in the
  inline banner (the existing `toFormError` route).
- **Only a deposit actually RECEIVED is money we have (owner 2026-10-28)** — every screen and
  document follows the API's `held` (0 unless RECEIVED) and the collection status, never the nominal
  `total`, for what comes back or is credited; the nominal `total` is only the agreed amount and the
  retention's ceiling. "Not received" = PENDING or WAIVED (a legacy deposit without a collection
  reads PENDING — `isDepositNotReceived`, `documents/documentModel.ts`).
- **Order detail:** `OrderDepositCard` ("Depósito", only when `order.securityDeposit`) renders ONLY
  the API's numbers. Chip: "Pendiente" (recordable, not recorded) / "Devuelto" (recorded,
  `claimsTotal` 0, a deposit in hand) / "Sin daños" (recorded clean, nothing in hand) / "Con daños"
  (claims > 0) — branched on the API's `claimsTotal`/`held`, never recomputed. The amount shown is
  the AGREED `total`; whether it arrived is the row below. Pending + `canSettle` (Admin): the HAPPY
  path leads — **"Devolver depósito"** when `held` > 0, else **"Registrar sin daños"** (no deposit
  on the order, or one not received — the pending copy says nothing would come back and damages
  would be billed whole; the modal words itself on `held` + the collection, never "Devolver Q…")
  opens `OrderDepositRefundModal`, a confirm that
  sends `{ retainedAmount: 0, damages: [] }` through `useSettleOrder` (confirm first, seeds the
  detail cache from the response, then the hook re-reads) — then the DAMAGE path, **"Reportar
  daños"** → the page. Recorded: "Reportar daños" (clean refund) / "Editar reporte de daños"
  (claims > 0, same ActionRow key so it morphs), "Descargar reporte de daños" (the documents'
  `DamageReportButton` with the SAVED settlement, only when claims > 0) and "Deshacer". Lines show
  their damaged quantity. Undo is `OrderSettlementUndoModal` (+ `useUndoOrderSettlement`, `DELETE
  /orders/:id/settlement`): it clears the record and moves no money — the copy says so. A recorded
  report with the deposit not received hides the "Se devuelve" line and words the balance "El
  depósito no se recibió: los daños se cobran completos." (a clean one: "…no hay nada que devolver").
- **"¿Se recibió el depósito?" row** (on the card, only when the API sent
  `securityDeposit.collection`): PENDING "Pendiente"; RECEIVED "Recibido el {fecha}"; WAIVED "No
  recibido: {motivo}" (it was not received — e.g. a relative; it may still arrive — never "sin
  depósito"/forgiven), the reason labelled an internal note (never printed). Admin actions while
  `canRecord` (any time but a cancelled order — AFTER a damage report too; the API recomputes the
  report from it): not received (PENDING/WAIVED) → "Registrar depósito recibido"; PENDING also
  "Marcar como no recibido"; RECEIVED/WAIVED "Corregir" (back to pending). After a report with the
  deposit not received the row adds the consequence + "regístralo: el resultado se recalcula". All
  three acts are ONE dialog, `OrderDepositCollectionModal` (`receive` → `PUT
  /orders/:id/deposit-collection {received:true}`; `waive` → the required reason, mirrored by
  `SchemaDepositCollection.ts` (1–500 trimmed), `{received:false, reason}`; `clear` → `DELETE`,
  an alertdialog), through `useDepositCollection.ts` (confirm first, seed the detail, re-read
  orders + dashboard).
- **Advance dialog:** a move carrying `depositToCollect` adds "Depósito recibido (Q…)", checked by
  default; unchecked opens the required "¿Por qué no se recibió el depósito?" (same schema) and the
  hint that until it arrives nothing comes back and damages are billed whole. The answer rides the advance as `depositCollection`; only a
  missing/too-long reason holds the confirm.
- **Money card cuadre** (`OrderBalanceSummary`, under the TOTAL, which never includes the deposit):
  built ONLY from `squareOrderBalance` (`orderBalance.ts`, shared with the documents) over the API's
  figures, its input from the documents' own `orderBalanceInput` — rows only when relevant: Anticipo (−), Saldo del servicio, Saldo a favor del cliente (−
  `advanceCredit`: an anticipo above the cost, paid or not, NET of a deposit in hand — that excess is
  usually the deposit itself, so it is never credited twice), Depósito (reembolsable) (+
  while PENDING), Daños (+) and Depósito recibido (− credited) after the report; ONE result: "Monto a
  pagar" (light highlight) / "Monto a devolver al cliente" (inverted charcoal highlight) / plain "Sin
  saldo pendiente". A deposit already received is a small line under it, outside the sum. After the
  report only a RECEIVED deposit is credited; one not received adds no deposit row at all and, when
  something was claimed, a small "Depósito no recibido: los daños se cobran completos." under the
  result. The "Anticipo" fact shows only once paid (before that, the cuadre states it).
- **Discoverable from the top:** while `depositSettlementPending` (Admin), the state card's
  `ActionRow` carries an amber **"Depósito pendiente"** button (after the payment action) that
  brings the Depósito card into view (`bringIntoPanelView`) and focuses it — it only takes the admin
  to the card; the decision stays on the card (its own door, never a lifecycle step).
- **History:** the "Historial" card merges `order.depositHistory` into `statusHistory`
  chronologically (`mergeTrail`, stable — a status change reads first on a tie): RECORDED + claims 0
  "Depósito devuelto completo" when the snapshot's HELD `depositTotal` > 0, else "Registrado sin
  daños"; RECORDED + claims "Daños reportados"; CORRECTED "Reporte de daños corregido"; UNDONE
  "Registro del depósito deshecho"; RECEIVED "Depósito recibido" (+ its amount); WAIVED "Depósito no
  recibido" (+ the internal note as a sub-line); COLLECTION_CLEARED "Registro del depósito deshecho
  (vuelve a pendiente)". Damages and corrections add "Daños X · se devuelve Y" (only "Daños X" when
  nothing was held then) (+ "saldo por cobrar Z" when owed), from the entry's own snapshot. The dot is tinted emerald / red / amber /
  neutral.
- **"Reportar daños" is a PAGE**, `/panel/pedidos/:id/danos` (`OrderSettlementPage` →
  `OrderSettlementForm`, Admin route guard, in `PanelPath`): "Retención del depósito" (amount,
  total or partial, + "Descripción del daño", required iff retained > 0), and per damageable line
  (rental + replacement value — `damageableLines`) lost/broken units 0..qty (hint shows the unit
  price "c/u") + a note. `SchemaSettleOrder.ts` mirrors the API validator plus the two per-order
  ceilings; the body is the settlement's FINAL state (`PUT /orders/:id/settlement`, `useSettleOrder`)
  and an edit prefills the recorded one. The "Resultado" card is a live ESTIMATE of the API formula,
  labelled as such. Blank inputs mean 0. The retention's ceiling is the NOMINAL `total` (charged
  even when the deposit never arrived); the estimate counts the API's `held` (applied = min(held,
  claims), refund = held − applied, balance = max(0, claims − held)) — with nothing in hand the
  "Se devuelve" row gives way to "Saldo por cobrar" as the one result. With no deposit on the order
  the retention section is replaced by "Este pedido no lleva depósito…"; with one NOT received an
  amber note says "El depósito no se ha recibido: la retención y las piezas se cobran completas. Si
  ya lo recibiste, regístralo antes." + "Registrar depósito recibido" (while `canRecord`), which
  opens `OrderDepositCollectionModal` in place (mounted OUTSIDE the `<form>`: React's synthetic
  submit bubbles through portals) — its success seeds the order and the page recomputes. It also offers the damage report BEFORE saving (never labelled a
  draft — "Puedes descargar el reporte de daños para entregárselo al cliente antes de guardarlo."):
  `buildUnsavedSettlement(order, values, now)` shapes the current values like the API record (same
  formula as `previewSettlement`) for `<DamageReportButton settlement />`, shown (always-mounted
  `grid-rows` collapse, `inert` while closed) only when claims > 0 AND the values pass the resolver's
  own schema — a typo never prints.
- **Agenda/history tickets** carry an amber "Depósito pendiente" chip on
  `depositSettlementPending`.
- **Dashboard:** a small "Depósitos" card (`dashboard/DepositsCard.tsx`) LAST on `/panel/inicio`,
  after the top products — rare edge cases never compete with the headline figures. Pending: "N
  pendientes · Q en depósitos" + up to 5 compact links (client · short delivery date · the ticket's
  chip) + "y N más"; this month: devuelto / retenido / reposiciones / saldo por cobrar (a 2→4 grid on
  the card's own `@container`). Nothing on either side ⇒ ONE empty line (the ranking's convention),
  not a hidden card: the section's skeleton is always shown while loading, so hiding it on load
  would make a shimmer vanish.

---

## 3. The logistics pad — `EPIC-2-DRIVER-AVAILABILITY.md`

`ozari-api/src/modules/orders/logistics/`. **Read that epic before touching spacing, assignment, the
availability probe or the `.ics` export.**

The old global rule ("N minutes between any two events anywhere") is GONE —
`buildSpacingConflictWhere`/`OrderSpacingConflictError` were deleted and **must never be
reintroduced**. The rule is now: **every logistics event OCCUPIES a block of its DRIVER's time
(`[at − gap/2, at + gap/2]`, rounding the PAD up), and two blocks on the same driver may not overlap**
— numerically identical to the old hour, but it now has a resource, which is what makes multi-driver,
vehicles, trips and distance-aware gaps additive instead of a rewrite. The scope is the **DRIVER**
(two drivers may legitimately be in two places at once), and **`assignedUserId` is REQUIRED** by the
create/update validator — "unassigned" is deleted rather than modelled.

- ⚠️ **THE structural rule: SQL widens with the MAXIMUM pad, a pure function refines.** A pad that
  depends on the PAIR of events (travel time between two addresses) can never be one clever `where`.
  So `buildDriverConflictWhere` over-selects candidates by `2 × maxPadMinutes` and `refineConflicts` —
  which takes the candidate ROWS, never ids, so a later `tripId`/vehicle/geo column is a filter inside
  it — decides which actually collide and reports WHICH pair. Today the refine is nearly the identity
  and costs nothing; the day it isn't, no call site changes. **Never merge the two**, and never let a
  conflict rule leak into a controller.
- `logisticsEvents(order)` is the ONE place that knows an order has events (per-EVENT assignment later
  changes only it); `padMinutesFor(event, gap)` already takes the event and returns
  `{ before, after }` even though both are `gap/2` — that signature is the door for per-kind,
  per-event-type and distance-aware pads.
- **`selfOverlap` closes a real hole**: an order's own delivery and collection were never compared —
  on create the order is not in the table yet, on edit it is excluded — so a delivery at 14:00 with a
  collection at 14:15 used to save. Checked in memory, before any query.
- **OCCUPANCY — `pendingLogisticsEvents`** (owner decision 2026-07-31): an event occupies its driver's
  time from the moment it is scheduled until the moment it actually HAPPENS (its actual is stamped —
  never a status id; a rewind clears the actual, so a corrected tap re-occupies the day by itself), or
  never, if the order was cancelled. ONE predicate, used on BOTH sides. This generalises the stance the
  stock rules always had (`holdsSaleStock`, `holdsRental`/`holdsSale`): **an order that reserves
  nothing is not competing with anyone, so no availability of ANY kind — goods or driver — is checked
  for it.** Three real bugs died with it, and **save, probe and form must be changed as a SET**
  (`enforcesStock` ⇐ `order.holdsInventory`).
- `assertDriverAvailable` runs inside the create/update transaction, after the product locks and
  before any write. It throws `OrderSelfOverlapError` or `OrderDriverConflictError`, both `409`s with
  **their own payloads**: `data.selfOverlap` (`{ gapMinutes }`) and `data.driverConflict`
  (`{ orderId, at, kind, blocks, driverName, gapMinutes }`). ⚠️ **Never reuse `data.conflicts`** —
  that is the STOCK shape and it lands on a line's quantity input. "We don't have the units" and "we
  can't be there" are different problems with different fixes: the driver one lands on the **delivery
  / pickup date inputs** (`blocks` says which) plus the banner, under
  `modules.panel.orders.driverAvailability.*`, and `gapLabelKey` formats the configured gap — nothing
  anywhere hardcodes the hour.
- **`POST /orders/availability` answers BOTH halves on one request**: products as before, plus a
  `driver` block when the body carries an `assignedUserId` (and `excludeOrderId` when an edit
  re-checks itself — without it every edit would clash with its own two blocks). It is shaped ONLY by
  `projectDriverAvailability`: Admin sees which order, when, who and the gap; **any other role gets
  `{ available }` and nothing else**. On the frontend the answer is stored WITH the window + assignee
  it answers (`probeSignature`) so a stale answer stops applying by derivation the instant a date
  changes, and it is layered into the resolver (`appendDriverConflictErrors`, the
  `appendLineAvailabilityErrors` pattern) so it survives every revalidation.
- The block is also **exactly the `.ics` event** (`DTSTART = at − padBefore`).

---

## 4. Map locations & navigation — BUILT 2026-08-03

Migration `20260803000000_order_delivery_coords`. **A pin is optional metadata on an address, never a
requirement**: the address TEXT stays authoritative (a driver finds "Salón del club, entrada norte"
without a map), and every consumer keeps working when it is absent. The dormant
`Address.coordsKms`/`ClientRegistryAddress.coordsKms` columns are live, and `services.delivery_coords_kms`
was added — the order SNAPSHOTS the pin like its contact/address text, so re-pinning a registry address
can never move a past order.

- **`ozari-api/src/helpers/geo.ts` is the contract** (`sanitizeCoords`/`encodeCoords`/`decodeCoords`,
  6-decimal ≈11 cm rounding at the door so a dragged pin's float noise never churns a ciphertext),
  mirrored on the frontend in `ozari-app/src/utils/geo.ts` — **change one, change both.**
  `decodeCoords` is TOTAL: a corrupt or legacy value reads as "no pin", never as a `NaN` that renders
  nowhere on a map and deep-links a driver into the ocean. A malformed pin in a BODY is a clean `400`
  (silently dropping a coordinate the admin just placed is indistinguishable, to them, from a broken
  map).
- **The navigation button appears ONLY when the ORDER has a pin** (owner decision 2026-08-04 —
  `orderDestination` no longer falls back to searching the address text). A walk-in address is not
  reliably geocodable, so the old fallback opened a maps app somewhere unrelated *while looking
  exactly as trustworthy as a real pin*. Offering it only when we can actually navigate makes the
  button's presence itself the information. It reads the ORDER's snapshot, never the client's current
  pin. Applies identically on the detail, the dashboard and the agenda.
- **A pin is only HALF the condition** — the other half is that the order's next move is actually a
  trip: **`isTravelStep`** (`orders/useOrderLifecycle.ts`), read by the agenda ticket, the dashboard's
  up-next card AND the order detail, so the same order can never offer directions on one screen and
  withhold them on another. It asks whether the actor's FORWARD move is `tracksEvent`
  (`DELIVERY|COLLECTION`): a rewind or a cancel is desk work and can never qualify. On the seeded
  pipeline that resolves to *En ruta* (next: Entregado ⇒ DELIVERY — the van is out) and *Entregado*
  with a pickup still owed (next: Recolectado ⇒ COLLECTION), and to nothing on *Pendiente*,
  *Recolectado*, a finished order or a cancelled one. Adding a travel step needs no client change.
  - The rule this REPLACED was "the order still has a trip somewhere in its future" (`hasPendingTrip`),
    which put a Waze button on every pending order in the agenda — including ones scheduled for next
    week, beside a step whose whole job is to say the van has *not* left yet. The comment that
    justified it claimed `tracksEvent` "hid the button through En ruta"; that was a misreading — the
    flag is read off the move being OFFERED, not the status being left. **Don't reintroduce it.**
- **The chooser wears the apps' own marks** (`components/MapsAppIcon.tsx`, inline SVG — the CSP blocks
  external hosts and three logo requests on mobile data is not worth it), and once a preference exists
  the BUTTON wears that app's mark and name ("Abrir en Waze") so the driver sees where the tap goes
  before making it.
- **Navigation is always somebody else's app** (`utils/mapLinks.ts`). Waze needs `ll` for a pin and
  `q` for a search — mixing them lands somewhere unrelated. `orderDestination` resolves
  pin-or-address-text and returns `undefined` when there is neither, which is the signal to render NO
  button.

### ⚠️ The hand-off is PER-PLATFORM (2026-08-30 — supersedes the earlier "one https link everywhere")

**The web cannot launch a native app by permission — only by ADDRESS**, so there is nothing to ask for
and the whole question is which URL the browser already delegates to the OS. `buildMapsLink(app,
destination, platform)` decides, and `openMapsLink` follows it:

- **Android → an `intent://` URL, navigated in THIS tab.** Chrome hands it straight to the OS: the app
  opens with no interstitial and no tab. `S.browser_fallback_url` is what makes it safe — not
  installed ⇒ the browser follows the https link instead, so the old "custom schemes fail silently"
  objection does not apply to an intent. A plain https link is what produced *"this page wants to
  open…"*: the tab loads the WEBSITE, and the site then asks to hand off.
- **iOS → the vendor's universal link, navigated in THIS tab.** iOS decides at navigation time whether
  an https URL belongs to an installed app. `window.open` is what left an **`about:blank`** tab behind
  after the app took over.
- **Desktop → the https link in a new tab**, exactly as before.
- A hand-off is a real **anchor activation** (an `<a>` appended, clicked and removed), not a
  `location` assignment: that is the navigation both mechanisms are documented against.
- `detectMapsPlatform` needs `navigator.maxTouchPoints` because **an iPad reports itself as
  `Macintosh`** since iPadOS 13 — UA alone files it as a desktop and it gets the `about:blank` bug on
  the device where it is hardest to notice.
- ⚠️ **A `lat,lng` pair is passed UNENCODED; only free TEXT is encoded.** `,` is a legal sub-delim in
  a query and **Waze's `ll` parser does not decode `%2C`** — a percent-encoded pair opened the app
  with *no destination at all*, looking exactly like a working link. That one character is the whole
  "it opens Waze but nothing is set" report.
- **What is still NOT possible, so nobody re-litigates it**: there is no browser API to request
  permission to launch an app, no way to detect whether one is installed, and installing the PWA
  grants none of that. Universal/app links and Android intents are the ceiling.

### The preference and the picker

- **The maps app is a DEVICE preference** (`utils/mapsPreference.ts`, localStorage,
  `StorageKeys.MAPS_APP`): which app is installed is a fact about the phone, not the account, so it
  lives in **Ajustes** (every role — a driver sets it themselves) rather than the admin Preferencias
  screen, and it sits on the **globals** side of the state taxonomy — `clearAuthState` must never
  clear it, or a shared delivery phone re-asks every shift. Default is `ask`; the chooser offers
  "remember" inline.
- **The picker** (`components/LocationPicker.tsx`) is **Leaflet (BSD-2) + OSM tiles + Nominatim** — no
  key, no signup, no billing account. **`react-leaflet` is deliberately NOT used** (Hippocratic 2.1,
  not OSI-approved). Three ways in: search, pan the map, or paste a Google/Waze/Apple link or raw
  coordinates (`parseCoordsInput` — ORDER IS PRECEDENCE: a place URL carries both the exact `!3d!4d`
  pin and the `@` camera centre, and they differ by a block). A **centre pin** with the map moving
  under it, not a draggable marker: a thumb covers a 20px marker exactly where it is being placed, and
  it sidesteps Leaflet's broken bundler icon URLs. The tile ATTRIBUTION is the licence — never remove
  it; Nominatim's 1 req/s policy is honoured by the debounce + abort in `utils/geocode.ts`.
- **`leafletMap.ts` is the only file that imports Leaflet** and is coverage-excluded (it needs real
  layout, like `pageMotion`); every DECISION is in tested pure modules. The picker is **lazy-loaded**
  (`LocationField`), so the 45 KB-gzipped map chunk never reaches an admin who does not open it — a
  static import also made two form suites time out.
- ⚠️ **The CSP in `index.html` must name BOTH OSM hosts** — `img-src` ← `tile.openstreetmap.org` and
  `connect-src` ← `nominatim.openstreetmap.org`. Shipping without them produced a **grey map with
  working zoom buttons and a search that silently returned nothing** — which reads as "the map is
  broken", never as "a header blocked it". A blank map is a CSP question first, every time.
- **Buttons here are the panel's, not a widget's**: `variant="soft"` + `color={SECONDARY_COLOR}`
  (`#262626`) with an **explicitly sized icon**. An `outline` button with an unsized icon shipped once
  and read as foreign chrome next to the rest of the panel.

---

## 5. The admin dashboard — COMPLETE 2026-08-04

`ozari-api/src/modules/dashboard/` + `ozari-app/src/modules/panel/dashboard/`. **STRICTLY Admin**, and
`/panel/inicio` is the panel's front door (`DASHBOARD_ROLES` drives the tab, the route guard AND
`panelHomeFor`, so an Admin lands here while every other role keeps the home it had).

- **ONE request answers the whole screen** (`GET /dashboard`). Not a preference: every figure has to
  be a snapshot of the same `generatedAt` instant, or the screen shows a revenue total from one moment
  beside a counter from another — and on a scale-to-zero backend six aggregates would be six round
  trips on top of a cold start. Every query lives in ONE `Promise.all`; **never await one before
  starting the next** (same rule as `loadCatalogs`).
- **`upNext` is three ORDERS, not three events** (owner's framing): each order is represented by the
  single event it still has to perform, so a delivery at 14:00 with a collection at 14:30 occupies ONE
  slot — and confirming the delivery puts the same order back in the queue carrying its collection,
  re-sorted against everyone else. Built on **`pendingLogisticsEvents`**, the same predicate the driver
  pad uses, which is what makes the dashboard agree with the calendar for free. The two candidate sets
  are **two narrow indexed queries** (not delivered → order by `deliveryAt`; delivered-not-collected →
  order by `pickupAt`), which is EXACT rather than an approximation because each order matches exactly
  one of them — ordering by `deliveryAt` alone would not be. Each item **extends the ORDER LIST
  projection**, so `actions` comes from the lifecycle engine already narrowed to the actor and the
  quick action here can never offer a move the agenda wouldn't; it opens the very same
  `OrderAdvanceModal`.
- **"Este mes" is SIX cards, and six is a layout decision as much as a reporting one.** Five left a
  HOLE at every width — an orphan on its own row at 2-up and 3-up — which reads as something that
  failed to load. Six divides by 2 and by 3, so `sm:grid-cols-2 lg:grid-cols-3` is always a full
  rectangle. **A row of stat cards must be a count the grid can fill.** The sixth is
  **`month.collected`** — money actually RECEIVED, scoped by `paidAt` and therefore the one monthly
  figure NOT scoped by delivery date. `revenue` is what the month's work is worth; this is what came
  in; the gap between them is what `outstanding` totals.
- **`event.isOverdue`/`minutesUntil` are computed SERVER-side** against `generatedAt` — a device with a
  skewed clock must not be able to contradict the server about what is late.
- **Freshness is 60s + refetch-on-focus, deliberately NOT the 10–30s that "live" suggests**
  (`DASHBOARD_REFETCH_MS`): the backend bills per request-second and scales to zero, so a dashboard
  left open on a second monitor at 15s is ~2,300 needless requests a day keeping an instance warm for
  nobody. `refetchIntervalInBackground: false` means a hidden tab costs nothing.
- ⚠️ **The race that matters is the poll vs the admin's own tap**: `useAdvanceOrder` **cancels** the
  dashboard query before invalidating it, because a GET issued a moment before the tap can land after
  it and repaint the pre-move queue — which reads as the app undoing the admin's work. `cancelQueries`
  THEN `invalidateQueries`; the order is asserted in the test.
- **Role split is a CODE-SPLITTING boundary, not a runtime branch** (owner decision): a driver's or
  client's home is a different question about different data, so it gets its own route and its own
  lazy chunk — a non-admin never downloads this screen's code. The backend guard likewise does NOT
  widen by adding row scoping, unlike `/orders`.
- `bucketRevenueByMonth` buckets the 12-month trend in memory on purpose (a year is a few hundred rows
  here, and the month boundaries then obey the same rule as the rest of the screen rather than
  Postgres's timezone handling); **the trigger to move it into a `date_trunc` group-by** is the year's
  order count reaching a few thousand.
- **`deposits`** (EPIC-2-ORDERS §12): `pending` = EVERY open deposit (the list's
  `depositSettlementPending` predicate in SQL) counted and its HELD deposits summed (`heldDeposit` —
  only a RECEIVED one adds; pending/waived add 0), the oldest `PENDING_DEPOSITS_LIMIT` (5) listed as
  order list items; `month` = settlements first recorded this month, totalled by `summarizeSettlements`
  through the shared `heldDeposit` + `computeSettlementMoney` (the select carries `depositReceivedAt`). Both queries
  sit in the same `Promise.all`; the shaping is `projectDeposits`.
- **A delta badge is omitted when the previous period was zero** (`deltaPercent` absent ⇒ "sin
  comparación"): "+100%" on a month that started from nothing is the kind of number that teaches an
  owner to distrust the whole screen. Same stance as `outstandingFrom` clamping a per-order negative
  balance — a deposit larger than its total is a slip, not a discount on the headline figure.
- **A freshness label must be able to CHANGE.** "Actualizado hace 0 minutos" was permanently true and
  therefore said nothing — it counts seconds below a minute now, with a ten-second "hace un momento"
  window so it does not flicker 1, 2, 3 after every fetch.
- **A relative time label climbs the SAME ladder in both directions** (`relativeTime`/`relativeKey`):
  minutes → hours → days → months → years, so an overdue delivery reads "Atrasado 11 días" and never
  "Atrasado 16047 minutos" (which shipped). One function for past and future means the two cannot
  disagree about where hours become days; the ten-minute "ahora" window exists only on the FUTURE
  side, because one minute late is still late. Months/years are deliberately approximate (30/365
  days) — these are human labels, not calendar arithmetic.

### Charts (`components/charts/`)

Hand-rolled (`chartMath.ts` pure + 100%-tested, `BarChart`, `DonutChart`) rather than a library — a
batteries-included chart lib brings its own animation engine, which collides with "GSAP owns
choreography, never both on the same property", plus visual defaults that would have to be fought back
to our language. **The documented trigger to reach for `visx` (MIT)**: the first chart needing smart
axis-tick selection over dense time series, zoom/brush, hit-testing across overlapping series, or a
log scale — added for THAT chart only, since the props contract is ours.

- A **layout function returns the ITEM with its geometry** (`barLayout`/`donutSegments` are generic) so
  no caller re-looks-it-up by index behind a defensive `?.`.
- A donut is **stroked arc PATHS whose length is COMPUTED** (`arcLength`), never a dash-offset circle
  measured with `getTotalLength()` — a dash pattern in post-transform space repeats once per unit of
  scale (the page-loader beam bug) and a DOM measurement makes the animation untestable.
- **A chart ENTERS once and ADAPTS forever after** (the shipped bug was charts replaying their
  entrance on every 60s refetch). Two causes, both fixed: the `useGSAP` dependency was the array
  IDENTITY, which React Query replaces on every fetch even when nothing changed — it is now a **value
  signature** (`label:value|…`), so an unchanged refetch re-runs nothing at all; and a changed value
  now animates FROM the remembered previous geometry (a `previous` ref + `gsap.from({ attr })`, since
  React has already written the new attributes) instead of from zero. The donut's later updates
  `gsap.set` the dasharray to the new arc's own length — that one is **correctness, not polish**: the
  entrance leaves an inline dasharray behind and a stale one clips the redrawn arc. Any new chart
  follows this: signature dep, enter once, adapt after. (Bars use `attr` rather than `scaleY` so `rx`
  corners aren't squashed.)
- **The bar chart's axis is drawn in HALVES**, which is arithmetic rather than taste: `niceMax` always
  returns 1/2/5 × 10ⁿ and only the halves of those are themselves round numbers (quarters of 500 land
  on 125). Labels live OUTSIDE the `<svg>` because it stretches (`preserveAspectRatio="none"`) and
  text inside would stretch with it.
- ⚠️ A stretched `<svg>` needs `w-full` — see `FRONTEND-DOCTRINE.md` §10 for the full trap.

---

## 6. Documents — the comprobante / cotización PDF — `EPIC-2-DOCUMENTS.md`

`ozari-app/src/modules/panel/documents/`. **Read that epic before touching it**; §2a holds the owner's
copy/structure decisions, Phase 1b the react-pdf traps and §8a the pagination rules — every one found
by rendering, not by a test. Admin-only, offered on the order detail at every step **except a cancelled
order** (which renders NOTHING, not a disabled button).

- **One model, two adapters, one template** (`documentModel.ts`): `fromOrderDetail` builds a
  **comprobante** from the order's OWN stored figures — nothing here re-derives money — and
  `fromOrderForm` builds a **cotización** from the create form's UNSAVED estimate (quoting on the
  phone before the client commits is the point). `kind` drives COPY only; if the two ever need
  different structure that is a new model field, never an `if` in the template. The vocabulary and the
  letterhead are shared too (`useDocumentVocabulary.ts`).
- **The quote's valid-form gate is a check ON CLICK, not a disabled button**: clicking runs the same
  `trigger()` that guards submit, so an incomplete form lights up which field is missing instead of
  leaving a greyed control that cannot explain itself. Create-only.
- **The letterhead is Preferences, never the template** (`documents.businessName|businessPhone|terms|
  conditions|freeDeliveryNote|quoteValidityDays` + the `bank-accounts` catalog). The important
  conditions are PRINTED (capped at four); a promise whose truth depends on the order is DERIVED
  (the free-delivery note prints only when the fee is exactly `0`).
- **The bank accounts are DATA, not code**: DB rows with `accountNumberKms`/`holderKms` encrypted at
  rest, entered under Preferencias → Documentos. The catalog is seeded with NOTHING (they are the
  owner's own accounts), so "only one bank prints" always means the second was never added or is
  unpublished. The only bank data in the repo is the two logo PNGs (`?inline` base64 —  a URL would
  have to be fetched, which is a CSP question in the browser and a request to a nonexistent server in
  the Node preview).
- **A variation line prints as `lineDisplayName`** ("Mantel — Rojo · Redondo", from the line's
  `variantLabel` snapshot; a replacement uses the damage's own label, else its line's) on all three
  documents and on every order screen. The comprobante/report photo is the API's variation-aware
  per-line `imageUrl`; the cotización's is `variant.imageUrl ?? showcase primary` — never
  `coverImageUrl` (the default variation's photo, possibly the wrong colour). EPIC-2-DOCUMENTS §2d #40.
- ⚠️ **An ordinary order fits on ONE page, and that is structural.** The closing block is
  `wrap={false}`. **Don't buy the third-bank edge case back by tightening the fact cards or the row
  rhythm** — tried, cost readability everywhere, still missed.
- ⚠️ **The brand gradient is allowed in exactly FOUR places** (owner rule 2026-08-26): the top rule,
  the bottom rule, the logo TILE and the SALDO PENDIENTE chip. **A new element does not get it.**
- `OrderDocument.tsx` is coverage-excluded (jsdom cannot drive react-pdf's layout engine), so **every
  DECISION lives in a tested pure module** and the way to check a LOOK is `pnpm doc:preview` /
  `:long` / `:free` / `:quote` / `-- --rows=N`. **Check a render after ANY change to the template.**

---

## 7. Calendar integration — BUILT 2026-08-31 — `EPIC-2-CALENDAR.md`

`ozari-api/src/modules/calendar/` + `ozari-app/src/modules/panel/settings/`. §7 is the owner's Google
setup, §3 the rule the feature turns on; `DEPLOYMENT.md` §3d is the full runbook.

- ⚠️ **Apple publishes NO calendar write API** — no OAuth scope, no endpoint, and "Sign in with Apple"
  grants nothing of the kind (EventKit is native-only; iCloud CalDAV needs the user's Apple ID).
  **Don't re-open this looking for a key.** So there are two mechanisms and they are not a first and
  second choice: **Google → the API** (immediate, revocable), **everything else → a private ICS
  subscription** the app polls. A subscription is read-only from the calendar's side, which costs only
  LATENCY (Apple as low as 5 min; Google hours) — and that single fact is why Google gets the API.
- ⚠️ **THE REMINDER IS CLAMPED, and that is the point.** A calendar fires at `start − minutes`; if
  that instant has passed, **nothing fires**. `reminderMinutesFor` asks for the configured lead but
  never for more time than remains **minus `reminderSafetyMinutes` (5)** (nor more than Google's
  40320-minute ceiling), and returns nothing once the event has started. The safety margin is
  correctness, not padding: clamping to EXACTLY the time remaining puts the trigger on `now`, and the
  event still has to cross the network — neither vendor documents what a passed trigger does. Inside
  the margin the lead drops to **zero** (a reminder at the event's own start, still future). The ICS
  feed recomputes it on every FETCH.
- **The event's window is the LOGISTICS BLOCK** (`calendarWindow` → `padMinutesFor`): the hour the
  system refuses to double-book is exactly the hour in the calendar, so the spacing preference moves
  both.
- ⚠️ **An order goes to ONE calendar: its ASSIGNEE's.** It used to go to EVERY connected calendar —
  which reads as a feature and is really a leak. Both transports enforce it from `assignedUserId`.
  **Reconciling the OTHERS with an empty set is the load-bearing half** — it is what strips a
  reassigned job from the previous assignee's calendar without a diff. An UNASSIGNED order reaches
  nobody.
- **Only PENDING events are written**, read off `deliveredAt`/`collectedAt` and never a status id.
- **`syncOrderCalendars(orderId)` is the ONE hook** (create, update, every lifecycle move, delete).
  DECLARATIVE — it computes what the order should have and makes the calendar match — which is why one
  call serves every door, a missed call self-heals, and a permanent delete needs no path of its own.
  It **never throws** and runs strictly AFTER the commit: holding a transaction open across a call to
  Google is how a slow third party becomes a lock-contention outage.
- **Deterministic ids remove the mapping table**: `calendarEntryId` → `orden12d` is both the Google
  event id and the ICS `UID`. ⚠️ Google's rule: the id must match `[a-v0-9]+` — which is why the
  prefix is `orden` and the kind is one letter (a `y` from "delivery" is rejected at insert, silently,
  on every order).
- **Two token traps**: Google returns a refresh token only when it mints a NEW grant, so an ordinary
  refresh must never write `undefined` over the stored one; and `invalid_grant` means the user REVOKED
  access — deactivate the connection rather than retrying it forever.
- **Two routes are mounted before the API-key check**, each with its own 20/min limiter: the OAuth
  callback (its authentication is the signed `state` with a `purpose` claim; every outcome is a
  REDIRECT because the caller is a browser) and the ICS feed (Apple sends no header we control, so the
  32-byte path token IS the credential — stored `token_sha` + `token_kms`, the `email_sha`/`email_kms`
  pattern, so it can be shown again for a second device). Regenerating is the only revoke.
- ⚠️ **A dialog keeps rendering while it CLOSES, so its copy must be the one it OPENED with.**
  `CalendarConfirmModal` derived its copy from the live action with a `?? 'googleDisconnect'`
  fallback — and since the modal stays mounted through its exit, every dialog turned into the Google
  one on the way out. Remember the last real action (adjust-state-during-render), never a fixed
  member. **Any dialog whose content is keyed by "which one is open" has this bug waiting.**
- **Nothing destructive here happens on one tap.** ONE dialog with a `CalendarConfirmAction` token
  (`googleDisconnect | feedRemove | feedRegenerate`) picks the title, description, warning and button
  label together. **Regenerating is confirmed too** (it silently revokes a URL already sitting in
  other people's phones); generating the FIRST link is not, because nothing exists to break, and a
  dialog in front of a harmless act teaches people to click through dialogs.
- **The writes only REPORT; `commit()` re-reads the screen** (`useCalendar`) — invalidating inside
  `onSuccess` makes the deletion doctrine inexpressible. Order: request → answer → exit → `commit()`.
- **The section is ONE `useMorphOnChange` region and nothing inside it animates height** (the
  layered-not-nested rule): rows carry `.calendar-flip`, the button groups are `ActionRow`s,
  descriptions and the URL are `MorphSwap`s, and the subscription block `editorSlotIn`s +
  `revealInScroller`s when it ARRIVES — but only on a settled screen, never on the first paint.
- **The settings split follows the Ajustes/Preferencias line exactly**: the CONNECTION is my Google
  account and my device's subscription (**Ajustes → Calendarios**, Admin-gated on both sides); the
  LEAD TIME is how the business runs (**Preferencias → Operación**, `calendar.reminderMinutes`) — ONE
  value for both transports, because two controls would let a phone and a laptop disagree about the
  same job.
- **Disconnecting LEAVES the events already written.** They are appointments the person still has to
  keep; emptying somebody's week because they unlinked an integration is the worse surprise.
- ⚠️ **`API_PUBLIC_URL` is REQUIRED in every deployed environment** (plain env var, mirrored in
  `cloudbuild.yaml` + `cloud-run.tf` like `APP_HOST`, which it is NOT: that one is the frontend
  origin, this one is the API's own). The Cloudflare Worker in front of Cloud Run rewrites the Host to
  the `run.app` name, so a request cannot see the brand host — and the OAuth redirect URI plus the ICS
  feed URL an admin pastes into their phone are built from it. `publicBaseUrl` treats an EMPTY value
  as unset, because both deploy paths replace the whole env list.
- ⚠️ The consent screen's audience is **External** (the business has no Workspace org), so a screen
  left in Testing expires refresh tokens after ~7 days — publishing + Google's verification is the
  only way out.

---

## 8. Preferences — COMPLETE, both halves (2026-07-29)

`ozari-api/src/modules/preferences/` + `ozari-app/src/modules/panel/preferences/`. **STRICTLY Admin,
every route.** `GET /preferences` returns the whole screen in one call (settings + every manageable
catalog + the municipalities the zone form picks from, **unpublished rows included** — this is where
`isActive` is edited); `PUT /preferences/settings` is declarative over the full editable set; and ONE
registry-driven set of routes (`POST|PUT|DELETE /preferences/catalogs/:catalog[/:id]`) serves all six
catalogs.

### The two registries

- **`preferences.service.ts` = the SETTINGS registry.** Only the settings the system actually HONOURS
  are editable (spacing, turnaround, evidence min/max, retention, the two draft switches, the calendar
  reminder lead, and the six `documents.*` keys the PDF and the register screen read) — owner rule
  2026-07-29: a control that saves a value nothing reads teaches the admin to distrust the whole
  screen. **Add a key here in the SAME commit as the feature that reads it.** Bounds travel to the
  client so it mirrors them while typing; stored values are CLAMPED into range on read (a hand-edited
  row reads as its nearest legal value); writes UPSERT (a setting can legitimately have no row yet on
  an older database).
- **`preferences.catalogs.ts` = the CATALOG registry**, and its absences are load-bearing: only event
  types, contact types, zones, payment methods, product categories and product detail types are
  manageable. `product_business_types` / `rent_time_units` / `payment_status` / `user_roles` /
  `token_types` / `user_phone_types` / `currencies` / the geo tables are **NEVER manageable** —
  runtime code branches on their ids, so an admin deleting "Alquiler" would break pricing. An unlisted
  catalog answers **404** (it must read as "no such thing here", never as malformed). Adding a catalog
  is ONE registry entry — no route, controller or validator change.

### Rules the two halves share

- Deletion is the **conditional NO-TRASH** rule: hard-delete when nothing references the row,
  deactivate when something does (an order holds a live FK to its event type), and the response says
  WHICH happened so the client's copy is truthful.
- One invariant: a catalog the FORMS need (`minimumActive: 1` — event types, contact types, product
  categories) may never be left with zero active rows, or the order/product form drops into its
  `config` dead-end.
- **Every row carries `isReferenced`, and a catalog declares its referencing FKs ONCE** (`referencedBy`
  — a `GROUP BY` per relation, read by `referencedIdsOf`/`isRowReferenced`). That one declaration
  serves both the list's flags and the delete decision, so the preview the admin saw and the door the
  delete takes can never come from two different rules. It is also what keeps the endpoint fast:
  `loadCatalogs` fires all six lists AND all eight `GROUP BY`s in ONE parallel batch, so the whole
  screen costs about one round-trip — **never await a catalog before starting the next.** Create
  answers `isReferenced: false` without a query; update re-reads it, because the client replaces its
  cached row wholesale.
- **The CONTROL follows the value, not the card** (owner, 2026-08-26). A setting's `type` +
  `multiline` + `format` decide it: a switch for `bool`, a textarea only for genuinely multi-line
  text, an `<input type="tel" inputmode="tel">` for `format: 'phone'`, a number input for `int`. Every
  single-line text used to get a textarea "so the group shares one field language" — which invited a
  paragraph the resolver then rejected, and cost the phone its keypad. `format` is a token about the
  VALUE (the `colorKey` doctrine), not an instruction to draw a control.
- **A settings GROUP is what the settings ARE, not where they are edited.** One "Membrete" heading
  once covered the business name, the printed conditions, the terms and a quote's validity — only the
  first of which is a letterhead. Now: `documents` (who the page is from), `documentConditions` (what
  it declares about the deal), `legal` (the terms, which the document never prints — the REGISTER
  screen publishes them via `GET /legal/terms`). Each group is its own card and saves only its own
  keys; `TAB_SECTIONS`' `skeletonRows` must equal each group's field count, or the placeholder stops
  being the shape of what lands.
- `orders.turnaroundMinutes` is HONOURED (EPIC-2-ORDERS §6b): it widens the rental hold past the
  billed window, read with the spacing rule by `loadOrderTimingPreferences`.

### The screen

- **`/panel/preferencias` is its OWN nav tab, not a Settings subsection** (owner decision 2026-07-29:
  Ajustes is *my account*, Preferencias is *how the business runs*). `PREFERENCES_ROLES = [Admin]`
  drives the tab AND the route guard; the forms' `config` dead-end (`PreferencesCta`) points here.
- ONE `usePreferences` query (`staleTime: Infinity`, **no retry on 403**) feeds every section, and the
  mutation hooks PATCH that one cache entry rather than invalidating — the screen never reloads under
  the admin's hands.
- ⚠️ **A catalog write also INVALIDATES the other caches of that reference data**
  (`REFERENCE_DATA_QUERIES` — `PRODUCT_CATALOG` + `ORDER_CATALOG`). Those two are the app's only
  `staleTime: Infinity` queries, so nothing else would ever refresh them: a detail type added here
  stayed invisible to the product form until a hard reload. They are invalidated as a SET on ANY
  catalog write rather than mapped per catalog — a map is one more thing to remember when a catalog is
  added, and forgetting it brings the bug back silently. *Invalidate*, never refetch.
  `usePreferences.test.tsx` pins this END TO END (mount the product catalog after the mutation and
  assert it re-reads), not by spying on `invalidateQueries`.
- **The frontend renders FROM the API's lists and holds no copy of the registries.**
  `PreferenceSettingsCard` maps the settings array (bounds mirrored while typing, the same
  inverted-evidence cross-check the API enforces) so a setting added server-side appears as soon as
  its two i18n strings (`settings.<leaf>.label`/`.help`) exist. Its inputs hold only the fields the
  admin TOUCHED — everything else reads straight from the API, so a save's reloaded values simply take
  over (adjust-state-during-render on a saved-value signature) with no stale local draft to reconcile.
- `PreferenceCatalogCard` is ONE component for all six catalogs, and it mirrors the two backend rules
  so the UI explains itself instead of surfacing a status code: the delete button is **disabled** on
  the last active row of a `minimumActive: 1` catalog, and the confirm dialog **names the outcome**
  rather than listing both — ONE `variant` token (`remove` | `hide`, from the row's `isReferenced`)
  picks the title, the note AND the button label. The choreography follows the same answer: a row
  nothing points at `detailRowOut`s **before** the request commits, while a row in use is NOT animated
  away — it stays and re-sorts, unpublished, which is what actually happened. Either prediction can be
  overruled by the response, so `detailRowIn` restores the row when the server only hid one we
  expected to remove, and on any failure.
- **The screen is GROUPED into three tabs** (`PreferenceTabs`: Operación / Pedidos / Productos, the
  Agenda-Historial segmented control widened to N segments), and `TAB_SECTIONS` in `PreferencesPage`
  declares which sections live under which. This is a performance decision as much as a navigation
  one: eight cards in one column meant eight simultaneous height morphs and a reveal cascade long
  enough to read as lag. The DATA is still one request, so a tab change costs only the swap. Both
  cards are `memo`ised so one card's save does not re-run six morph measurements.
- **The tab track WRAPS on a phone rather than truncating or scrolling**: two segments per line below
  `sm`, four across above it, both derived from `PREFERENCE_TABS` — the pill's size and `translate`
  follow, so it slides diagonally. A segmented control's whole promise is that every option is visible
  at once, and both usual escapes break it: an ellipsis hides the word that distinguishes the groups
  ("Docum…"), and a scrolling track hides a group behind a gesture nothing announces. Wrapped, the
  track is no longer a stadium (`rounded-card`, not `rounded-full`).
- **The open group is URL state** (`preferencesSearch.ts` + the route's `validateSearch`):
  `?grupo=pedidos|productos`, the URL in Spanish and the internal token in English, clamp-never-reject,
  and the DEFAULT group writes nothing so the clean URL stays clean.
- **This screen's axis is LATERAL, everywhere.** The groups are a segmented control, so a vertical
  rise would contradict the thing the user just clicked: the page entrance comes from the right, its
  exit heads left, and a group swap is directional (`useTabSwap`), including the `SectionReveal`
  skeleton→content resolve (`from="right"`) and the skeleton rows themselves (they carry `.card-item`,
  so a shimmering card waves exactly like a loaded one). Entrances use the **nested** wave
  `staggerInNested(root, '.reveal-block', SECTION_ITEMS)`. Exits stay single-level on purpose: an exit
  is 0.2s, and staggering it twice only delays what was asked for.
- **Motion inside a card is LAYERED, never nested.** The card body is a single `useMorphOnChange`
  region keyed by the rows *and* the open editor, so it owns every height change in normal flow;
  inside it nothing else animates height — arrivals fade-rise through the region's own FLIP, and the
  editor slot cross-fades (`editorSlotIn`/`editorSlotOut`, opacity + a small lift ONLY). Closing is
  two-phase for the same reason a delete is: the outgoing editor leaves first, then the state commits.
  Opening while another editor is open hands over instead of cutting. Each section card keeps its real
  chrome while only its body shimmers (`SectionReveal`, cascading `delaySeconds`), and the list's
  vertical rhythm matches the settings cards (20px at the card's edges via the `<ul>`'s `py-2` + each
  row's `py-3`, 16px gutters between rows).

### ⚠️ Two traps worth knowing repo-wide (2026-07-29)

1. A morph key built with `editing ?? 'closed'` collapsed the new-row editor (`null`) and "nothing
   open" (`undefined`) into the SAME key — `??` treats `null` as nullish — so `useMorphOnChange`
   concluded nothing had changed and opening the add form got no height morph at all. **Spell such
   keys out.**
2. The two variants of a swapping slot (editor ↔ row label, editor ↔ "Agregar" button) are both
   `<div>`s in the same position, so React reconciles them as the SAME DOM node and only swaps the
   className — carrying over the `visibility:hidden` the exit animation left behind. That shipped as
   an invisible button still occupying its space. **Any slot that swaps between an animated-out
   variant and another needs distinct `key`s**; `PreferencesPage.test.tsx` pins it by asserting the
   nodes differ (the styles themselves cannot be asserted — the suite runs reduced-motion, where GSAP
   writes nothing).
