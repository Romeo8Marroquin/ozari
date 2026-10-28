# EPIC 2 — DOCUMENTS (cotización + comprobante de pedido)

> **Status: PHASES 0, 1 and 2 BUILT** (Phase 1 refined by the 1b legibility + layout pass,
> 2026-08-25/26; Phase 2 — the cotización — 2026-08-26; the security deposit and the REPORTE DE
> DAÑOS — §2b/§2c — 2026-10-27). Phase 3 planned. Owner decisions below are settled;
> read this file before writing any of it. Fulfils EPIC-2-ORDERS §5 item 6 ("recibos + cotizaciones").
>
> **Scope: PDF only.** No FEL, no fiscal certification, no invoice numbering authority — the money
> fields stay FEL-ready (EPIC-2-ORDERS §2) and nothing here creates a tax document.

---

## 1. The two documents

They come from different places, carry different authority, and must never be confused.

| | **Cotización** | **Comprobante de pedido** |
|---|---|---|
| Source | The create/edit FORM, from **unsaved** values | A **saved** order (`GET /orders/:id`) |
| Trigger | A button on the order form | An action on the order DETAIL page — deliberately **not** a quick action on the agenda or the dashboard |
| Figures | The client-side **estimate** (`orderEstimate.ts`, the mirror of the backend formula) | **Server-computed** — the order's own stored prices |
| Authority | A proposal. Says so on its face: "Cotización — sujeta a cambios", plus a validity note | The record of what was agreed. Carries the order's id and a **PAGADO** mark once `paidAt` is set |
| Identity | None (no order exists yet) | The order id |

**The cotización requires a VALID form** (owner decision): the button is enabled only when the same
resolver that guards submit says the form is complete. A half-filled form has no dates, no client and
no lines — a document made from it would be a blank page with a logo, which is worse than no button.
It does **not** require saving: quoting on the phone before the client commits is the whole point.

**Naming.** "Comprobante de pedido" rather than "Recibo" because until `paidAt` is set nothing has
been received. Once paid it carries the PAGADO mark and reads as a receipt. If the owner prefers
"Recibo" throughout it is one i18n string.

**A third document, the `REPORTE DE DAÑOS`** (2026-10-27), answers one question the comprobante only
summarises: *what happened to the client's deposit, line by line.* It comes from the deposit
settlement the admin entered — always THE report, never a draft — and ends on the same squared
result as the comprobante. It shares the template, theme and letterhead. Its full definition is §2c.

---

## 2. Owner decisions (2026-08-05)

| # | Decision |
|---|---|
| 1 | **Our palette, their format.** Keep the reference template's structure and information; restyle in the app's language (cream→blossom, charcoal, `LogoMark`) so a client's document looks like the app and the welcome email. The blue→purple of the current template is retired. |
| 2 | **No document from an incomplete form.** Valid-form gate, above. |
| 3 | **Billing is per started day**, already implemented by `computeBilledDays`. The document DISPLAYS the days; it never re-derives them. |
| 4 | **Rental and sale are separate sections**, each with its own subtotal. |
| 5 | **The delivery fee is a totals line, not a table row** — it is not a product. |
| 6 | **Zero-quantity lines do not exist** (validator enforces `quantity >= 1`); the reference template's zero row was manual. Quantities always show and always feed a subtotal. |
| 7 | **A cancelled order produces no document.** The action is hidden, with the reason stated. |
| 8 | **Bank details are confidential-ish**: not in the repo, not in an env var, not visible to anonymous visitors — but readable by an admin (and, later, a client). ⇒ stored in the DB, **encrypted at rest**, served by a role-gated endpoint. See §6. |

### 2a. Owner decisions from the first read of a generated document (2026-08-25)

The owner compared a real comprobante against the hand-made template it replaces. Everything below
is settled; the reasoning matters more than the individual strings, because it generalises.

