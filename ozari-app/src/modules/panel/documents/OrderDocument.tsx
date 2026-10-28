import { Fragment } from 'react';
import {
  Defs,
  Document,
  Font,
  G,
  Image,
  LinearGradient,
  Page,
  Path,
  Rect,
  Stop,
  StyleSheet,
  Svg,
  Text,
  View,
} from '@react-pdf/renderer';
import {
  LOGO_MARK_ASPECT,
  LOGO_MARK_PATHS,
  LOGO_MARK_STROKE_WIDTH,
  LOGO_MARK_TRANSFORM,
  LOGO_MARK_VIEWBOX,
} from '@components/logoMarkPaths';
import { BANK_LOGO_MAX_HEIGHT, bankLogoFor } from './bankLogoImages';
import { documentReference, formatReference, printedConditions } from './documentModel';
import {
  BANK_MARK_WIDTH,
  BANK_ROW_GAP,
  BAR_HEIGHT,
  BLOSSOM,
  BRAND_MARK_HEIGHT,
  BRAND_TILE,
  BRAND_TILE_RADIUS,
  CHARCOAL,
  COL_DAYS,
  COL_PRICE,
  COL_QUANTITY,
  COL_TOTAL,
  CONTENT_WIDTH,
  cornerWedgePath,
  CREAM,
  DIVIDER_GAP_SECTION,
  DIVIDER_GAP_TABLE,
  DIVIDER_INSET,
  DIVIDER_WIDTH,
  fillWidth,
  footerPadding,
  GROUP_HEAD_AHEAD,
  HAIRLINE,
  HEADER_GAP,
  INK,
  MARGIN,
  MUTED,
  opticalCenterPad,
  PAGE_WIDTH,
  RESULT_CHIP_HEIGHT,
  roundedTopPath,
  ROW_ALT,
  ROW_BASE,
  ROW_MIN_HEIGHT,
  ROW_PADDING,
  SETTLEMENT_COLUMN_WIDTH,
  SETTLEMENT_GAP,
  SETTLEMENT_HEAD_AHEAD,
  SETTLEMENT_PADDING,
  settlementFitsOnePage,
  TABLE_HEAD,
  TABLE_HEAD_HEIGHT,
  TABLE_RADIUS,
  TINT,
  TOTALS_INNER_WIDTH,
  TOTALS_PADDING,
  TOTALS_WIDTH,
} from './documentTheme';
import type { SettlementRowText } from './documentTheme';
import type {
  DamageReportModel,
  DocumentBankAccount,
  DocumentDamages,
  DocumentLetterhead,
  DocumentModel,
} from './documentModel';
import type { OrderBalance } from '../orders/orderBalance';

/**
 * The rendered documents — ONE template file for the comprobante, the cotización AND the damage
 * report, so a client can never receive two pieces of paper that look like they came from
 * different companies. The comprobante and the cotización are the same component (`OrderDocument`)
 * over the same model; the damage report (`DamageReportDocument`) has its own model and body but is
 * built from the SAME parts — the frame (rules, letterhead, standing notes, page number), the fact
 * cards, the line tables with all their pagination rules, the bank block and the totals panel.
 *
 * **Coverage-excluded, like `leafletMap`.** react-pdf's primitives are not DOM elements and render
 * through its own layout engine, which jsdom cannot drive, so a test here could only assert that our
 * own mock was called. Everything that DECIDES anything — what the groups are, what the balance is,
 * which conditions print, when the button appears, what the file is called, whether a panel fits a
 * page — lives in `documentModel.ts`, `documentTheme.ts` and `downloadDocument.tsx`, which are pure
 * and fully tested. What this file holds is the LOOK, and the way to check a look is to render it:
 * `pnpm doc:preview` writes a PDF from fixture data.
 *
 * **It wears the app's brand, not a generic invoice's** (redesigned 2026-08-06 after the first draft
 * shipped entirely monochrome). react-pdf has no CSS gradients — but it does ship SVG primitives
 * including `LinearGradient`, which is how the cream→blossom rules and the balance chip are drawn for
 * real, with no PNG strips to maintain. The same trick is what makes the brand mark possible: it is
 * the app's own `LogoMark` geometry (`logoMarkPaths.ts`), drawn through react-pdf's `Path`, so the
 * logo on a client's document cannot drift from the logo in the app.
 *
 * **Every label says what it labels** (2026-08-25, after the owner read a generated one beside the
 * hand-made template it replaced). The rules that came out of that pass, and that new blocks should
 * follow:
 *
 * - *A bare value is not a fact.* A phone number under a business name reads as a mystery number
 *   until it says `Tel.`; a `Contacto` inside a card that never named the client could belong to
 *   either party. Each fact card carries a TITLE, and each row a label that survives being read
 *   alone.
 * - *An abbreviation the reader has to decode is worse than a narrower column.* `Cant.` became
 *   `Cantidad`, `Precio` became `Precio por día` (which is also what makes `cantidad × días ×
 *   precio` check out by hand), and the per-line `Total` became `Subtotal`.
 * - *Don't state a figure twice.* There is no per-table subtotal row: the totals block already
 *   lists every group's subtotal.
 * - *Fill the left half.* The conditions and bank block sit BESIDE the totals rather than under
 *   them, which is both where the eye is and the void the old layout left.
 */

/**
 * An ASCII hyphen, deliberately — NOT the typographic minus `−` (U+2212).
 *
 * Helvetica is one of the PDF base-14 fonts, which are encoded in WinAnsi: U+2212 is not in that
 * character set, so react-pdf silently DROPS it. The first render of this design printed
 * "Descuento  Q 100.00" with no sign at all, which reads as a charge rather than a credit — a
 * typographic nicety turning into a wrong number. Anything outside Latin-1 has the same problem
 * here; check a render before reaching for a fancy glyph (`×` and `—` ARE in WinAnsi, and render).
 *
 * The condition bullets are drawn as a `View` for exactly this reason: a real bullet character is
 * one more glyph to gamble on, and a 2.5pt rounded square cannot be dropped by an encoding.
 */
const MINUS = '-';

/**
 * NO hyphenation, anywhere in the document.
 *
 * react-pdf hyphenates by default, which is an English-typesetting habit: Spanish business
 * documents do not break words, and in a narrow column it produced "Banco Indus-trial" as a bank's
 * name. A wrong-looking proper noun on the line telling a client where to send money is not a
 * typographic quibble. Returning the word whole makes the layout engine wrap at spaces only.
 *
 * Module scope on purpose — this is a document-wide setting in react-pdf, not a style.
 */
Font.registerHyphenationCallback((word) => [word]);

