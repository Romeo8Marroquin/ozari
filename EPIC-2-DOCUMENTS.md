# EPIC 2 — DOCUMENTS (cotización + comprobante de pedido)

> **Status: PHASE 0 BUILT (2026-08-05); Phases 1–3 planned.** Owner decisions below are settled;
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

1. **It is heavy** — several hundred KB gzipped. **Lazy-load it** exactly like `LocationPicker`, so
   the chunk downloads only when someone asks for a document. **Measure and record the real figure**
   in this file at install time; do not wave it through.
2. **It has no CSS gradients.** The brand bars and the table-header/total fills are small PNG strips
   stretched to width (`src/assets/documents/`), not `linear-gradient`.

**Free wins:** reuse `public/email-logo.png` (the charcoal `LogoMark` raster already made for
emails) instead of embedding SVG paths, and use react-pdf's built-in **Helvetica**, which embeds no
font file and covers á/é/í/ó/ú/ñ/ü. Ship a font only if the design demands one.

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

**Header** — brand tile + wordmark; document type; order id (comprobante only); issue date.

**Client block** — name, contact, delivery address. *The reference template has no client on it at
all*, which is fine for something handed over in person and wrong for the record of an order.
Delivery *instructions* stay OFF: they are operational notes for the driver, not for the client.

**Event block** — event type; delivery date + time; pickup date + time; **billed days**. A 3-day and
a 1-day rental otherwise render identically at different totals, which reads as an error.

**Lines, grouped, each group with its own columns and subtotal:**

| Group | Columns |
|---|---|
| Alquiler | `Descripción · Cant. · Días · Precio/día · Total` |
| Venta | `Descripción · Cant. · Precio unitario · Total` |
| Extras (`serviceExtras`) | `Descripción · Cant. · Precio · Total` |

A group with no lines is omitted entirely — never an empty table with a heading.

**Totals block** (right-aligned, `wrap={false}`):
`Subtotal alquiler` · `Subtotal venta` · `Subtotal extras` · `Envío a domicilio` (or "Gratis" when 0)
· `Descuento (−)` · **`TOTAL`** · `Anticipo (−)` · **`SALDO PENDIENTE`** — or the **PAGADO** mark
when `paidAt` is set, in which case the saldo line is replaced rather than shown as zero.

**Footer — last page only:** bank accounts, terms, business contact. **Page number on every page.**

---

## 6. Preferences additions

Everything printable that is business policy lives in Preferences, never in the template. Per the
existing rule, these keys land **in the same commit as the code that reads them**.

**Scalar settings** (`preferences.service.ts` registry) — group `documents`:

| Key | Purpose |
|---|---|
| `documents.businessName` | Legal/display name in the letterhead |
| `documents.businessPhone` | Contact line in the footer |
| `documents.terms` | The terms block ("Cualquier daño ocasionado…", "Domicilio gratis en…") |
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

---

## 7. Assets the owner must add

### Bank logos — `ozari-app/src/assets/banks/`

| File | Bank |
|---|---|
| `banrural.png` | Banrural |
| `bac.png` | BAC Credomatic |

**PNG, transparent background, ~256×64** (they are horizontal lockups; rendered at a fixed height,
so any aspect works — the component letterboxes rather than distorting). Keep them a few KB.

✅ **Both files are in place (2026-08-05)**, but `banrural.png` is **474 KB** and `bac.png` **66 KB**
— far above "a few KB", because they are full-resolution sources rather than the ~256×64 lockups
asked for. That costs nothing today (Phase 0 imports NEITHER file: the preferences list identifies
an account by the name the admin gave it, so pulling half a megabyte into the panel bundle to render
nothing would be pure waste). **Phase 1 must downscale them before embedding**, or every generated
PDF carries a needlessly large image.

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
has no hover); zebra striping stays coherent across a page break.

**Data** — purchase-only order (no pickup ⇒ no rental section, no days, no pickup row); mixed
rental + sale; multi-day rentals; delivery fee absent or 0 ("Gratis"); discount present;
deposit/balance; `serviceExtras`, which the reference template ignores entirely; a currency that is
not GTQ (symbol from the order, per the repo-wide rule — **never a hardcoded `Q`**); a client with
no saved address; accents and ñ (Helvetica covers Latin-1).

**Refusals** — cancelled order ⇒ no action rendered; invalid form ⇒ button disabled with the reason.

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
- **⚠️ The one rule this phase bends, knowingly:** "only settings the system HONOURS are editable"
  (owner rule 2026-07-29). The four `documents.*` keys are editable one phase BEFORE the code that
  reads them, because Phase 0 exists precisely so the owner can enter and verify the letterhead
  before a PDF exists. `preferences.service.test.ts` records the exception. **If Phase 1 is ever
  abandoned, these four come out with it** rather than lingering as controls that configure nothing.

**Phase 1 — The comprobante.** `DocumentModel` + `fromOrderDetail`, the shared template components,
the lazy-loaded renderer, and the download action on the order detail (hidden on cancelled orders).
Server-computed figures only. *Done when a saved order downloads a correct one-page PDF.*

**Phase 2 — The cotización.** `fromOrderForm` + the valid-form-gated button, the "sujeta a cambios"
treatment and the validity note. Same template. *Done when an unsaved but valid form downloads one.*

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