| # | Decision |
|---|---|
| 9 | **A bare value is not a fact.** The phone under the letterhead was an unlabelled number; `Contacto` sat in a card that never said whose it was. Every fact card now carries a TITLE and every row a label that survives being read alone. |
| 10 | **No abbreviations the reader has to decode.** `Cant.` → `Cantidad`, a bare `Precio` → `Precio por día` (which is also what makes `cantidad × días × precio` verifiable by hand), the per-line `Total` → `Subtotal` — it is not the document's total, and the number the client acts on is the saldo. `Días de alquiler` → `Días facturados`, with the per-started-day rule stated once, beside the number. |
| 11 | **The important conditions are PRINTED, not merely referenced.** This does not reverse decision §5: the reason a wall of conditions does not belong on a quote is that it buries the totals, not that a client should have to ask what happens if a table comes back broken. Two to four short lines in the business's own words, from a new `documents.conditions` preference; the acceptance line still covers everything else. |
| 12 | **Free delivery is a DERIVED condition with the admin's wording.** An order stores no zone (`deliveryZoneId` lives in the order form as a fee suggester and is never sent to the API), so the document cannot name where free delivery applies — but it knows exactly whether THIS order was charged for one. The note prints only when the fee is `0`; the text comes from `documents.freeDeliveryNote`. Typing the promise into `conditions` instead would print it on billed orders too, which is the failure this exists to prevent. |
| 13 | **The delivery fee says what it BUYS.** `Envío a domicilio` → `Servicio a domicilio` with `Incluye entrega y recolección` beneath — the one thing the hand-made template was explicit about and this one was not. A purchase-only order gets `Incluye entrega`, which is also the seam a future "the client collects it themselves" mode widens. |
| 14 | **The deposit block wears the banks' own marks**, as a stack of borderless rows rather than bordered cards — the shape the hand-made template had, and the reason it read better. |
| 15 | **An ordinary order must fit on ONE page.** Not cosmetic: the closing block is `wrap={false}`, so a page that runs a few points short pushes the totals, the conditions AND the bank details wholesale onto a second sheet, where the person meant to use them is least likely to look. |
| 16 | **The totals are a PANEL, not loose lines** (2026-08-26). On white they read as three unrelated things floating beside the tables rather than as the summary *of* them. They now sit on the same tinted surface as the fact cards. |
| 17 | **The brand gradient is allowed in exactly FOUR places** (2026-08-26): the top rule, the bottom rule, the logo TILE, and the SALDO PENDIENTE chip. That is the whole point of a highlight — the frame of the page, and the one number the client must act on. The table headers wore it too, which is three or four saturated bands per page and turns the accent into wallpaper: nothing is emphasised because everything is. Headers are a neutral `TABLE_HEAD` band now — distinguishable, not highlighted. **A new element does not get the gradient**; if it needs to stand out it gets the tinted panel or weight, and if it needs to lead the eye, ask whether it beats the saldo (it does not). The surface vocabulary is therefore: **panels are tinted, tables have a neutral header, the gradient marks the frame and the balance.** |
| 18 | **The letterhead mark sits in the sidebar's TILE** (2026-08-26) — a cream→blossom rounded square holding the charcoal isotype at 88%, proportions taken from `BrandMark` rather than chosen (`rounded-xl` on `size-11` is a 12/44 corner). The document printed the bare isotype until now, which was the one place the app's chrome and its paperwork disagreed about what the brand looks like. |
| 19 | **The rule under a table is a SECTION divider, not the table's bottom border** (2026-08-26). What makes the difference is DETACHMENT, not weight: drawn tight under the last row it reads as a border the table's other three sides do not have, while 9pt of air above it reads as the rule between one block and the next. Thinning it to 0.5pt was tried at the same time and reverted — once the rule is no longer touching the table it has to carry the separation alone, and a hairline is too quiet for that. **Detached and full weight** is the pair that works. The space BELOW it is deliberately unequal: another group's table is one step away (`groupTitle.marginTop` 16), the summary is a section away (`summary.marginTop` 26). At equal spacing the summary read as a third table in the same list. |
| 20 | **The one-page target (#15) is the ORDINARY order, and #18–19 spend part of the budget.** With the letterhead this business has — two accounts — a five-line order with a discount and a deposit ends on page one with ~35pt to spare (`pnpm doc:preview:free`; measure it by scanning the raster for the last non-white row rather than eyeballing). A THIRD bank account costs ~44pt and pushes that same order to two pages, which is correct rather than broken: the closing block is `wrap={false}`, so conditions, deposit details and totals travel together and page two is a coherent page, never a stray line. **Do not buy that edge case back by tightening the fact cards or the table rhythm** — tried on 2026-08-26, cost readability everywhere, still missed by ~17pt, reverted. When the budget genuinely needs a few points, take them from slack that is not spacing at all: `page.paddingBottom` only has to clear the two pieces of `fixed` furniture. |

### 2b. The security deposit on the document (owner, 2026-10-27)

⚠️ **The word with clients is "Depósito" — never "garantía", never "liquidación"** (owner,
2026-10-27). The code still says `securityDeposit` / `settlement`; the PRINTED words are all in
`modules.panel.documents.securityDeposit.*` and `…damageReport.*`, and a new string follows the same
rule.

A rental product may carry a refundable deposit per unit; an order snapshots it per rental line and
`OrderDetail.securityDeposit` carries the total, its **collection** (`PENDING` / `RECEIVED` /
`WAIVED`) and, after the pickup, the admin's **settlement** (a retention for partial damage and/or
lost/broken units billed at the line's replacement value). Owner's words: *"once not refunded, we
have to take it as cost in the document perfectly. But if it follows the normal happy path it should
still be considered as deposit."*

| # | Decision |
|---|---|
| 21 | **The deposit is NEVER a cost.** It never enters the TOTAL on any document. It is money the client HANDS OVER (before the review), money we HOLD (received, before the review) or a CREDIT (after it); only what a recorded report charged — a retention, a replacement — is a cost, and those are itemised as damages. |
| 22 | **The money box is SQUARED, and ends on ONE result** (owner, 2026-10-27, superseding the first build's "saldo pendiente" chip + a separate damages balance — "two competing balances, and neither is what to actually do with the money"). Under the unchanged cost rows and TOTAL, signed rows appear only when not zero: `Anticipo -`, `Pagado -` (a paid order: what the payment covered after the anticipo, so the column adds up instead of a saldo silently dropping to 0), `Depósito (reembolsable) +` with *"Se devuelve al recoger, previa revisión."* (before the review, a deposit still to be handed over — the client must PAY it to get the service), `Daños +` with *"Detalle a continuación."* (after the review), `Depósito recibido -` (after the review, the deposit credited back). Then the result: **`Monto a pagar`** (the client pays us) in the gradient chip; **`Monto a devolver al cliente`** (we pay back) in the SAME chip INVERTED — charcoal, white type — unmistakably not the band a client looks for to pay; or, at zero, NO highlight: a plain bold row `Sin saldo pendiente  Q 0.00`. A deposit already RECEIVED before the review is information under the result, outside the sum (`Depósito recibido Q… — se devuelve al recoger, previa revisión.`). The PAGADO mark is unchanged. |
| 23 | **The arithmetic is `squareOrderBalance`** (`orders/orderBalance.ts`), the ONE balancing rule the order page also uses, so a document and the screen can never show two outcomes. `orderBalanceInput(order, claimsTotal)` (documentModel) builds its input — `advance` is `depositAmount` (the ANTICIPO, despite the name), `paid` is `paidAt` set, `deposit` is `{ total, collection.status }` when there is a collection, `claimsTotal` the report's. The cotización feeds it its estimate with the deposit `PENDING` and no claims. An anticipo above the service cost is credited, not clamped, paid or not (`advanceCredit`, coordinator 2026-10-27 — usually the deposit sent along with it, so once that deposit counts as IN HAND — received, or credited back by the report — the excess is read as it and only what is left over is credited; crediting both would hand the deposit back twice): the box prints `Saldo a favor del cliente -` right under the `Anticipo` row, and the `Anticipo` row then stops at the TOTAL with the amount actually received as its caption (*"Aplicado de un anticipo de Q…"*, `advanceRows`) — printing the whole anticipo AND the credit would subtract the excess twice. The damage report prints the same credit row in place of `Saldo del servicio`. |
| 24 | **Every figure is the API's** (`totalAmount`, `depositAmount`, `securityDeposit.total`, `claimsTotal` …) — the document never prices; the squared rows are the rule's output over those figures. The one estimate is the cotización's deposit, Σ rental line `product.securityDeposit × quantity`, which mirrors the server's own rule exactly like the prices beside it. |
| 25 | **A recorded report's charges are an itemised section AFTER the summary** — `DEPÓSITO Y DAÑOS` (or `DAÑOS` when there was no deposit): `Retención del depósito` with the damage description as its sub-line; `Reposición: <producto>` with `<cant.> × <valor> c/u` plus the line's note; then `Total por daños`. NOTHING else — the old `Cubierto con el depósito`, `Saldo pendiente por daños` and `Depósito devuelto` lines are gone, because the squared box carries the outcome. Damaged units are not marked in the lines table. |
| 26 | **WAIVED = the order never had a deposit** (delivered without one on purpose): no deposit row anywhere, no deposit table on the report, and damages billed whole. The waive reason is an INTERNAL note and never reaches a document — the model has no field that could carry it. |

**Why the deposit sits INSIDE the totals panel (measured, not preferred).** The first build gave it
its own panel; that made the summary ~47pt taller, and the ordinary two-bank order
(`doc:preview:free`) has ~19pt to spare, so every order with a deposit went to two pages (#15). As a
row of the squared box the free fixture with a deposit still ends on page one — at 722pt, the same as
without one, because the bank column beside it is the taller side. ⚠️ Re-run
`pnpm doc:preview:free -- --deposit=held` after any change to the summary.

**The `DEPÓSITO Y DAÑOS` panel is its OWN block after the summary, and moves WHOLE** (owner,
2026-10-27; supersedes the first build, which nested it inside the summary's `wrap={false}`). Nested,
summary + panel was one atomic block of well over half a page, so the panel dragged the totals,
conditions and banks to page two with it, and a settlement taller than a page would have overflowed
the sheet (react-pdf does not split a `wrap={false}` node — it leaves it overflowing and drops what
falls off). Now the summary closes where it
can and the panel follows: heading and panel are ONE `wrap={false}` wrapper, so the panel never
splits and its heading is never orphaned — the same contract §8a gives the totals block. The
oversized case (a panel taller than a page) and the margin rule are §8a rule 5.

**Addendum to #19 — how the divider is actually implemented** (supersedes the "`groupTitle.marginTop`
/ `summary.marginTop`" mechanism described above, which was the first attempt):

- The rule is **HALF the content width and centred by explicit margins**, not `alignSelf: 'center'` —
  react-pdf resolved a percentage width against a box that put it off to one side (`documentTheme.ts`).
- **The divider OWNS the whole gap** (`DIVIDER_GAP_TABLE = { above: 15, below: 10 }`,
  `DIVIDER_GAP_SECTION = { above: 21, below: 16 }`) and the element that follows carries **no top
  margin of its own**. Two elements each contributing half of a gap is how the rule ended up nearer
  one side, and a rule nearer one side reads as BELONGING to that block — at 9pt under a table and
  16pt above the next it looked like the first table's bottom border, which is the reading the
  detachment exists to prevent.
- The gap still differs by context, which is decision #19's point: one table to the next is a step
  within a list (`DIVIDER_GAP_TABLE`), the tables to the summary is a change of section
  (`DIVIDER_GAP_SECTION`). `OrderDocument` picks between them by whether the group is the last one.

### 2c. The REPORTE DE DAÑOS (owner, 2026-10-27)

The client-facing account of the pickup review: what was received, what was kept and why, what was
lost or broken, and how the order squares with it. `DamageReportButton` (`{ order, settlement }`, a
soft `sm` button) builds `DamageReportModel` with `fromDamageReport` and renders
`DamageReportDocument` through the same lazy renderer; failure is the same toast as the comprobante.

| # | Decision |
|---|---|
| 27 | **It is THE damage report, never a draft** (owner, 2026-10-27: "it is generated from what the admin entered — it is the damage report, not a sketch"). The settlement it is given — the saved one, or the report form's values before saving — prints the same way: no BORRADOR mark, no review date, no `-borrador` file name. Its one date is the issue date, the download moment. File: `reporte-danos-ped-00042.pdf`. |
| 28 | **Content, in reading order:** the client and event cards; **`Depósito recibido`** — per rental line with a deposit: product · quantity · deposit c/u · subtotal (absent when there was none or it was WAIVED, #26); **`Retención del depósito`** — only when `retainedAmount > 0`, its FULL description wrapped (never truncated: a PDF has no hover) and its amount; **`Piezas perdidas o rotas`** — product · units · replacement c/u · subtotal, the line's note as a caption; then the summary. No claims prints one sentence instead (with a deposit: *"…no hay cargos contra el depósito."*; without: *"La revisión al recoger no encontró daños."*). |
| 29 | **The totals end on the comprobante's result, by construction**: `Total por daños` (with a `Retención Q… + piezas Q…` caption when both kinds exist), then the squared rows (#22) — `Saldo del servicio +` when the service is still unpaid (so the number reconciles), `Depósito recibido -` — and the same result chip (`Monto a pagar` / inverted `Monto a devolver al cliente` / plain `Sin saldo pendiente`). Same `squareOrderBalance`, same order, same claims: the two documents cannot end on different amounts. |
| 30 | **One result chip per document, in the #17 sense.** The gradient marks "the one number the client must act on"; on BOTH documents that is now the squared result, and only when the client pays. A refund wears the inverted chip — the outcome, but not a request for money. |
| 31 | **The banks print only when the client pays** (`direction === 'collect'`), titled `Cómo pagar el saldo` with a one-line lead. A report that ends in a refund or at zero asks for nothing. |
| 32 | **One page for the common case** (two banks, a retention, two replacements): ~67pt spare. It was bought with choices, not by tightening spacing (#20): the retention is a HEADERLESS one-row table (its title already names it; ~24pt), and the claims subtotals are the one-line caption on `Total por daños`. Three banks still fit (~10pt); the 500-character reason goes to two pages, the summary moving whole. |

It is the same template file and the same furniture (`DocumentFrame`, `LineTable`, `BankList`,
`SquaredBalance`, `ResultChip`), not a fork: a change to the letterhead, the table, the result or the
pagination rules lands on all three documents at once. It prints no standing notes (it is not an
offer to accept), so its foot reserves no note lines.

---

## 3. Library — `@react-pdf/renderer` (MIT)

The reference template is a flowing table with a styled header, zebra striping, a totals block and a
footer, and it must survive becoming multi-page. That rules out imperative builders (`jsPDF`,
`pdfmake` — hand-positioned rows and hand-computed page breaks) and leaves two:

- **Print stylesheet + `window.print()`** — renders our real CSS (gradients included), browsers
  already repeat `<thead>` and honour `break-inside: avoid`, zero dependencies. **Rejected** because
  the browser stamps its own header/footer on the page, we cannot set the filename, mobile Safari is
  awkward, and there is no path to emailing the file later.
- **`@react-pdf/renderer`** — real PDF bytes, our filename, identical on mobile, `fixed` views repeat
  a table header per page, `render={({ pageNumber, totalPages })}` gives "Página 1 de 2",
  `wrap={false}` stops a totals block orphaning, and the SAME template can later run on Node when a
  document needs emailing.

**Two costs, accepted knowingly:**

1. **It is heavy** — ⚠️ **MEASURED at install (2026-08-05, v4.5.1): `1,428.83 kB` raw / `481.06 kB`
   gzipped**, as its own `react-pdf.browser-*.js` chunk. That is roughly ten times `LocationPicker`
   and well past the "several hundred KB" this plan estimated, so it is recorded here rather than
   waved through. **It is lazy-loaded** (`downloadDocument` dynamic-imports the renderer *and* the
   template together on the click), and the measurement confirms the split works: the entry bundle
   moved only `+1.5 kB` raw for the whole slice. Nobody who never asks for a document pays anything.
   The click itself costs half a megabyte on mobile data, once per session — acceptable for an
   admin-only action, and the exit if it ever isn't is **rendering on the server**: react-pdf runs on
   Node, which is why it was chosen, and the same template would then emit the file (§10).
2. ~~**It has no CSS gradients.**~~ **Superseded (2026-08-06): it has SVG, and SVG has gradients.**
   react-pdf ships `Svg`/`Defs`/`LinearGradient`/`Stop`/`Rect`/`Path`, so the cream→blossom rules,
   the table headers and the balance chip are drawn as REAL gradients — no PNG strips to generate,
   version or keep in sync, and no `src/assets/documents/` directory. The same primitives draw the
   brand mark from the app's own `logoMarkPaths.ts`, so the logo on a client's document is vector and
   cannot drift from the logo in the app.

**Free wins:** reuse `public/email-logo.png` (the charcoal `LogoMark` raster already made for
emails) instead of embedding SVG paths, and use react-pdf's built-in **Helvetica**, which embeds no
font file and covers á/é/í/ó/ú/ñ/ü. Ship a font only if the design demands one.

### 3a. ⚠️ It needs THREE CSP directives — verify them, never reason about them

A third cost, discovered only by shipping it (2026-08-05, twice): react-pdf is not plain JavaScript,
and a strict CSP blocks it in ways whose only symptom is **a button that spins and produces nothing**.
`ozari-app/index.html` is the single source of the policy — no `_headers` file, no per-env build — so
these apply identically to local and deployed:

| Directive | Why react-pdf needs it |
|---|---|
| `connect-src data:` | It `fetch`es its wasm binary and font metrics from `data:` URIs it carries inline. Grants no reach: a `data:` URI cannot touch the network, so there is **no exfiltration channel**. |
| `script-src 'wasm-unsafe-eval'` | Page layout is **yoga**, an Emscripten-compiled **WebAssembly** module calling `WebAssembly.instantiate`. |
| `worker-src blob:` | Image streams are inflated in a Blob worker. Already present for Vite — do not remove it as dev-only tooling. |

**`'wasm-unsafe-eval'` must never be relaxed to `'unsafe-eval'`.** The broad token re-enables
string-to-code execution app-wide and would undo the one directive carrying real weight here; the
narrow one permits WebAssembly and nothing else. That it *suffices* is verified rather than assumed —
the built chunk scans as `WebAssembly` ×5, `eval(` ×0, `new Function` ×0. **Re-check on any upgrade.**

**How to verify, since guessing cost two rounds:** put a page carrying the exact policy in
`public/`, have it exercise all three plus a **negative control** (`new Function` must still throw),
load it through the dev server, and delete it. All four passed on 2026-08-05. Support for
`'wasm-unsafe-eval'` is Chrome/Edge 97+, Firefox 102+, Safari 16.4+; an older browser ignores the
unknown token, so only the PDF button fails there — preferred over weakening the policy for everyone.
The way to need no concession at all is server-side rendering (§10).

---

## 4. Architecture — one model, two adapters

```
DocumentModel                    ← the ONLY thing the templates read
  ├── fromOrderForm(values, products, catalog)   → cotización  (estimated figures)
  └── fromOrderDetail(order)                     → comprobante (stored figures)
```

The same pattern as `orderToFormValues` / `toCreateOrderBody`: **one template**, so the two documents
can never drift into looking like different companies. The adapters are pure functions and are where
the tests live; the react-pdf components are visual and coverage-excluded like `pageMotion.ts` and
`leafletMap.ts`.

`DocumentModel` carries the letterhead (business + banks + terms, from preferences), the client
block, the event block, the grouped lines, the computed totals, and a `kind` discriminator that
drives the title, the "sujeta a cambios" note and the PAGADO mark. **No component branches on
`kind` for anything except copy** — if the two documents ever need different layout, that is a new
model field, not an `if`.

---

## 5. Document structure

**Header** — brand tile + wordmark; `Tel.` + business phone; document type; order id (comprobante
only); issue date.

**Client block** — titled `CLIENTE`: name, phone, delivery address. *The reference template has no
client on it at all*, which is fine for something handed over in person and wrong for the record of
an order. Delivery *instructions* stay OFF: they are operational notes for the driver, not for the
client. The card TITLE is load-bearing (decision #9): `Teléfono` under `CLIENTE` can only be the
client's, which the old free-floating `Contacto` could not promise.

**Event block** — titled `EVENTO Y LOGÍSTICA`: event type; delivery date + time; pickup date + time;
**días facturados** with the per-started-day rule stated beneath it. A 3-day and a 1-day rental
otherwise render identically at different totals, which reads as an error.

**Lines, grouped, each group with its own columns and subtotal:**

| Group | Columns |
|---|---|
| Alquiler | `Descripción · Cantidad · Días · Precio por día · Subtotal` |
| Venta | `Descripción · Cantidad · Precio unitario · Subtotal` |
| Extras (`serviceExtras`) | `Descripción · Cantidad · Precio unitario · Subtotal` |

A group with no lines is omitted entirely — never an empty table with a heading. There is **no
per-table subtotal row**: the totals block already lists every group's subtotal, and a lone table
under a lone subtotal that then repeats it reads as an arithmetic mistake rather than as a summary.

**The closing block is TWO columns, `wrap={false}` as a whole** — the conditions and the deposit
details qualify the very figures beside them, so a page break must not come between them:

- *Left* — **`CONDICIONES`** (the derived free-delivery line first, then the admin's standing ones)
  and **`DATOS PARA DEPÓSITO`** (each account: the bank's mark, account type, number, holder). This
  column exists because the space was already there and because the information belongs there: the
  client reads what they owe and finds where to pay it without moving their eyes.
- *Right* — `Subtotal Alquiler` · `Subtotal Venta` · `Subtotal Extras` · `Servicio a domicilio`
  (with `Incluye entrega y recolección`, or "Gratis" when 0) · `Descuento (−)` · **`TOTAL`**, then
  the SQUARED rows, each only when not zero (§2b #22–#23): `Anticipo -` · `Pagado -` ·
  `Saldo a favor del cliente -` (an anticipo above the TOTAL, net of a deposit in hand) ·
  `Depósito (reembolsable) +` (before the review) · `Daños +` and `Depósito recibido -` (after it),
  ending on ONE result — `Monto a pagar` (gradient chip), `Monto a devolver al cliente` (inverted
  chip) or a plain `Sin saldo pendiente` row. A deposit received before the review is an info line
  under the result, outside the sum. The **PAGADO** mark rides in the header when `paidAt` is set.

**After the closing block**, as its own atomic block, the `DEPÓSITO Y DAÑOS` panel (`DAÑOS` without a
deposit) when a settlement claimed anything (§2b #25, §8a rule 5): the itemised charges and
`Total por daños` — nothing else; the outcome is the squared box above.

**Page furniture, `fixed` on every page:** the acceptance line (and, on a quote, the "sujeta a
cambios" notice) sit in the bottom padding above the **page number**. They are absolutely positioned
rather than laid out because in flow that single centred line cost ~30pt including its margin, and a
document ending within 30pt of the bottom sent that line — and nothing else — to a second sheet. A
page containing one sentence reads as a bug, and a standing legal reference is furniture anyway.

✅ **The terms are also READABLE, through their own public door** (2026-08-05). Asking somebody to
accept a document they cannot read is the gap this closed: the register screen now offers "Leerlos"
beside the acceptance checkbox, opening the text in a modal — but ONLY when terms are actually
published (empty or whitespace ⇒ no link at all, since a control opening an empty dialog reads as a
broken app rather than as a business without terms). It reads **`GET /legal/terms`**, a public,
rate-limited endpoint in its own tiny module: widening the Admin-only `/preferences` would have
handed an anonymous visitor every catalog, operational rule and bank account in order to publish one
paragraph, so the preferences router's "STRICTLY Admin, every route" invariant stays intact. This is
the narrower endpoint §10 anticipated; a client-facing quote link would extend it, not `/preferences`.
The text renders as plain text with its line breaks kept, never as markup.

⚠️ **The FULL terms are REFERENCED, never transcribed** (owner decision 2026-08-05, refined by #11
above on 2026-08-25 — the short `documents.conditions` block IS printed). `documents.terms`
is stored so it can be quoted, sent or shown on request — but the document prints one short,
neutral line pointing at it, e.g. *"La aceptación de este documento implica la conformidad con los
términos y condiciones del servicio."* Two reasons, and both matter: a wall of conditions on a
quote makes it read like a contract nobody signed rather than a price the client asked for, and it
pushes the totals — the one thing they are actually looking for — onto a second page. The line is
its own i18n string, not the admin's text, so it stays professional regardless of how the terms
themselves are written. A document with EMPTY terms omits the line entirely: referring to
conditions that do not exist would be worse than saying nothing.

---

## 6. Preferences additions

Everything printable that is business policy lives in Preferences, never in the template. Per the
existing rule, these keys land **in the same commit as the code that reads them**.

**Scalar settings** (`preferences.service.ts` registry) — group `documents`:

| Key | Purpose |
|---|---|
| `documents.businessName` | Legal/display name in the letterhead |
| `documents.businessPhone` | Contact line in the footer |
| `documents.terms` | The business's FULL conditions. **Stored, not printed** — the document carries an acceptance line referring to them (§5), and `GET /legal/terms` publishes them |
| `documents.conditions` | The short conditions the document DOES print, **one per line, at most four** (`documentModel` splits, trims and caps). Multiline, ≤400 chars. Seeded with the two lines the hand-made template carried; the code FALLBACK is empty — a missing row must print nothing rather than put a policy nobody wrote into a business's mouth |
| `documents.freeDeliveryNote` | Printed **only when the order's delivery fee is exactly 0**. Single line, ≤120 chars, seeded "Domicilio gratis en Hacienda Real." The condition is derived and the wording is the admin's — see decision #12 |
| `documents.quoteValidityDays` | "Cotización válida por N días" |

**New catalog** (`preferences.catalogs.ts` — one registry entry, no route changes):

`bankAccounts` → `bankKey` (from a fixed list we ship logos for, or none) · `label` ·
`accountType` · **`accountNumberKms`** · **`holderKms`**

**The two `*_kms` columns are the answer to decision #8.** They follow the repo's existing PII
pattern (`encryptKms`/`decryptKms`): nothing sensitive is in git, nothing is in an env var (which
would need a redeploy to change and could not be admin-edited), and the plaintext only exists for
an authenticated Admin through the already-Admin-only `/preferences`. It is *semi*-public by nature
— the numbers appear on a document the admin hands to a client — so the requirement is precisely
"not in the repo, not for anonymous eyes", which this satisfies exactly.

⚠️ **Deletion follows the conditional NO-TRASH rule**, and bank accounts are referenced by nothing —
so they **hard-delete**. A past PDF is already generated; it does not hold a live FK.

⚠️ **This catalog starts EMPTY on every database and is seeded with NOTHING** (`minimumActive: 0`) —
these are the owner's own accounts and we could not invent them. A document therefore prints exactly
the accounts an admin has entered under **Preferencias → Documentos**, and only the PUBLISHED ones
(an unpublished account is one the admin retired; printing it would invite a deposit into an account
the business no longer watches). **"Only one bank appears on the PDF" is always this** — the second
account has not been added, or it is inactive. There is no per-document limit and no hardcoded list.
The only bank data anywhere in the repo is the two **logo PNGs**, which are public brand assets.

---

## 7. Assets the owner must add

### Bank logos — `ozari-app/src/assets/banks/`

| File | Bank |
|---|---|
| `banrural.png` | Banrural |
| `bac.png` | BAC Credomatic |

**PNG, transparent background, ~256×64** (they are horizontal lockups; rendered at a fixed height,
so any aspect works — the component letterboxes rather than distorting). Keep them a few KB.

✅ **Both files are in place, downscaled and EMBEDDED (2026-08-25).** They arrived as press assets
(`banrural.png` 6650×3500 / 474 KB, `bac.png` 967×330 / 66 KB) and are now 260px wide (~12 KB and
~15 KB) — roughly 4× the ~70pt slot they print in, which survives a zoom and a home printer.
Re-downscale rather than committing a full-resolution replacement.

They are imported with Vite's **`?inline`** suffix (`documents/bankLogoImages.ts`), i.e. as base64
`data:` URIs rather than hashed URLs, because a URL would have to be FETCHED — a network request
governed by the CSP in the browser, and in `pnpm doc:preview` (a Vite SSR build run under Node) a
request to a server that does not exist, so the preview would silently render logo-less pages and
stop being a preview. Only `OrderDocument` imports that module, so the base64 rides in the lazy PDF
chunk beside the renderer that needs it. `preferences/bankLogos.ts` still imports NEITHER file.

Two rules a new mark must satisfy, both **asserted** by `bankLogoImages.test.ts` rather than left as
"check a render": every key in `BANK_KEYS` has an entry, and `height × aspect` fits
`BANK_MARK_WIDTH` (past that the slot crops the mark — which is how BAC's "CREDOMATIC" lost its last
letter the first time these were used; the test decodes each PNG's IHDR to check it). **The height
belongs to the mark, not to the layout**: Banrural's wordmark is ~29% of its artwork and BAC's ~64%,
so a shared height prints one bank's name at half the size of the other's, and the row reads as a
mistake. Matching the WORDMARKS is what makes two marks read as equals, and no formula derives that
from the pixels.

The catalog's `bankKey` picks from the keys we ship — the list is mirrored in
`preferences.catalogs.ts` (`BANK_KEYS`) and `bankLogos.ts`, so a new bank is the asset plus BOTH
lists in one commit. **"Sin logo" (`null`) is always available** and is the fallback, so an admin can
add any bank without an asset. A logo-upload flow (R2, the presign machinery already exists) is a
door, not v1.

### Brand gradient strips — `ozari-app/src/assets/documents/`

Created by us during implementation, not by the owner: `brand-bar.png` (the full-bleed top/bottom
rule) and `accent-fill.png` (the table-header and total-block fill), because react-pdf has no CSS
gradients (§3).

---

## 8. Edge cases to design for

**Layout** — table header repeats on every page; totals block never splits or orphans; footer only
on the last page; "Página 1 de 2" on every page; long product names **wrap, never truncate** (a PDF
has no hover); the row stripe stays coherent across a page break.

**The stripe alternates two FILLS, never a fill and the page** (2026-08-26). Fill-vs-nothing only
reads as a pattern once a table has enough rows to show one, and the ordinary group here is one or
three lines — the row under the header was bare paper, so the table had no visible body. Two tones
(`ROW_BASE`/`ROW_ALT`) make it a block at any length and keep the alternation at its previous
strength. This also fixed a rule that had been conditional without anyone noticing: the last row's
rounded bottom corners only appeared on an ODD row count, since a row with no fill has no corner to
round.

**A cut table closes as cleanly as a finished one, and the mechanism is inverted** (2026-08-26). A
page break ends that page's table as far as the reader is concerned, so the segment needs the corners
the real end has — but which row ends a page is a layout OUTCOME, so no row can be told that it is
the one. Instead EVERY row is rounded at the bottom and every row after the first repaints its
predecessor's two corner slivers in that predecessor's tone (`cornerWedgePath`). Mid-table the repair
is invisible; at a break the patch travels to the next page with its row, the slivers stay open, and
the segment rounds itself.

Two approaches that look right and are not, so nobody pays for them twice:
- `overflow: 'hidden'` + bottom radii on the rows' container. `splitNode` in `@react-pdf/layout`
  explicitly sets `borderBottomLeftRadius`/`borderBottomRightRadius` to `0` on the fragment it leaves
  behind — the CSS-fragmentation rule that a broken box does not draw its end edge — and stretches
  that fragment's height to the page foot, so the corners would sit below the last row regardless.
- Patching the corner SQUARE rather than the sliver. On a continuation page the first row's patches
  land under the repeated header, where a square covers band as well as sliver and nicks a visible
  light notch out of it.

**The table header keeps all four of its corners.** `TableHeadFill` draws two shapes in one atomic
`Svg`: the row tone in a rounded-top/square-bottom shape (`roundedTopPath`) underneath, then the band
on top. The backing fills the wedges the band's bottom curve would otherwise cut out of the table's
sides, so the sides run unbroken from header into rows. Squaring the header's own bottom produces the
same picture but alters the element that was already correct.

**Data** — purchase-only order (no pickup ⇒ no rental section, no days, no pickup row); mixed
rental + sale; multi-day rentals; delivery fee absent or 0 ("Gratis"); discount present;
deposit/balance; `serviceExtras`, which the reference template ignores entirely; a currency that is
not GTQ (symbol from the order, per the repo-wide rule — **never a hardcoded `Q`**); a client with
no saved address; accents and ñ (Helvetica covers Latin-1).

**Refusals** — cancelled order ⇒ no action rendered; invalid form ⇒ button disabled with the reason.

---

## 8a. Pagination — the five rules, and why the JSX shape is load-bearing (2026-08-26)

A second page revealed that the layout had no pagination rules at all, only values that happened to
look right on page one. All four fixes are structural; **none of them survives "tidying" the JSX**,
so read this before moving a `View`.

**Verify with the harness, never by eye.** `pnpm doc:preview -- --rows=N` renders the rental group
with N filler lines, which walks the page break through every position in the column. The bugs below
each live in a ~30pt window — every one of them was invisible at the row counts the fixture happened
to use, and reproducible on demand once N could be swept. `--rows=15`/`16` reproduce the orphaned
title; the 30-line `--long` reproduces the stranded rule.

1. **Clearance belongs to the FURNITURE, not to the content beside it.** The gap under the letterhead
   was `facts.marginTop` — a rule about the facts block, so it held on page one and nowhere else, and
   page two ran its first table row into the letterhead. It is `header.marginBottom` (`HEADER_GAP`)
   now, on the `fixed` element itself, so it repeats with what it separates. Same for the foot:
   `footerPadding(noteCount)` reserves the standing notes **that this document actually prints** plus
   `FOOTER_CLEARANCE`. Deriving it is what makes the clearance affordable — the old flat `58` was
   sized for a quote's two notes, so a receipt paid for a line it never prints, and simply adding the
   clearance on top cost the one-page target a whole second sheet. The notes array is built once and
   both rendered and measured from it.
2. **A group's title, its column labels and its first row travel together** (`GROUP_HEAD_AHEAD`,
   `minPresenceAhead` on the title). This is the fix for the reported artifact: a heading alone at the
   foot of a page announcing a table that is not there, with a clipped grey band under it.
   ⚠️ **It only works because the title is a PAGE-LEVEL sibling.** react-pdf's `shouldBreak` ignores
   `minPresenceAhead` unless the node has a non-fixed previous sibling on the page
   (`breakingImprovesPresence` — "you are already at the top of your box"), and a title nested as the
   first child of a per-group wrapper is *always* in that position. That is why the prop appeared to
   be a no-op on the group, on the header and on the title alike across two attempts. Re-nesting the
   title to tidy the markup silently restores the bug.
3. **The header's own `View` is what SCOPES the repeat.** A `fixed` node repeats on every page for as
   long as its container is paginated, so a page-level header would keep labelling columns under the
   sale table and beside the totals. It shares a `View` with exactly the rows it labels — which is
   also why the header cannot live inside a `wrap={false}` block: that removes the artifact and costs
   the repeat, the entire reason this is react-pdf and not a hand-positioned builder.
4. **The closing rule is bound to the last ROW** (`wrap={false}` around the pair), not rendered after
   the table. A break could otherwise fall between them and open the next page with a lone hairline
   separating nothing — seen in a real render. The consequence is deliberate: when the pair does not
   fit, the last row goes too and the repeating header goes with it, so the table legitimately
   continues and then closes. "A rule alone at the top of a page" is now unreachable by construction
   rather than by tuning.
5. **The `DEPÓSITO Y DAÑOS` panel is atomic — unless it cannot be** (2026-10-27). Ordinarily its
   heading and panel share ONE `wrap={false}` wrapper: it fits the remaining space or it moves whole
   to the next page, heading included, exactly like the totals block. But react-pdf does not split
   an oversized `wrap={false}` node — one taller than a page stays where it is, overflows the sheet
   and loses whatever falls off (`warnUnavailableSpace`) — and the API allows a settlement of up to
   50 lines with 500-character notes. So `settlementFitsOnePage` (`documentTheme`) estimates the
   panel PESSIMISTICALLY (0.6em per glyph, 90% of the page's content height, the letterhead at its
   tallest) and, only when it would not fit, renders the SPLITTABLE form instead: the heading
   becomes a page-level sibling with `minPresenceAhead={SETTLEMENT_HEAD_AHEAD}` (rule 2's mechanism,
   so it keeps its first charge), the charges stack full width as atomic rows, and Total por daños`r
   is one atomic row at the end, right-aligned (the panel is single-column in both forms since the
   squared box took the outcome, §2b #25). It then breaks only BETWEEN charges and never loses a
   line. Pessimism errs toward the splittable form, whose only cost is that it does not move whole —
   the safe direction.
   ⚠️ **The gap above it is the SUMMARY's `marginBottom` (`SETTLEMENT_GAP`), never the panel's
   `marginTop`.** A margin travels with its node, so a top margin on a block that moves to a new
   page re-appears there and pushes it ~18pt below the   Re-verified 2026-10-27 after the squared box (taller summary) with `--deposit=damages`: `--rows=1`,`2`,`10` put summary + panel together on page two; `--rows=18`,`20`,`22`,`24` keep the summary on page two and move the panel whole to page three, heading included. Oversized, `--damages=12|30` and `--damages=50 --long-reason`: 3/4/8 pages, the heading always beside its first charge, breaks only between charges, `Total por daños` intact at the end.ays beside
   its first charge, breaks only between charges, the arithmetic intact at the end.

`overflow: 'hidden'` + the atomic `SolidFill` on `tableHead` stay as a **backstop**, not the fix:
rule 2 reserves a *single-line* row, so a taller first row can still leave a sliver. A hairline is an
acceptable failure; a full set of column labels under someone else's table is not.

---

## 9. Phases

**Phase 0 — Preferences. ✅ BUILT 2026-08-05.** The four `documents.*` settings + the `bank-accounts`
catalog with its two encrypted columns; migration
(`20260805000000_documents_bank_accounts`), API, the Preferencias screen's new **Documentos** tab,
tests, OpenAPI. Nothing renders a PDF yet. *An admin can now enter their bank details, letterhead
and terms and see them persist.*

What Phase 0 actually changed, since it reshaped two things Phase 1 builds on:

- **Settings are no longer int-only.** `SettingDefinition` / `PreferenceSettingModel` /
  `PreferenceSetting` are now a discriminated `int | text` union on BOTH sides. A `text` carries
  `minLength`/`maxLength`/`multiline`, and **`multiline` is a validation RULE the API enforces** (a
  newline in `documents.businessName` is a `400`), not a hint to draw a textarea — even though the
  client reasonably reads it as one. `writeSettings` now stores the DECLARED `valueType`, so a text
  setting stops announcing itself as an int to anything reading the table raw.
- **The catalog registry grew two field kinds** — `text` (bounded required string) and `token` (one
  of a fixed list, or `null`) — and the validator now writes extras **by field NAME**
  (`assignExtra`). The old per-kind hardcoding (`data.minLeadHours = raw`) only worked while each
  kind had exactly one field; the bank account's three strings are what broke that.
- **`bank-accounts` is the first catalog with ENCRYPTED columns and with `referencedBy: []`.** The
  empty declaration is load-bearing: nothing holds a FK to a bank account, so the conditional
  NO-TRASH rule collapses to "always a real delete". Its `readSecret` is TOTAL like `decodeCoords` —
  an undecryptable value reads as blank rather than 500-ing the very screen an admin would open to
  fix it.
- **`PreferenceTabs` derives its columns and pill width from `PREFERENCE_TABS`.** It was hardcoded
  to three (`grid-cols-3`, a `33.333%` pill); a fourth group would have overflowed it silently.
- **⚠️ The one rule this phase bent, knowingly — now CLOSED:** "only settings the system HONOURS are
  editable" (owner rule 2026-07-29). The four `documents.*` keys were editable one phase BEFORE the
  code that reads them, because Phase 0 exists precisely so the owner can enter and verify the
  letterhead before a PDF exists. Phase 1 shipped and reads all of them, and the two keys added in
  1b were added *with* the code that prints them, so the exception `preferences.service.test.ts`
  recorded is gone.

**Phase 1 — The comprobante. ✅ BUILT 2026-08-05.** `DocumentModel` + `fromOrderDetail`, the shared
template (`OrderDocument.tsx`, coverage-excluded like `leafletMap` — react-pdf's primitives are not
DOM and jsdom cannot drive its layout engine), the lazy-loaded renderer (`downloadDocument.tsx`) and
the download action on the order detail. Server-computed figures only.

Two rules this phase settled, both owner decisions on 2026-08-05:

- **The document is offered at EVERY step except a cancelled order.** It is not a receipt waiting for
  payment — it is how the admin tells a client what they owe, so an order still `En ruta` is exactly
  when it is most useful. Once `paidAt` is set the same page comes back carrying the **PAGADO** mark
  and a **balance of zero**. One document, two meanings, which is why it is gated on neither the
  lifecycle nor payment. A cancelled order renders NOTHING (not a disabled button: a greyed control
  invites a hunt for the condition that would enable it, and there isn't one).
- **The design is verifiable, and that is the point** (2026-08-06). The first draft shipped entirely
  monochrome — no brand anywhere — with the business name overlapping its own phone number. None of
  that is catchable by a test: `OrderDocument` is coverage-excluded exactly because jsdom cannot
  drive react-pdf's layout engine, so "does it look right" has no assertion, only a pair of eyes.
  **`pnpm doc:preview`** (`scripts/preview-document.tsx`) renders the template from a deliberately
  awkward fixture — a wrapping product name, both groups, a discount, a deposit, three banks — to a
  PDF; `pnpm doc:preview:long` renders 30 lines to check pagination. It bundles through **Vite**, not
  `tsx`, so the preview is transpiled exactly as the app transpiles it.
  Three bugs it caught that reading the code could not, all of them PDF-medium traps:
  1. **`−` (U+2212) silently vanishes.** Helvetica is a base-14 font encoded in WinAnsi, which has no
     typographic minus, so react-pdf dropped it: "Descuento  Q 100.00" read as a charge rather than a
     credit. Use ASCII `-`; anything outside Latin-1 needs a render to trust.
  2. **An absolutely-positioned element resolves against the page's PADDING box.** The page number
     was inset by the margin on top of that, landed outside the measured area, and rendered nothing
     at all — no error, just an absent element. `left: 0, right: 0` is correct there.
  3. **`lineHeight` resolves against the CONTAINER's font size, not the text's.** A 15pt heading
     inheriting the page's body line height collapsed onto the line below it. Every heading now
     declares its own.
- **A paid order zeroes the BALANCE, never the TOTAL.** A receipt claiming a total of `Q0.00` would
  be evidence that nothing was ever charged, which is the opposite of what a paid order should prove.
  The balance is also clamped at zero, the same stance the dashboard's outstanding figure takes: a
  deposit larger than the total is a slip, not the business owing the client money. *(Superseded
  2026-10-27: the excess anticipo is now credited — `Saldo a favor del
  cliente`, §2b #23.)*

**Phase 1b — the legibility + layout pass. ✅ BUILT 2026-08-25**, from the owner reading a generated
comprobante beside the template it replaces. The copy and structure decisions are §2a; two settings
(`documents.conditions`, `documents.freeDeliveryNote`) and the embedded bank marks are §6 and §7.
What the pass taught about the MEDIUM, all of it found by rendering and none of it catchable by a
test:

1. **react-pdf centres the LINE box, not the glyphs**, and the box is not symmetric about the ink:
   the baseline sits at the font's ascent from the top, so the descender room below it — which
   `Saldo pendiente`, `TOTAL` and a table heading mostly do not use — is counted as if it were ink,
   and the visible letters land BELOW the middle. `opticalCenterPad(fontSize)` (`documentTheme`) is
   the correction: padding shifts centred content by HALF of what is added, and it goes at the
   BOTTOM because the lift is upward. ~0.175 × the largest font size in the row.

   ⚠️ **This shipped WRONG once, in the direction as well as the size, and the reason generalises to
   any visual check** (2026-08-25 → 26). The first attempt reasoned from font metrics that the
   glyphs "must sit high", added TOP padding, and was confirmed by a preview raster — which was
   silently substituting a **serif** for Helvetica because its font pack had failed to load, so
   every glyph sat somewhere else entirely. The owner saw the real output and reported the opposite
   problem. Two rules out of it: **check that a preview render is actually using the real font
   before trusting anything vertical in it**, and **measure pixels rather than reasoning about
   ascents** — the fix was found by scanning the rendered chip for its gradient band and its dark
   ink and subtracting, which took minutes and left no room for a theory to be wrong.
2. **react-pdf hyphenates by default**, an English-typesetting habit that printed a bank's name as
   "Banco Indus-trial". `Font.registerHyphenationCallback((w) => [w])` at module scope turns it off
   document-wide; Spanish business documents do not break words.
3. **A `fixed` node leaves a copy behind when its content turns out not to fit.** A group whose flow
   slot lands in the last few points of a page has its header laid out there and then relocated —
   and because the labels are absolutely positioned they ESCAPED the clip and printed in full,
   putting a whole set of column headings under the last row of a different table. The header's
   shape is therefore load-bearing in three separate ways, and all three were paid for:

   - `overflow: 'hidden'` on the outer box, or the absolutely positioned labels escape the clip.
   - The fill is an atomic **`Svg`** (`SolidFill`), NOT the box's `backgroundColor`. A background
     belongs to the View, so react-pdf paints the entire leftover strip and the clipped labels ride
     along with it — ~10pt of legible, duplicated headings. An `Svg` is atomic, so the clip contains
     it to a hairline. Flattening the header to normal flow with a `backgroundColor` looked like a
     tidy simplification and reintroduced the bug on 2026-08-26, one day after it was fixed.
   - A fixed height on the box, so the fragment left behind is bounded.

   Three fixes that do NOT work, so nobody pays for them twice: `minPresenceAhead` anywhere (the
   header is emitted and only then moved); `wrap={false}` on the header itself (a `fixed` node is
   emitted regardless); and `wrap={false}` on a title+header+first-row block — that one removes the
   artifact but costs the repeat, since the continuation page then has no column labels, which is
   the entire reason the header is `fixed`. What survives is a ~2pt hairline of grey, the accepted
   residue, and only when a group's flow slot lands within a couple of points of a page bottom.
4. **`pnpm doc:preview:free`** joins `--long`: the REAL letterhead (two banks) with the fee at zero,
   no discount and no deposit. It checks the derived free-delivery condition and the "Gratis" value,
   and it is the variant to watch for the one-page target (#15). The default fixture keeps three
   banks and a wrapping product name — the awkward case — and runs to TWO pages (it did already
   before the 2026-10-27 deposit work; the closing block moves whole, which is #20's accepted trade).
   `--free` is the one-page check.

**Phase 2 — The cotización. ✅ BUILT 2026-08-26.** `fromOrderForm` + `QuoteDocumentButton` in the
order form's footer: the "sujeta a cambios" notice, a validity date and no order number. Same
template, same vocabulary, unsaved figures. `pnpm doc:preview:quote` renders it.

**Security deposit (§2b) — ✅ BUILT 2026-10-27, squared the same day.** Previews: `pnpm doc:preview:deposit`
(pending, before the review), `:refunded` (clean review), `:damages` (retention + two replacements,
more than the deposit covers, on a paid order). The flag behind them,
`--deposit=held|refunded|retention|damages|uncovered`, composes with `--free`, `--quote`, `--long`
and `--rows=N`; `retention` = a retention alone (`--retention=N`, default 200), `uncovered` =
replacements on lines with no deposit. `--collection=pending|received|waived` sets the deposit's
collection, `--paid` / `--unpaid` the payment, `--advance=N` the anticipo. `--damages=N` adds N filler
replacements and `--long-reason` makes the retention reason and every note 500 characters — together
they reach the oversized panel (§8a rule 5). Every run prints `squared: <direction> <amount> (…)`, the
`squareOrderBalance` result, so the PDF's chip can be checked against the rule.

Inspected 2026-10-27, one render each: the cotización with a deposit and an unpaid order with it
pending (collect, `Depósito (reembolsable) +`); paid with the deposit received before the review
(`Sin saldo pendiente`, the deposit as the info line); a clean review (refund 900, inverted chip); a
small retention on an unpaid service (refund 872); damages above the deposit (collect 130); exactly
zero (`--retention=900`, plain row); waived + damages (collect 880, no deposit rows, panel `DAÑOS`);
no deposit (collect 45). An anticipo above the total (`--advance=5000`) is CREDITED (§2b #23):
`Anticipo -Q 2,893.00` (caption: applied from Q 5,000.00), `Saldo a favor del cliente -Q 2,107.00`,
`Depósito (reembolsable) +Q 900.00` ⇒ `Monto a devolver al cliente Q 1,207.00` — the same on the
cotización, and on the damage report (`--damage-report --unpaid --advance=5000`) `Total por daños
Q 1,030.00`, `Saldo a favor -Q 2,107.00`, `Depósito recibido -Q 900.00` ⇒ devolver Q 1,977.00 *(superseded the same day: that credited the deposit twice — the report now prints `Saldo a favor -Q 1,207.00` ⇒ devolver Q 1,077.00 = 5,000 − 2,893 − 1,030)*. An
anticipo of exactly total + deposit (`--advance=3793`) ends on `Sin saldo pendiente`. A PAID
order credits the excess the same way (the first render asked a client who sent Q 5,000 for the
deposit again; fixed 2026-10-27). The two extra rows cost ~40pt: `--free --deposit=held --advance=5000` goes to two
pages, the closing block moving whole (#20's accepted trade, for a rare case).

**REPORTE DE DAÑOS (§2c) — ✅ BUILT 2026-10-27.** `pnpm doc:preview:damage-report` renders the
common report (two banks, a retention, two replacements, damages above the deposit: collect 130);
`--covered` a settlement the deposit covers (refund), `--clean` no claims (refund of the whole
deposit), `--banks=3` the third account, `--damages=N` / `--long-reason` the many-line and
long-description cases; `--deposit=retention`, `--collection`, `--unpaid` and `--advance` compose as
on the comprobante. Rendered and inspected: default, `--covered`, `--clean`, `--banks=3`, the waived,
zero and unpaid-service cases one page each (`Saldo del servicio +` when the service is unpaid);
`--long-reason` two; `--damages=20 --long-reason` four, the repeating table header on each page and
the summary moving whole to the last.
What it settled:

- **The valid-form gate is a CHECK ON CLICK, not a disabled button.** Decision #2 ("no document from
  an incomplete form") is honoured either way, but a greyed control on a twenty-field form cannot say
  WHICH field is missing and leaves the admin hunting. Clicking runs `trigger()` — the same resolver
  that guards submit, live availability caps included — so an incomplete form lights up its own field
  errors. It also matches the submit button beside it, which is enabled and validates on press. The
  one legitimate disabled state is the reference data not having loaded.
- **CREATE only.** On an edit the order already exists, so what the client should be handed is its
  comprobante; a "cotización" for something already agreed only muddies which document is
  authoritative.
- **`fromOrderForm` returns `DocumentModel | undefined`** — an unparseable delivery date, or not one
  line pointing at a product we still hold. Defence in depth behind the resolver, and `undefined`
  rather than a throw, because a missing PDF is a "tell them, nothing else changed" moment.
- **A blank delivery fee is NOT zero.** `parseMoney` reads an empty field as absent, so the document
  stays silent about delivery rather than promising "Gratis"; an explicit `0` still prints Gratis.
- **The vocabulary is shared, not copied** (`useDocumentVocabulary.ts`). "One template, so the two
  documents can never drift into looking like different companies" (§4) is only half true while each
  button assembles its own forty-leaf copy object — the layout would match and the WORDS would not.
- **The lookups arrive as DATA, not as a resolver callback.** How a quote names its subject (the
  registry client, falling back to whoever receives it) is the button's business; as a callback from
  the form that rule sat in a place its own suite could not reach.
- ⚠️ **The DÍAS column now appears only where the days actually explain the total** (`daysExplain`),
  which fixed a latent bug in the comprobante too. `rent_time_units` seeds Hora, Día, Semana, Mes and
  **Evento** — a flat per-event rate — and only a "Día" product multiplies by the window. The old
  rule printed `Días 3` beside `Precio por día` on every rental line, so an Evento line stated
  arithmetic a reader could check and disprove. The test is the ARITHMETIC rather than the product's
  time unit, because the comprobante never sees one (`OrderLine` carries prices, not pricing rules) —
  which is exactly what lets both adapters apply the same rule, so a quote and its receipt can never
  describe the same order differently.

**Phase 3 — Multi-page + polish.** Verify against a deliberately large order (30+ lines), repeated
headers, orphan control, page numbers; i18n sweep; record the measured bundle cost in §3; update
`CLAUDE.md` and EPIC-2-ORDERS §5.

---

## 10. Doors left open

Emailing a document (needs the template to run on Node — react-pdf already can, which is why it was
chosen); storing generated PDFs in R2 with stable numbering (only if a document ever needs to be
byte-identical on re-download); a delivery note / remisión for the driver to have signed; a
client-facing quote link, which would need a narrower letterhead endpoint than Admin-only
`/preferences`; per-bank logo upload; FEL certification, which would replace this whole slice with a
provider integration rather than extending it.