const styles = StyleSheet.create({
  page: {
    paddingTop: MARGIN,
    // `paddingBottom` arrives PER DOCUMENT (`footerPadding`) — it reserves the standing notes that
    // this document actually prints, plus the clearance above them. The clearance belongs to the
    // padding for the same reason the gap below the letterhead belongs to the header: it has to hold
    // on every page, and only the furniture itself can promise that. A page whose content happened
    // to fill the column ran flush into the notes (2026-08-26), and because a SHORT page looked fine
    // it read as a one-off rather than as the layout having no rule at all.
    paddingHorizontal: MARGIN,
    fontSize: 9.5,
    fontFamily: 'Helvetica',
    color: INK,
  },
  // ── Header ──────────────────────────────────────────────────────────────────────────────────
  topBar: { position: 'absolute', top: 0, left: 0 },
  bottomBar: { position: 'absolute', bottom: 0, left: 0 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    // The clearance under the letterhead belongs to the HEADER, not to whatever happens to sit
    // first. It used to come from `facts.marginTop`, which is a rule about the facts block — so it
    // worked on page one and nowhere else: page two began with whatever the break left, which has
    // no such margin, and the conditions block ran straight into the letterhead (2026-08-26). A
    // margin on the repeating element is the only kind that repeats with it.
    marginBottom: HEADER_GAP,
  },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  brandTile: { position: 'relative', width: BRAND_TILE, height: BRAND_TILE },
  // The mark is centred over the tile by an absolute overlay rather than by nesting it inside the
  // gradient's `Svg`: keeping the two as siblings is what lets the tile reuse `BrandFill` unchanged.
  brandTileMark: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: BRAND_TILE,
    height: BRAND_TILE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // An EXPLICIT lineHeight on every heading. The page's inherited one is tuned for 9.5pt body copy,
  // and react-pdf resolves it against the CONTAINER's font size, not the text's — which is what
  // collapsed the business name onto its own phone number in the first draft (they overlapped).
  businessName: { fontFamily: 'Helvetica-Bold', fontSize: 15, lineHeight: 1.2, color: CHARCOAL },
  businessPhone: { fontSize: 8.5, lineHeight: 1.4, color: MUTED },
  headerRight: { alignItems: 'flex-end', gap: 1 },
  docType: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 10,
    lineHeight: 1.3,
    letterSpacing: 1.4,
    color: CHARCOAL,
  },
  docMeta: { fontSize: 8.5, lineHeight: 1.4, color: MUTED },
  // The PAGADO mark. Charcoal and weight, never the gradient (decision #17): it states what the
  // document IS, it is not a figure to act on.
  headerMark: {
    marginTop: 6,
    paddingTop: 3,
    paddingBottom: 3 + opticalCenterPad(8),
    paddingHorizontal: 9,
    borderRadius: 9,
    backgroundColor: CHARCOAL,
    color: '#ffffff',
    fontFamily: 'Helvetica-Bold',
    fontSize: 8,
    lineHeight: 1,
    letterSpacing: 1.6,
  },
  // ── Facts ───────────────────────────────────────────────────────────────────────────────────
  //
  // The vertical rhythm from here down is tuned so that an ORDINARY order — a handful of rental
  // lines, a couple of sale lines — lands on ONE page. That is not a cosmetic preference: the
  // summary block is `wrap={false}`, so a page that runs even a few points short pushes the totals,
  // the conditions and the bank details wholesale onto a second sheet and leaves the first half
  // empty. The first render of this layout missed by three points and did exactly that.
  // No `marginTop`: the gap under the letterhead is the letterhead's (`HEADER_GAP`), so that it
  // holds on every page rather than only on the one this block happens to start.
  facts: { flexDirection: 'row', gap: 12 },
  factCard: {
    flex: 1,
    backgroundColor: TINT,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    gap: 6,
  },
  // The card TITLE is what makes every row beneath it unambiguous: `Teléfono` under `CLIENTE` can
  // only be the client's, which the old free-floating `Contacto` could not promise.
  factTitle: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 8,
    lineHeight: 1.3,
    letterSpacing: 1.1,
    color: CHARCOAL,
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: HAIRLINE,
  },
  factLabel: { fontSize: 7, lineHeight: 1.25, letterSpacing: 0.9, color: MUTED },
  factValue: { fontSize: 9.5, lineHeight: 1.3, color: CHARCOAL },
  factHint: { fontSize: 7, lineHeight: 1.35, color: MUTED },
  // ── Tables ──────────────────────────────────────────────────────────────────────────────────
  // No `marginTop`: every table after the first is preceded by a divider, and the divider owns the
  // WHOLE gap so that it stays centred in it (see `DIVIDER_GAP_TABLE`). The first table carries its
  // own top margin per-instance, since the only thing above it is the facts block.
  groupTitle: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 10.5,
    lineHeight: 1.3,
    color: CHARCOAL,
    marginBottom: 6,
  },
  firstGroupTitle: { marginTop: 16 },
  /**
   * A patch that repairs the corners of the row ABOVE — and, by not existing at a page break, is
   * what rounds the end of a cut table.
   *
   * A page break ends that page's table as far as the reader is concerned, so the segment has to
   * finish with the corners the real end has; flat ones read as the sheet having been sliced (owner,
   * 2026-08-26). Which row ends a page is a layout OUTCOME, so no row can be told that it is the
   * one — the rule has to work without knowing.
   *
   * So it is inverted: EVERY row is rounded at the bottom, and every row after the first covers its
   * predecessor's two corner notches with a patch in that predecessor's own tone. Mid-table the
   * repair is invisible (the patch is the colour it replaces) and the rows read as one block. At a
   * break the next row is on the NEXT PAGE, so the patch goes with it and the notches simply stay
   * open — the segment rounds itself, for free, wherever the engine happens to cut.
   *
   * Two things that do NOT work, so nobody pays for them twice. `overflow: 'hidden'` plus bottom
   * radii on the rows' container looks like the obvious answer and cannot work: `splitNode` in
   * `@react-pdf/layout` explicitly sets `borderBottomLeftRadius`/`borderBottomRightRadius` to 0 on
   * the fragment it leaves behind — the CSS-fragmentation rule that a broken box does not draw its
   * end edge — and stretches that fragment's height to the page foot, so the corners would be below
   * the last row even if the radii survived. And a full-width strip instead of two corner patches
   * paints over the bottom quarter of the repeated table header on every continuation page.
   *
   * The patch is `TABLE_RADIUS` square and sits one radius ABOVE its own row, which is exactly the
   * corner box; it is absolutely positioned so it costs no layout.
   */
  cornerPatch: {
    position: 'absolute',
    top: -TABLE_RADIUS,
    width: TABLE_RADIUS,
    height: TABLE_RADIUS,
  },
  /**
   * A NEUTRAL band, not the brand gradient (owner rule, 2026-08-26 — see `TABLE_HEAD`).
   *
   * The shape — a relative box, an absolutely positioned fill, an absolutely positioned label row,
   * `overflow: 'hidden'` — is CORRECTNESS, not decoration, and every part of it was paid for:
   *
   * A `fixed` node is laid out on the page that is current when react-pdf reaches it, and the copy
   * it leaves behind when the content it heads turns out not to fit is NOT discarded. So a group
   * whose flow slot lands in the last few points of a page prints a partial header there as well as
   * a proper one on the continuation. `overflow: 'hidden'` is what keeps that leftover to a
   * hairline — without it the absolutely positioned labels escape the clip and print in full,
   * putting "Descripción · Cantidad · Precio unitario" under the last row of a different table
   * (2026-08-25). And the fill must be an atomic `Svg` (see `TableHeadFill`) rather than this View's
   * `backgroundColor`, or react-pdf paints the whole leftover strip and the labels ride along with
   * it — which is exactly what a "simplification" to flow layout reintroduced on 2026-08-26.
   *
   * The clip is now a BACKSTOP rather than the fix: `GROUP_HEAD_AHEAD` keeps a title, its header and
   * its first row on the same page, so the leftover copy stopped being produced in the ordinary case
   * (2026-08-26). It stays because the keep-together rule reserves a SINGLE-line row, and a taller
   * first row can still leave a sliver — a hairline is the acceptable failure, a full set of column
   * labels under someone else's table is not.
   *
   * Two fixes that do NOT work, so nobody pays for them twice: `wrap={false}` here (a `fixed` node is
   * emitted regardless), and `wrap={false}` on a block holding the title + header + first row (it
   * removes the artifact but costs the repeat — the continuation page then has no column labels,
   * which is the entire reason the header is `fixed`).
   */
  tableHead: { position: 'relative', height: TABLE_HEAD_HEIGHT, overflow: 'hidden' },
  tableHeadRow: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: TABLE_HEAD_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: opticalCenterPad(8),
    paddingHorizontal: ROW_PADDING,
  },
  headCell: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 8,
    lineHeight: 1,
    letterSpacing: 0.3,
    color: CHARCOAL,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: ROW_MIN_HEIGHT,
    paddingVertical: 5,
    paddingHorizontal: ROW_PADDING,
  },
  cell: { fontSize: 9, lineHeight: 1.35, color: INK },
  cellStrong: { fontSize: 9, lineHeight: 1.35, color: CHARCOAL },
  cellNote: { fontSize: 7.5, lineHeight: 1.4, color: MUTED },
  /**
   * A SECTION divider, not the table's bottom border.
   *
   * The distinction is DETACHMENT, not weight. Drawn tight under the last row it reads as part of
   * the table — a border the other three sides do not have. With air above it, it reads as what it
   * is: the rule between one block and the next.
   *
   * Thinning it to 0.5pt was tried alongside the detachment and reverted: once the rule is no longer
   * touching the table it has to carry the separation on its own, and a half-point hairline is too
   * quiet to divide two sections. Detached AND full weight is the combination that works.
   *
   * Centred HORIZONTALLY by explicit margins, not `alignSelf` (see `DIVIDER_WIDTH`), and centred
   * VERTICALLY by carrying the whole gap itself — the vertical margins arrive per-instance, because
   * how much air the rule needs depends on what follows it.
   */
  tableEnd: {
    height: 1,
    width: DIVIDER_WIDTH,
    marginLeft: DIVIDER_INSET,
    marginRight: DIVIDER_INSET,
    backgroundColor: HAIRLINE,
  },
  // ── Summary (conditions + deposit details beside the totals) ────────────────────────────────
  // No `marginTop`: the divider above it owns that gap (`DIVIDER_GAP_SECTION`, deliberately wider
  // than the step between two tables — what follows is not another table but a different section:
  // what is owed, and where to pay it. At the table spacing it read as a third table in the list).
  summary: { flexDirection: 'row', gap: 24, alignItems: 'flex-start' },
  summaryNotes: { flex: 1, paddingTop: 2, gap: 13 },
  blockTitle: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 8,
    lineHeight: 1.3,
    letterSpacing: 0.9,
    color: MUTED,
    marginBottom: 6,
  },
  condition: { flexDirection: 'row', gap: 6, marginBottom: 4 },
  bullet: { width: 2.5, height: 2.5, borderRadius: 1.25, backgroundColor: CHARCOAL, marginTop: 4 },
  conditionText: { flex: 1, fontSize: 8, lineHeight: 1.45, color: INK },
  // A plain sentence in the summary's left column (the damage report's "how to pay" lead, its
  // no-damages statement) — the conditions' voice, without a bullet.
  lead: { fontSize: 8, lineHeight: 1.45, color: INK, marginBottom: 8 },
  // ── Totals ──────────────────────────────────────────────────────────────────────────────────
  // A PANEL, on the same tinted surface as the fact cards — see `TOTALS_WIDTH` for why loose lines
  // did not read as the summary of the tables beside them.
  totals: {
    width: TOTALS_WIDTH,
    backgroundColor: TINT,
    borderRadius: 10,
    paddingVertical: TOTALS_PADDING,
    paddingHorizontal: TOTALS_PADDING,
  },
  totalLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingVertical: 3,
  },
  totalLabel: { fontSize: 9, lineHeight: 1.35, color: MUTED },
  totalNote: { fontSize: 7, lineHeight: 1.4, color: MUTED },
  totalValue: { fontSize: 9, lineHeight: 1.35, color: INK },
  grandLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 7,
    paddingTop: 8,
    borderTopWidth: 1.2,
    borderTopColor: CHARCOAL,
  },
  grandLabel: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 11,
    lineHeight: 1.3,
    letterSpacing: 0.4,
    color: CHARCOAL,
  },
  grandValue: { fontFamily: 'Helvetica-Bold', fontSize: 13, lineHeight: 1.3, color: CHARCOAL },
  balanceChip: { position: 'relative', height: RESULT_CHIP_HEIGHT, marginTop: 8 },
  balanceRow: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: RESULT_CHIP_HEIGHT,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    // react-pdf centres the LINE box, whose lower half is descender room these labels do not use —
    // so without this the chip's text sits visibly low. See `opticalCenterPad`.
    paddingBottom: opticalCenterPad(12),
    paddingHorizontal: 12,
  },
  balanceLabel: { fontFamily: 'Helvetica-Bold', fontSize: 9.5, lineHeight: 1, color: CHARCOAL },
  balanceValue: { fontFamily: 'Helvetica-Bold', fontSize: 12, lineHeight: 1, color: CHARCOAL },
  // The REFUND chip's type — white on charcoal, the brand chip inverted (see `ResultChip`).
  balanceInverseText: { color: '#ffffff' },
  // Nothing to move: a plain, bold row under a hairline — no chip at all, because a highlight
  // would ask the reader to act on a zero.
  resultNone: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginTop: 8,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: HAIRLINE,
  },
  // A deposit already in our hands before the review: information UNDER the result, outside the
  // sum — it is not owed and not yet credited; it comes back at pickup.
  onHand: { marginTop: 8 },
  onHandRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  // ── The damages section ("DEPÓSITO Y DAÑOS") ────────────────────────────────────────────────
  // The gap between the summary and the section is the SUMMARY's bottom margin, never the
  // section's top one: a margin travels with the node it belongs to, so as the section's it would
  // follow it onto the next page and stack on top of the letterhead's own gap (§8a rule 1 — seen
  // in a render, 2026-10-27). Left behind with the summary, it disappears at a break, as it should.
  summaryBeforeSettlement: { marginBottom: SETTLEMENT_GAP },
  settlementPanel: {
    backgroundColor: TINT,
    borderRadius: 10,
    paddingVertical: SETTLEMENT_PADDING,
    paddingHorizontal: TOTALS_PADDING,
  },
  // The damages' total keeps the totals panel's inner width at the right edge — its figure under
  // the TOTAL's, on the same vertical line.
  settlementTotal: { width: SETTLEMENT_COLUMN_WIDTH, alignSelf: 'flex-end' },
  // The label side GROWS and wraps (a long product name, a long reason); the figure never shrinks,
  // so every amount stays on its column's right edge.
  moneyLabelBox: { flex: 1, paddingRight: 12 },
  moneyLabel: { fontSize: 9, lineHeight: 1.35, color: CHARCOAL },
  moneyValue: { flexShrink: 0, fontSize: 9, lineHeight: 1.35, color: INK },
  moneyStrong: {
    flexShrink: 0,
    fontFamily: 'Helvetica-Bold',
    fontSize: 9.5,
    lineHeight: 1.35,
    color: CHARCOAL,
  },
  // A sub-total inside the panel: a hairline, not the charcoal rule the order's TOTAL has — the
  // damages are a summary within a summary, and must not compete with the TOTAL above.
  moneySum: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginTop: 4,
    paddingTop: 5,
    paddingBottom: 3,
    borderTopWidth: 1,
    borderTopColor: HAIRLINE,
  },
  hairline: { marginTop: 4, marginBottom: 2, borderTopWidth: 1, borderTopColor: HAIRLINE },
  // ── Bank details + page furniture ───────────────────────────────────────────────────────────
  banks: { gap: BANK_ROW_GAP },
  bank: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  // The mark's slot is reserved whether or not there is a mark, so every account number starts on
  // the same vertical line. `minHeight` keeps a short logo from letting its row ride up beside a
  // taller one.
  bankMark: {
    width: BANK_MARK_WIDTH,
    minHeight: BANK_LOGO_MAX_HEIGHT,
    justifyContent: 'center',
  },
  // The stand-in when a bank ships no mark — the name the admin gave the account, set as a
  // wordmark would be, so a logo-less bank is a different look and never a missing one.
  bankWordmark: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 9,
    lineHeight: 1.2,
    letterSpacing: 0.3,
    color: CHARCOAL,
  },
  bankBody: { flex: 1, gap: 1 },
  bankType: { fontSize: 7.5, lineHeight: 1.3, letterSpacing: 0.4, color: MUTED },
  bankNumber: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 13,
    lineHeight: 1.25,
    letterSpacing: 0.6,
    color: CHARCOAL,
  },
  bankHolder: { fontSize: 7.5, lineHeight: 1.35, color: MUTED },
  /**
   * The standing notes are page FURNITURE, not content: absolutely positioned in the bottom padding
   * beside the page number, `fixed` so they appear on every page.
   *
   * In flow they were a single centred line that cost ~30pt including its margin, and on a document
   * that ended within 30pt of the bottom that line — and nothing else — moved to a second sheet.
   * A page containing one sentence reads as a bug. They are also genuinely furniture: a standing
   * legal reference that qualifies the whole document, exactly like the page number.
   */
  notes: { position: 'absolute', bottom: 30, left: 0, right: 0, gap: 2 },
  note: { fontSize: 7.5, lineHeight: 1.4, color: MUTED, textAlign: 'center' },
  // `left: 0, right: 0` — NOT the page margin. An absolutely-positioned element here resolves
  // against the page's PADDING box, so insetting it by the margin as well pushed it off the
  // measured area and it rendered nothing at all (found by rendering, 2026-08-06).
  pageNumber: {
    position: 'absolute',
    bottom: 16,
    left: 0,
    right: 0,
    textAlign: 'center',
    color: MUTED,
    fontSize: 7.5,
  },
});

/**
 * The strings the FRAME and the shared blocks need — common to every document, so the comprobante
 * and the damage report cannot word their letterhead, their cards or their page numbers
 * differently. Resolved by the CALLER through i18next (`useDocumentVocabulary`): the template takes
 * strings so it stays pure layout and the whole vocabulary is visible in one place at the call site.
 */
export interface DocumentChromeCopy {
  title: string;
  reference: string;
  issuedAt: string;
  /** `Tel.` — a phone number under a business name is a mystery number until something names it. */
  phonePrefix: string;
  clientCard: string;
  clientName: string;
  contact: string;
  address: string;
  eventCard: string;
  eventType: string;
  delivery: string;
  pickup: string;
  columnQuantity: string;
  columnLineTotal: string;
  banks: string;
  /** A FUNCTION, not a template: the numbers only exist inside react-pdf's per-page `render`, and
   *  hand-substituting them would ship an unfilled `{{page}}` through i18next. */
  page: (pageNumber: number, totalPages: number) => string;
  /** The squared balance's rows and its one result — shared, so both documents word the outcome
   *  identically. */
  balance: BalanceCopy;
}

/** The words of the squared balance (`SquaredBalance`). */
export interface BalanceCopy {
  depositDue: string;
  depositDueNote: string;
  claims: string;
  claimsNote: string;
  depositCredit: string;
  serviceDue: string;
  /** "Saldo a favor del cliente" — an unpaid order's anticipo above the service cost. */
  advanceCredit: string;
  /** The result, by direction: the client pays us / we pay the client / nothing moves. */
  collect: string;
  refund: string;
  none: string;
  depositOnHand: string;
  depositOnHandNote: string;
}

/** The comprobante's and the cotización's vocabulary. */
export interface DocumentCopy extends DocumentChromeCopy {
  validUntil: string;
  paid: string;
  quoteNotice: string;
  termsNotice: string;
  billedDays: string;
  /** A FUNCTION so the value can be a real plural ("1 día" / "3 días") rather than a bare integer
   *  the reader has to attach a unit to. */
  billedDaysValue: (days: number) => string;
  /** Why three nights can be three days — the rule, stated once, where the number is. */
  billedDaysHint: string;
  groupRental: string;
  groupSale: string;
  columnDescription: string;
  columnDays: string;
  /** The rental table's price column. Names the UNIT, which is also what makes the row's arithmetic
   *  verifiable by hand: `cantidad × días × precio por día`. */
  columnDailyPrice: string;
  columnUnitPrice: string;
  subtotal: string;
  deliveryFee: string;
  /** What the delivery fee BUYS — a return trip unless the order is a purchase only. */
  deliveryIncludesReturn: string;
  deliveryIncludesOneWay: string;
  free: string;
  discount: string;
  total: string;
  /** "Anticipo" — the advance, not the security deposit. */
  advance: string;
  /** The caption under an `Anticipo` row that stops at the TOTAL: the amount actually received. */
  advanceReceived: (amount: string) => string;
  /** "Pagado" — what a paid order's payment settled after the anticipo. */
  paidAmount: string;
  /** "Depósito y daños" with a deposit; "Daños" when there was none (or it was waived). */
  settlementTitle: string;
  damagesTitle: string;
  settlementRetention: string;
  /** FUNCTIONS where a value is interpolated, for the same reason as `page`: the template never
   *  assembles a sentence out of fragments. */
  settlementReplacement: (product: string) => string;
  settlementReplacementDetail: (quantity: number, unitAmount: string) => string;
  settlementClaimsTotal: string;
  conditions: string;
}

/** The damage report's vocabulary (EPIC-2-DOCUMENTS §2c). */
export interface DamageReportCopy extends DocumentChromeCopy {
  depositTitle: string;
  columnProduct: string;
  columnDepositEach: string;
  retentionTitle: string;
  /** Printed in place of a retention's description when the settlement carries none. */
  retentionNoReason: string;
  replacementsTitle: string;
  columnUnits: string;
  columnReplacementEach: string;
  /** The statement printed instead of the charge tables when the review found nothing — with a
   *  deposit, and without one (none on the lines, or waived: the deposit is then never mentioned). */
  noClaims: string;
  noClaimsNoDeposit: string;
  claimsTotal: string;
  /** "Retención {{retained}} + piezas {{damages}}" — reconciles the total when both kinds exist. */
  claimsBreakdown: (retained: string, damages: string) => string;
  payTitle: string;
  payLead: string;
}

interface Formatters {
  /** Preformatted by the caller so currency and dates obey the app's own `es-GT` rules rather than
   *  a second, subtly different set living in here. */
  money: (amount: number) => string;
  date: (value: Date) => string;
  dateTime: (value: Date) => string;
}

// ── Drawing primitives ────────────────────────────────────────────────────────────────────────

/**
 * A cream→blossom fill. react-pdf has no CSS gradients, but its SVG primitives do — so the brand is
 * drawn for real rather than approximated with a flat colour or a PNG strip to keep in sync.
 *
 * Each instance needs a UNIQUE `id`: gradient definitions live in one document-wide namespace, so
 * two `<Defs>` sharing an id would silently resolve to whichever was parsed last.
 */
const BrandFill: React.FC<{
  id: string;
  width: number;
  height: number;
  radius?: number;
  /** Corner-to-corner instead of left-to-right — what the sidebar tile's `bg-gradient-to-br` does.
   *  The full-bleed rules stay horizontal: a diagonal across 612pt is indistinguishable from one. */
  diagonal?: boolean;
}> = ({ id, width, height, radius = 0, diagonal = false }) => (
  <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
    <Defs>
      <LinearGradient id={id} x1="0%" y1="0%" x2="100%" y2={diagonal ? '100%' : '0%'}>
        <Stop offset="0%" stopColor={CREAM} />
        <Stop offset="100%" stopColor={BLOSSOM} />
      </LinearGradient>
    </Defs>
    <Rect x={0} y={0} width={width} height={height} rx={radius} ry={radius} fill={`url(#${id})`} />
  </Svg>
);

/**
 * The app's own isotype, drawn through react-pdf's SVG so it is vector in the PDF and cannot drift
 * from the mark the app renders (both read `logoMarkPaths.ts`).
 *
 * Sized by HEIGHT, because that is how the sidebar sizes it. react-pdf's `Svg` does no
 * letterboxing, so the width is computed from the mark's own aspect — derived from the viewBox,
 * never written twice.
 */
const BrandMark: React.FC<{ height: number }> = ({ height }) => (
  <Svg width={height * LOGO_MARK_ASPECT} height={height} viewBox={LOGO_MARK_VIEWBOX}>
    <G
      transform={LOGO_MARK_TRANSFORM}
      fill={CHARCOAL}
      stroke={CHARCOAL}
      strokeWidth={LOGO_MARK_STROKE_WIDTH}
    >
      {LOGO_MARK_PATHS.map((d) => (
        <Path key={d.slice(0, 24)} d={d} />
      ))}
    </G>
  </Svg>
);

/** The sliver a row's rounded corner removed, in that row's own tone — see `cornerWedgePath` for why
 *  it is the sliver and not the corner square. */
const CornerWedge: React.FC<{ side: 'left' | 'right'; color: string }> = ({ side, color }) => (
  <Svg width={TABLE_RADIUS} height={TABLE_RADIUS} viewBox={`0 0 ${TABLE_RADIUS} ${TABLE_RADIUS}`}>
    <Path d={cornerWedgePath(TABLE_RADIUS, side)} fill={color} />
  </Svg>
);

/**
 * The table header's fill, drawn as an SVG rather than set as the header's `backgroundColor`.
 *
 * That looks like a pointless indirection and is not. A `fixed` table header whose content turns
 * out not to fit leaves a painted fragment behind on the page it was measured against (see
 * `tableHead`), and how much gets painted depends on what is painting: a `backgroundColor` belongs
 * to the View, so react-pdf fills the whole leftover strip and the clipped labels come with it.
 * An `Svg` is ATOMIC: the parent's `overflow: 'hidden'` clips it to a hairline instead.
 *
 * TWO shapes, in this order. Underneath, the row tone in a shape that is rounded on top and SQUARE
 * at the bottom (`roundedTopPath`) — it fills the wedges the band's bottom curve would otherwise cut
 * out of the table, so the table's sides run unbroken from the header into the rows. On top, the
 * band itself, with all four corners rounded.
 */
const TableHeadFill: React.FC = () => (
  <Svg
    width={CONTENT_WIDTH}
    height={TABLE_HEAD_HEIGHT}
    viewBox={`0 0 ${CONTENT_WIDTH} ${TABLE_HEAD_HEIGHT}`}
  >
    <Path d={roundedTopPath(CONTENT_WIDTH, TABLE_HEAD_HEIGHT, TABLE_RADIUS)} fill={ROW_BASE} />
    <Rect
      x={0}
      y={0}
      width={CONTENT_WIDTH}
      height={TABLE_HEAD_HEIGHT}
      rx={TABLE_RADIUS}
      ry={TABLE_RADIUS}
      fill={TABLE_HEAD}
    />
  </Svg>
);

/** The letterhead's brand tile — the panel sidebar's `BrandMark`, in points. */
const BrandTile: React.FC = () => (
  <View style={styles.brandTile}>
    <BrandFill
      id="brand-tile"
      width={BRAND_TILE}
      height={BRAND_TILE}
      radius={BRAND_TILE_RADIUS}
      diagonal
    />
    <View style={styles.brandTileMark}>
      <BrandMark height={BRAND_MARK_HEIGHT} />
    </View>
  </View>
);

// ── Shared blocks ─────────────────────────────────────────────────────────────────────────────

/**
 * Everything every document has on every page: the two brand rules, the letterhead (business on
 * the left; the document's type, its meta lines and an optional mark on the right), the standing
 * notes and the page number — with the page's bottom padding derived from the notes it ACTUALLY
 * prints (`footerPadding`), so the clearance and the furniture are measured from one list.
 */
const DocumentFrame: React.FC<{
  letterhead: DocumentLetterhead;
  copy: DocumentChromeCopy;
  /** The PDF's own title metadata. */
  pdfTitle: string;
  meta: string[];
  /** PAGADO on a paid order. */
  mark?: string;
  notes: string[];
  children: React.ReactNode;
}> = ({ letterhead, copy, pdfTitle, meta, mark, notes, children }) => (
  <Document title={pdfTitle} author={letterhead.businessName} creator={letterhead.businessName}>
    <Page size="LETTER" style={[styles.page, { paddingBottom: footerPadding(notes.length) }]}>
      {/* The brand rules bleed edge to edge on EVERY page — `fixed`, and outside the page's
          padding, which is why they are absolutely positioned rather than laid out in flow. */}
      <View style={styles.topBar} fixed>
        <BrandFill id="bar-top" width={PAGE_WIDTH} height={BAR_HEIGHT} />
      </View>
      <View style={styles.bottomBar} fixed>
        <BrandFill id="bar-bottom" width={PAGE_WIDTH} height={BAR_HEIGHT} />
      </View>
      <View style={styles.header} fixed>
        <View style={styles.brand}>
          <BrandTile />
          <View>
            <Text style={styles.businessName}>{letterhead.businessName}</Text>
            {letterhead.businessPhone !== '' && (
              <Text style={styles.businessPhone}>
                {copy.phonePrefix} {letterhead.businessPhone}
              </Text>
            )}
          </View>
        </View>
        <View style={styles.headerRight}>
          <Text style={styles.docType}>{copy.title.toUpperCase()}</Text>
          {meta.map((line) => (
            <Text key={line} style={styles.docMeta}>
              {line}
            </Text>
          ))}
          {/* A mark is the document stating what it IS: proof of payment. */}
          {mark !== undefined && <Text style={styles.headerMark}>{mark}</Text>}
        </View>
      </View>
      {children}
      <View style={styles.notes} fixed>
        {notes.map((note) => (
          <Text key={note} style={styles.note}>
            {note}
          </Text>
        ))}
      </View>
      <Text
        style={styles.pageNumber}
        render={({ pageNumber, totalPages }) => copy.page(pageNumber, totalPages)}
        fixed
      />
    </Page>
  </Document>
);

interface FactItem {
  label: string;
  value: string;
  /** The rule behind a number that would otherwise invite the question ("why does a two-night
   *  rental bill three days?"). */
  hint?: string;
}

/** A titled card of labelled facts. */
const FactCard: React.FC<{ title: string; facts: FactItem[] }> = ({ title, facts }) => (
  <View style={styles.factCard}>
    <Text style={styles.factTitle}>{title.toUpperCase()}</Text>
    {facts.map((fact) => (
      <View key={fact.label}>
        <Text style={styles.factLabel}>{fact.label.toUpperCase()}</Text>
        <Text style={styles.factValue}>{fact.value}</Text>
        {fact.hint !== undefined && <Text style={styles.factHint}>{fact.hint}</Text>}
      </View>
    ))}
  </View>
);

interface TableColumn {
  label: string;
  /** Points; the FIRST column takes whatever the others leave (`fillWidth`) and ignores this. */
  width: number;
  /** Charcoal rather than ink — the description and the subtotal, the two cells a reader scans. */
  strong?: boolean;
}

interface TableRow {
  cells: string[];
  /** Caption lines under the FIRST cell (a damage note). Empty strings are skipped. */
  notes?: (string | undefined)[];
}

/**
 * A titled table: the group title, the `fixed` column header and the rows — with EVERY pagination
 * rule of EPIC-2-DOCUMENTS §8a built in, so no document can get a table without them.
 *
 * It returns a FRAGMENT, deliberately: the title must be a PAGE-level sibling and only the header
 * and the rows share a `View`. Two rules depend on that shape and neither survives tidying it into
 * one wrapper per table — see `GROUP_HEAD_AHEAD` for why the title must have previous siblings, and
 * the inner `View` for why the header must NOT. (A component is not a node: react-pdf sees the
 * fragment's children as the page's own.)
 */
const LineTable: React.FC<{
  title: string;
  columns: TableColumn[];
  rows: TableRow[];
  first: boolean;
  /** The air the closing rule owns: a step to another table, or a change of section. */
  dividerGap: { above: number; below: number };
  /**
   * `false` for a table that is ONE row by construction (the damage report's retention): its title
   * already says what the row is, so column labels would spend 24pt naming "a description" and "an
   * amount" — points that decide whether the report fits on one page. The row then rounds its top
   * corners too, so it is still a rounded block. Never for a table that can grow: a continuation
   * page needs its labels.
   */
  head?: boolean;
}> = ({ title, columns, rows, first, dividerGap, head = true }) => {
  const widths = columns.map((column, index) =>
    index === 0 ? fillWidth(columns.slice(1).map((other) => other.width)) : column.width,
  );
  const lastIndex = rows.length - 1;
  /** The rule that closes this table, drawn under its last row. */
  const closingRule = (
    <View
      style={[styles.tableEnd, { marginTop: dividerGap.above, marginBottom: dividerGap.below }]}
    />
  );
  /**
   * A row, and — on the LAST one — the rule that closes the table, bound to it.
   *
   * The rule used to follow the table as its own element, which let a page break fall between
   * them: a document whose last row ended flush with the foot of a page opened the next one with a
   * lone hairline separating nothing (seen in a render, 2026-08-26). It has no meaning without
   * content above it, so it is not allowed to leave without that content — `wrap={false}` around
   * the pair moves both or neither. When the pair does not fit, the last row is carried to the next
   * page too, and the repeating header goes with it, so the table legitimately continues and then
   * closes.
   */
  const row = (line: TableRow, index: number): React.ReactElement => (
    <View key={index} wrap={false}>
      <View
        style={[
          styles.row,
          // EVERY row is filled — see `ROW_BASE` — and EVERY row is rounded at the bottom, not just
          // the last: the row that ends a page has to close as cleanly as the row that ends the
          // table, and no row can know which it is. The notches are repaired from below instead;
          // see `cornerPatch`.
          { backgroundColor: index % 2 === 1 ? ROW_ALT : ROW_BASE },
          { borderBottomLeftRadius: TABLE_RADIUS, borderBottomRightRadius: TABLE_RADIUS },
          !head && index === 0
            ? { borderTopLeftRadius: TABLE_RADIUS, borderTopRightRadius: TABLE_RADIUS }
            : {},
        ]}
      >
        {/* The two patches that close the row ABOVE — in ITS tone, which is always this row's
            alternate. Absent on the first row, which has a header above it rather than a row, and
            absent (by landing on the next page) wherever a break falls. */}
        {index > 0 && (
          <>
            <View style={[styles.cornerPatch, { left: 0 }]}>
              <CornerWedge side="left" color={index % 2 === 1 ? ROW_BASE : ROW_ALT} />
            </View>
            <View style={[styles.cornerPatch, { right: 0 }]}>
              <CornerWedge side="right" color={index % 2 === 1 ? ROW_BASE : ROW_ALT} />
            </View>
          </>
        )}
        {line.cells.map((cell, cellIndex) => {
          const column = columns[cellIndex];
          const style = column?.strong === true ? styles.cellStrong : styles.cell;
          const width = widths[cellIndex];
          if (cellIndex > 0) {
            return (
              <Text key={cellIndex} style={[style, { width, textAlign: 'right' }]}>
                {cell}
              </Text>
            );
          }
          // A long description WRAPS — a PDF has no hover, so a truncated description is
          // information the reader can never recover. Its captions sit under it, in the same box.
          const notes = (line.notes ?? []).filter(
            (note): note is string => note !== undefined && note !== '',
          );
          return notes.length === 0 ? (
            <Text key={cellIndex} style={[style, { width }]}>
              {cell}
            </Text>
          ) : (
            <View key={cellIndex} style={{ width }}>
              <Text style={style}>{cell}</Text>
              {notes.map((note) => (
                <Text key={note} style={styles.cellNote}>
                  {note}
                </Text>
              ))}
            </View>
          );
        })}
      </View>
      {index === lastIndex && closingRule}
    </View>
  );
  return (
    <Fragment>
      <Text
        minPresenceAhead={GROUP_HEAD_AHEAD}
        style={[styles.groupTitle, first ? styles.firstGroupTitle : {}]}
      >
        {title}
      </Text>
      {/* This `View` exists ONLY to SCOPE the repeating header to its own table. A `fixed` node
          repeats on every page for as long as its container is being paginated, so as a page-level
          child it would go on labelling columns under the next table and beside the totals.
          Wrapping it with the rows it labels ends the repeat with the table. */}
      <View>
        {/* `fixed` keeps the columns labelled when a table runs past a page break — the single
            reason this is react-pdf and not a hand-positioned builder. `overflow: 'hidden'` in the
            style is NOT decoration; see `tableHead`. */}
        {head && (
          <View style={styles.tableHead} fixed>
            <TableHeadFill />
            <View style={styles.tableHeadRow}>
              {columns.map((column, index) => (
                <Text
                  key={column.label}
                  style={[
                    styles.headCell,
                    { width: widths[index] },
                    index > 0 ? { textAlign: 'right' } : {},
                  ]}
                >
                  {column.label}
                </Text>
              ))}
            </View>
          </View>
        )}
        {rows.map(row)}
      </View>
    </Fragment>
  );
};

/**
 * The business's accounts, each wearing its bank's own mark — a stack of borderless rows (decision
 * #14). Printed by the comprobante always, and by the damage report only when a balance is due.
 */
const BankList: React.FC<{ title: string; banks: DocumentBankAccount[]; lead?: string }> = ({
  title,
  banks,
  lead,
}) => (
  <View>
    <Text style={styles.blockTitle}>{title.toUpperCase()}</Text>
    {lead !== undefined && <Text style={styles.lead}>{lead}</Text>}
    <View style={styles.banks}>
      {banks.map((bank, index) => {
        const logo = bankLogoFor(bank.bankKey);
        return (
          <View key={index} style={styles.bank}>
            <View style={styles.bankMark}>
              {logo === undefined ? (
                <Text style={styles.bankWordmark}>{bank.name}</Text>
              ) : (
                <Image src={logo.src} style={{ height: logo.height }} />
              )}
            </View>
            <View style={styles.bankBody}>
              <Text style={styles.bankType}>{bank.accountType.toUpperCase()}</Text>
              <Text style={styles.bankNumber}>{bank.accountNumber}</Text>
              <Text style={styles.bankHolder}>{bank.holder}</Text>
            </View>
          </View>
        );
      })}
    </View>
  </View>
);

/** A plain line of the totals panel — muted label (with an optional caption), figure on the right. */
const TotalLine: React.FC<{ label: string; value: string; note?: string; strong?: boolean }> = ({
  label,
  value,
  note,
  strong = false,
}) => (
  <View style={styles.totalLine}>
    <View>
      <Text style={styles.totalLabel}>{label}</Text>
      {note !== undefined && <Text style={styles.totalNote}>{note}</Text>}
    </View>
    <Text style={strong ? styles.moneyStrong : styles.totalValue}>{value}</Text>
  </View>
);

/**
 * The ONE result of the squared balance, as a chip of the same shape in two tones that cannot be
 * confused (owner, 2026-10-27):
 *
 * - `collect` — the client pays us: the brand gradient, the content's one place for it (#17);
 * - `refund` — we pay the client back: the chip INVERTED, charcoal with white type. Same weight and
 *   place, so it reads as "the outcome", but a reader skimming for the pastel band they have to pay
 *   does not find it.
 */
const ResultChip: React.FC<{ label: string; value: string; tone: 'collect' | 'refund' }> = ({
  label,
  value,
  tone,
}) => (
  <View style={styles.balanceChip}>
    {tone === 'collect' ? (
      <BrandFill id="balance" width={TOTALS_INNER_WIDTH} height={RESULT_CHIP_HEIGHT} radius={8} />
    ) : (
      <Svg
        width={TOTALS_INNER_WIDTH}
        height={RESULT_CHIP_HEIGHT}
        viewBox={`0 0 ${TOTALS_INNER_WIDTH} ${RESULT_CHIP_HEIGHT}`}
      >
        <Rect
          x={0}
          y={0}
          width={TOTALS_INNER_WIDTH}
          height={RESULT_CHIP_HEIGHT}
          rx={8}
          ry={8}
          fill={CHARCOAL}
        />
      </Svg>
    )}
    <View style={styles.balanceRow}>
      <Text style={[styles.balanceLabel, tone === 'refund' ? styles.balanceInverseText : {}]}>
        {label}
      </Text>
      <Text style={[styles.balanceValue, tone === 'refund' ? styles.balanceInverseText : {}]}>
        {value}
      </Text>
    </View>
  </View>
);

/** An addition below the TOTAL — signed, so the column reads as arithmetic. ASCII `+`, like `-`. */
const PLUS = '+';

/**
 * The order SQUARED (`squareOrderBalance`, EPIC-2-DOCUMENTS §2b): the rows that move the money
 * after the cost, then the ONE result — what has to happen with the money, and which way.
 *
 * Every row appears only when it is not zero, and every row is SIGNED, so the reader can add the
 * column and arrive at the result (owner, 2026-10-27: the client must see that they PAY the deposit
 * to get the service even though it is not a cost, and must never see two competing balances):
 *
 * - `Saldo del servicio +` — the damage report only (`serviceRow`), whose own first figure is the
 *   damages; on the comprobante the TOTAL and its anticipo/pagado rows already say it;
 * - `Saldo a favor del cliente -` — an unpaid order's anticipo above the service cost (on every
 *   document: the comprobante's `Anticipo` row then stops at the TOTAL, so nothing counts twice);
 * - `Depósito (reembolsable) +` — before the review, a deposit still to be handed over;
 * - `Daños +` — the comprobante only (`claimsRow`), pointing at the itemised section below;
 * - `Depósito recibido -` — after the review, the deposit credited back against all of it;
 * - the result: `Monto a pagar` (gradient), `Monto a devolver al cliente` (inverted) or a plain
 *   `Sin saldo pendiente` row — no highlight on a zero;
 * - and, under it and OUTSIDE the sum, a deposit already on hand before the review.
 */
const SquaredBalance: React.FC<{
  balance: OrderBalance;
  copy: BalanceCopy;
  money: (amount: number) => string;
  serviceRow: boolean;
  claimsRow: boolean;
}> = ({ balance, copy, money, serviceRow, claimsRow }) => (
  <>
    {serviceRow && balance.serviceDue > 0 && (
      <TotalLine label={copy.serviceDue} value={`${PLUS}${money(balance.serviceDue)}`} />
    )}
    {balance.advanceCredit > 0 && (
      <TotalLine label={copy.advanceCredit} value={`${MINUS}${money(balance.advanceCredit)}`} />
    )}
    {balance.depositDue > 0 && (
      <TotalLine
        label={copy.depositDue}
        note={copy.depositDueNote}
        value={`${PLUS}${money(balance.depositDue)}`}
      />
    )}
    {claimsRow && balance.claims > 0 && (
      <TotalLine
        label={copy.claims}
        note={copy.claimsNote}
        value={`${PLUS}${money(balance.claims)}`}
      />
    )}
    {balance.depositCredit > 0 && (
      <TotalLine label={copy.depositCredit} value={`${MINUS}${money(balance.depositCredit)}`} />
    )}
    {balance.direction === 'none' ? (
      <View style={styles.resultNone}>
        <Text style={styles.moneyStrong}>{copy.none}</Text>
        <Text style={styles.moneyStrong}>{money(0)}</Text>
      </View>
    ) : (
      <ResultChip
        tone={balance.direction}
        label={balance.direction === 'collect' ? copy.collect : copy.refund}
        value={money(balance.amount)}
      />
    )}
    {balance.depositOnHand > 0 && (
      <View style={styles.onHand}>
        <View style={styles.onHandRow}>
          <Text style={[styles.moneyLabel, styles.moneyLabelBox]}>{copy.depositOnHand}</Text>
          <Text style={styles.moneyStrong}>{money(balance.depositOnHand)}</Text>
        </View>
        <Text style={styles.totalNote}>{copy.depositOnHandNote}</Text>
      </View>
    )}
  </>
);

/** One charge of the settlement panel: a label that wraps (with caption lines under it) and a
 *  figure pinned to the right edge. Atomic — a page break may fall between two charges in an
 *  oversized panel, never through one. */
const ChargeRow: React.FC<{ row: SettlementRowText; value: string }> = ({ row, value }) => (
  <View style={styles.totalLine} wrap={false}>
    <View style={styles.moneyLabelBox}>
      <Text style={styles.moneyLabel}>{row.label}</Text>
      {row.notes.map((note, index) => (
        <Text key={index} style={styles.totalNote}>
          {note}
        </Text>
      ))}
    </View>
    <Text style={styles.moneyValue}>{value}</Text>
  </View>
);

// ── The comprobante / cotización ──────────────────────────────────────────────────────────────

/**
 * "DEPÓSITO Y DAÑOS" (or "DAÑOS", with no deposit) — the itemised charges of a recorded damage
 * report and their total. Nothing else (owner, 2026-10-27): what the damages DO to the money is the
 * squared result in the totals panel above, so this section never states a competing balance —
 * it is the detail the totals' `Daños` row points at.
 *
 * **Its OWN block after the summary, and it never splits** (§8a rule 5). It used to sit inside the
 * summary's `wrap={false}`, which kept it whole only by dragging the totals, the conditions and the
 * banks with it; and because react-pdf cannot MOVE a `wrap={false}` block taller than a page (it
 * leaves it on the current page and lets it run off the bottom edge), a settlement with many charges
 * would have silently lost the end of the page. Now:
 *
 * - **the ordinary case** — heading and panel in one `wrap={false}` View: if it does not fit what is
 *   left of the page, it moves WHOLE to the next one, heading included (the same rule as the
 *   summary, §8a);
 * - **the oversized case** (`settlementFitsOnePage` false, by a pessimistic estimate) — the heading
 *   is a page-level sibling with `minPresenceAhead`, so it cannot end a page alone; the charges are
 *   atomic rows and the total is one atomic row after them. The panel may then continue onto the
 *   next page between two charges, which is the only sane option left for a block taller than a
 *   page — and nothing is ever lost off an edge.
 */
const DamagesSection: React.FC<{
  damages: DocumentDamages;
  copy: DocumentCopy;
  money: (amount: number) => string;
  noteCount: number;
}> = ({ damages, copy, money, noteCount }) => {
  const charges = damages.claims.map((claim) =>
    claim.kind === 'retention'
      ? {
          row: {
            label: copy.settlementRetention,
            // The DESCRIPTION of the damage is what the retention is for (owner, 2026-10-27).
            notes: claim.reason === undefined || claim.reason === '' ? [] : [claim.reason],
          },
          value: money(claim.amount),
        }
      : {
          row: {
            label: copy.settlementReplacement(claim.description),
            notes: [
              copy.settlementReplacementDetail(claim.quantity, money(claim.unitAmount)),
              ...(claim.note === undefined || claim.note === '' ? [] : [claim.note]),
            ],
          },
          value: money(claim.amount),
        },
  );
  const fits = settlementFitsOnePage(
    charges.map((charge) => charge.row),
    noteCount,
  );
  const heading = (
    <Text
      style={styles.blockTitle}
      {...(!fits && { minPresenceAhead: SETTLEMENT_HEAD_AHEAD })}
    >
      {(damages.withDeposit ? copy.settlementTitle : copy.damagesTitle).toUpperCase()}
    </Text>
  );
  const panel = (
    <View style={styles.settlementPanel}>
      {charges.map((charge, index) => (
        <ChargeRow key={index} row={charge.row} value={charge.value} />
      ))}
      {/* The total of the charges — the figure the totals' `Daños` row carries. */}
      <View style={[styles.moneySum, styles.settlementTotal]} wrap={false}>
        <Text style={styles.moneyLabel}>{copy.settlementClaimsTotal}</Text>
        <Text style={styles.moneyStrong}>{money(damages.total)}</Text>
      </View>
    </View>
  );
  return fits ? (
    <View wrap={false}>
      {heading}
      {panel}
    </View>
  ) : (
    <Fragment>
      {heading}
      {panel}
    </Fragment>
  );
};

interface OrderDocumentProps extends Formatters {
  model: DocumentModel;
  copy: DocumentCopy;
}

const OrderDocument: React.FC<OrderDocumentProps> = ({ model, copy, money, date, dateTime }) => {
  const reference = documentReference(model);
  const conditions = printedConditions(model);
  // A purchase-only order is delivered and never collected, so the fee buys a one-way trip. Stating
  // the return leg there would promise a visit nobody is making — and this is also the seam a
  // future "the client collects it themselves" mode widens, rather than a new branch elsewhere.
  const deliveryNote =
    model.event.pickupAt === undefined ? copy.deliveryIncludesOneWay : copy.deliveryIncludesReturn;
  /**
   * The standing notes, resolved ONCE — because the page's bottom padding is what reserves room for
   * them, and a padding computed from a different rule than the block it reserves is a gap waiting
   * to be wrong. Build the list, render the list, measure the list.
   *
   * The FULL terms are referenced, never transcribed (owner decision 2026-08-05): a wall of
   * conditions makes a quote read like a contract nobody signed and pushes the totals onto a second
   * page. The handful of conditions that change what the client OWES are printed above; this line
   * covers everything else, and is omitted entirely when no terms are written.
   */
  const notes = [
    ...(model.kind === 'quote' ? [copy.quoteNotice] : []),
    ...(model.letterhead.hasTerms ? [copy.termsNotice] : []),
  ];
  return (
    <DocumentFrame
      letterhead={model.letterhead}
      copy={copy}
      pdfTitle={reference ?? copy.title}
      meta={[
        ...(reference === undefined ? [] : [`${copy.reference} ${reference}`]),
        `${copy.issuedAt} ${date(model.issuedAt)}`,
        ...(model.validUntil === undefined ? [] : [`${copy.validUntil} ${date(model.validUntil)}`]),
      ]}
      // The PAGADO mark is the document changing meaning: the same page goes out as a request for
      // payment and comes back as proof of one.
      {...(model.isPaid && { mark: copy.paid })}
      notes={notes}
    >
      <View style={styles.facts}>
        <FactCard
          title={copy.clientCard}
          facts={[
            { label: copy.clientName, value: model.client.name },
            { label: copy.contact, value: model.client.contact },
            { label: copy.address, value: model.client.address },
          ]}
        />
        <FactCard
          title={copy.eventCard}
          facts={[
            { label: copy.eventType, value: model.event.type },
            { label: copy.delivery, value: dateTime(model.event.deliveryAt) },
            ...(model.event.pickupAt === undefined
              ? []
              : [{ label: copy.pickup, value: dateTime(model.event.pickupAt) }]),
            ...(model.event.billedDays === undefined
              ? []
              : [
                  {
                    label: copy.billedDays,
                    value: copy.billedDaysValue(model.event.billedDays),
                    hint: copy.billedDaysHint,
                  },
                ]),
          ]}
        />
      </View>
      {model.groups.map((group, groupIndex) => {
        // Days are a rental-only column, and only when there is a window to bill: a purchase-only
        // order has none, so the table drops the column rather than printing a placeholder.
        const withDays = group.kind === 'rental' && model.event.billedDays !== undefined;
        return (
          <LineTable
            key={group.kind}
            title={group.kind === 'rental' ? copy.groupRental : copy.groupSale}
            first={groupIndex === 0}
            // The divider under this group carries the WHOLE gap to whatever comes next — another
            // table for every group but the last, and the summary (a change of section) for that.
            dividerGap={
              groupIndex === model.groups.length - 1 ? DIVIDER_GAP_SECTION : DIVIDER_GAP_TABLE
            }
            columns={[
              { label: copy.columnDescription, width: 0, strong: true },
              { label: copy.columnQuantity, width: COL_QUANTITY },
              ...(withDays ? [{ label: copy.columnDays, width: COL_DAYS }] : []),
              {
                label: withDays ? copy.columnDailyPrice : copy.columnUnitPrice,
                width: COL_PRICE,
              },
              { label: copy.columnLineTotal, width: COL_TOTAL, strong: true },
            ]}
            rows={group.lines.map((line) => ({
              cells: [
                line.description,
                String(line.quantity),
                ...(withDays ? [line.days === undefined ? '' : String(line.days)] : []),
                money(line.unitPrice),
                money(line.total),
              ],
            }))}
          />
        );
      })}
      {/* Everything that closes the document is ONE block, and it must not be split by a page
          break: the conditions and the deposit details qualify the very figures beside them. */}
      <View
        style={[styles.summary, model.damages !== undefined ? styles.summaryBeforeSettlement : {}]}
        wrap={false}
      >
        <View style={styles.summaryNotes}>
          {conditions.length > 0 && (
            <View>
              <Text style={styles.blockTitle}>{copy.conditions.toUpperCase()}</Text>
              {conditions.map((condition) => (
                <View key={condition} style={styles.condition}>
                  <View style={styles.bullet} />
                  <Text style={styles.conditionText}>{condition}</Text>
                </View>
              ))}
            </View>
          )}
          {model.letterhead.banks.length > 0 && (
            <BankList title={copy.banks} banks={model.letterhead.banks} />
          )}
        </View>
        <View style={styles.totals}>
          {model.totals.groups.map((group) => (
            <TotalLine
              key={group.kind}
              label={`${copy.subtotal} ${group.kind === 'rental' ? copy.groupRental : copy.groupSale}`}
              value={money(group.subtotal)}
            />
          ))}
          {model.totals.delivery !== undefined && (
            <TotalLine
              label={copy.deliveryFee}
              note={deliveryNote}
              // Zero is not blank: "Gratis" is something the business is telling the client.
              value={model.totals.delivery === 0 ? copy.free : money(model.totals.delivery)}
            />
          )}
          {model.totals.discount !== undefined && (
            <TotalLine label={copy.discount} value={`${MINUS}${money(model.totals.discount)}`} />
          )}
          <View style={styles.grandLine}>
            <Text style={styles.grandLabel}>{copy.total}</Text>
            <Text style={styles.grandValue}>{money(model.totals.total)}</Text>
          </View>
          {/* Under the cost, what has moved and what must: the anticipo, a paid order's payment,
              then the squared rows and the ONE result. */}
          {model.totals.advance !== undefined && (
            <TotalLine
              label={copy.advance}
              {...(model.totals.advanceReceived !== undefined && {
                note: copy.advanceReceived(money(model.totals.advanceReceived)),
              })}
              value={`${MINUS}${money(model.totals.advance)}`}
            />
          )}
          {model.totals.paid !== undefined && (
            <TotalLine label={copy.paidAmount} value={`${MINUS}${money(model.totals.paid)}`} />
          )}
          <SquaredBalance
            balance={model.totals.balance}
            copy={copy.balance}
            money={money}
            serviceRow={false}
            claimsRow
          />
        </View>
      </View>
      {model.damages !== undefined && (
        <DamagesSection
          damages={model.damages}
          copy={copy}
          money={money}
          noteCount={notes.length}
        />
      )}
    </DocumentFrame>
  );
};

export default OrderDocument;

// ── The damage report ─────────────────────────────────────────────────────────────────────────

interface DamageReportDocumentProps extends Formatters {
  model: DamageReportModel;
  copy: DamageReportCopy;
}

/**
 * "REPORTE DE DAÑOS" — what the pickup review found, what it costs and how the order squares with
 * it (EPIC-2-DOCUMENTS §2c). Generated from what the admin entered — saved, or still in the report
 * form — and it is THE report either way: no draft mark, issued at the download.
 *
 * Built from the comprobante's own parts, so it reads as the same company's paperwork: the frame,
 * the fact cards, the line tables (repeating headers, keep-with-next titles, rows that never split)
 * and a summary that is `wrap={false}` — totals on the right, and on the left the bank accounts,
 * but ONLY when the client has something to pay into them.
 *
 * Its result is the comprobante's, by construction: the same `squareOrderBalance` over the same
 * order with the same claims, under the same words and the same chip — so the two documents can
 * never end on different amounts.
 */
export const DamageReportDocument: React.FC<DamageReportDocumentProps> = ({
  model,
  copy,
  money,
  date,
  dateTime,
}) => {
  const reference = formatReference(model.reference);
  const hasDeposit = model.deposit.total > 0;
  const { balance } = model;
  // How to pay — only when the client HAS to pay. A report that ends in a refund or at zero has
  // nothing to pay, and bank details there would read as a request for money.
  const showBanks = balance.direction === 'collect' && model.letterhead.banks.length > 0;
  const hasClaims = model.retention !== undefined || model.replacements.length > 0;
  const tables: Omit<React.ComponentProps<typeof LineTable>, 'first' | 'dividerGap'>[] = [
    ...(model.deposit.lines.length > 0
      ? [
          {
            title: copy.depositTitle,
            columns: [
              { label: copy.columnProduct, width: 0, strong: true },
              { label: copy.columnQuantity, width: COL_QUANTITY },
              { label: copy.columnDepositEach, width: COL_PRICE },
              { label: copy.columnLineTotal, width: COL_TOTAL, strong: true },
            ],
            rows: model.deposit.lines.map((line) => ({
              cells: [
                line.description,
                String(line.quantity),
                money(line.unitAmount),
                money(line.total),
              ],
            })),
          },
        ]
      : []),
    ...(model.retention === undefined
      ? []
      : [
          {
            title: copy.retentionTitle,
            // ONE row by construction, so no column labels (`head`): the title names it.
            head: false,
            columns: [
              { label: 'damage', width: 0 },
              { label: 'amount', width: COL_TOTAL, strong: true },
            ],
            rows: [
              {
                // The FULL description of the damage — the reason money was kept is the one thing
                // a client disputing it needs to read in writing.
                cells: [model.retention.reason ?? copy.retentionNoReason, money(model.retention.amount)],
              },
            ],
          },
        ]),
    ...(model.replacements.length > 0
      ? [
          {
            title: copy.replacementsTitle,
            columns: [
              { label: copy.columnProduct, width: 0, strong: true },
              { label: copy.columnUnits, width: COL_QUANTITY },
              { label: copy.columnReplacementEach, width: COL_PRICE },
              { label: copy.columnLineTotal, width: COL_TOTAL, strong: true },
            ],
            rows: model.replacements.map((replacement) => ({
              cells: [
                replacement.description,
                String(replacement.quantity),
                money(replacement.unitAmount),
                money(replacement.amount),
              ],
              notes: [replacement.note],
            })),
          },
        ]
      : []),
  ];
  return (
    <DocumentFrame
      letterhead={model.letterhead}
      copy={copy}
      pdfTitle={`${copy.title} ${reference}`}
      meta={[`${copy.reference} ${reference}`, `${copy.issuedAt} ${date(model.issuedAt)}`]}
      notes={[]}
    >
      <View style={styles.facts}>
        <FactCard
          title={copy.clientCard}
          facts={[
            { label: copy.clientName, value: model.client.name },
            { label: copy.contact, value: model.client.contact },
            { label: copy.address, value: model.client.address },
          ]}
        />
        <FactCard
          title={copy.eventCard}
          facts={[
            { label: copy.eventType, value: model.event.type },
            { label: copy.delivery, value: dateTime(model.event.deliveryAt) },
            ...(model.event.pickupAt === undefined
              ? []
              : [{ label: copy.pickup, value: dateTime(model.event.pickupAt) }]),
          ]}
        />
      </View>
      {tables.map((table, index) => (
        <LineTable
          key={table.title}
          {...table}
          first={index === 0}
          dividerGap={index === tables.length - 1 ? DIVIDER_GAP_SECTION : DIVIDER_GAP_TABLE}
        />
      ))}
      {/* Nothing to list is still an answer, and the one the client most wants in writing. With no
          table above it, it also supplies the gap the first table's title would have. */}
      {!hasClaims && (
        <Text style={[styles.lead, { marginTop: tables.length === 0 ? 16 : 0, marginBottom: 16 }]}>
          {hasDeposit ? copy.noClaims : copy.noClaimsNoDeposit}
        </Text>
      )}
      {/* One block, `wrap={false}` like the comprobante's: the accounts qualify the balance beside
          them. With no accounts to print, the totals keep their place on the right. */}
      <View
        style={[styles.summary, showBanks ? {} : { justifyContent: 'flex-end' }]}
        wrap={false}
      >
        {showBanks && (
          <View style={styles.summaryNotes}>
            <BankList title={copy.payTitle} banks={model.letterhead.banks} lead={copy.payLead} />
          </View>
        )}
        <View style={styles.totals}>
          {/* The panel's first line, so no charcoal rule above it. When BOTH kinds of charge
              exist, a one-line caption reconciles the total with the two tables above it — the
              job the comprobante's subtotal lines do, at a third of the height (two full lines
              were what pushed the ordinary report onto a second page). With one kind, the total
              IS that table's sum and a caption would only repeat it. */}
          <View style={styles.totalLine}>
            <View>
              <Text style={styles.grandLabel}>{copy.claimsTotal}</Text>
              {model.retention !== undefined && model.replacements.length > 0 && (
                <Text style={styles.totalNote}>
                  {copy.claimsBreakdown(money(model.totals.retained), money(model.totals.damages))}
                </Text>
              )}
            </View>
            <Text style={styles.grandValue}>{money(model.totals.claims)}</Text>
          </View>
          {/* What the charges cost, then how the order squares with them: a hairline between the
              two, never the TOTAL's charcoal rule — and only when rows follow it (the result
              brings its own separation). */}
          {(balance.serviceDue > 0 || balance.advanceCredit > 0 || balance.depositCredit > 0) && (
            <View style={styles.hairline} />
          )}
          <SquaredBalance
            balance={balance}
            copy={copy.balance}
            money={money}
            serviceRow
            claimsRow={false}
          />
        </View>
      </View>
    </DocumentFrame>
  );
};
