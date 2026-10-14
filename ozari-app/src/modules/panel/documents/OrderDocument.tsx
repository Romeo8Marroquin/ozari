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
  View,} from '@react-pdf/renderer';
import {
  LOGO_MARK_ASPECT,
  LOGO_MARK_PATHS,
  LOGO_MARK_STROKE_WIDTH,
  LOGO_MARK_TRANSFORM,
  LOGO_MARK_VIEWBOX,} from '@components/logoMarkPaths';
import { BANK_LOGO_MAX_HEIGHT, bankLogoFor } from './bankLogoImages';
import { documentReference, printedConditions } from './documentModel';
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
  descriptionWidth,
  DIVIDER_GAP_SECTION,
  DIVIDER_GAP_TABLE,
  DIVIDER_INSET,
  DIVIDER_WIDTH,
  footerPadding,
  GROUP_HEAD_AHEAD,
  HAIRLINE,
  HEADER_GAP,
  INK,
  MARGIN,
  MUTED,
  opticalCenterPad,
  PAGE_WIDTH,
  roundedTopPath,
  ROW_ALT,
  ROW_BASE,
  ROW_MIN_HEIGHT,
  ROW_PADDING,
  TABLE_HEAD,
  TABLE_HEAD_HEIGHT,
  TABLE_RADIUS,
  TINT,
  TOTALS_INNER_WIDTH,
  TOTALS_PADDING,
  TOTALS_WIDTH,
} from './documentTheme';
import type { DocumentGroup, DocumentLine, DocumentModel } from './documentModel';
/** * The rendered document — ONE template for both the comprobante and the cotización, so a client can * never receive two pieces of paper that look like they came from different companies. * * **Coverage-excluded, like `leafletMap`.** react-pdf's primitives are not DOM elements and render * through its own layout engine, which jsdom cannot drive, so a test here could only assert that our * own mock was called. Everything that DECIDES anything — what the groups are, what the balance is, * which conditions print, when the button appears, what the file is called — lives in * `documentModel.ts` and `downloadDocument.tsx`, which are pure and fully tested. What this file * holds is the LOOK, and the way to check a look is to render it: `pnpm doc:preview` writes a PDF * from fixture data. * * **It wears the app's brand, not a generic invoice's** (redesigned 2026-08-06 after the first draft * shipped entirely monochrome). react-pdf has no CSS gradients — but it does ship SVG primitives * including `LinearGradient`, which is how the cream→blossom rules, the table header and the balance * chip are drawn for real, with no PNG strips to maintain. The same `LinearGradient` trick is what * makes the brand mark possible: it is the app's own `LogoMark` geometry (`logoMarkPaths.ts`), drawn * through react-pdf's `Path`, so the logo on a client's document cannot drift from the logo in the app. * * **Every label says what it labels** (2026-08-25, after the owner read a generated one beside the * hand-made template it replaced). The rules that came out of that pass, and that new blocks should * follow: *
  - *A bare value is not a fact.* A phone number under a business name reads as a mystery number *
    until it says `Tel.`; a `Contacto` inside a card that never named the client could belong to *
    either party. Each fact card now carries a TITLE, and each row a label that survives being read *
    alone. *
  - *An abbreviation the reader has to decode is worse than a narrower column.* `Cant.` became *
    `Cantidad`, `Precio` became `Precio por día` (which is also what makes `cantidad × días × *
    precio` check out by hand), and the per-line `Total` became `Subtotal` — it is not the *
    document's total, and the number the client acts on is the saldo at the bottom. *
  - *Don't state a figure twice.* The per-table subtotal row was removed: the totals block already *
    lists every group's subtotal, and a lone table under a lone subtotal that then repeats reads as *
    an arithmetic mistake rather than as a summary. *
  - *Fill the left half.* The conditions block sits BESIDE the totals rather than under them, *
    which is both where the eye is and the void the old layout left. */
/** * An ASCII hyphen, deliberately — NOT the typographic minus `−` (U+2212). * * Helvetica is one of the PDF base-14 fonts, which are encoded in WinAnsi: U+2212 is not in that * character set, so react-pdf silently DROPS it. The first render of this design printed * "Descuento
  Q 100.00" with no sign at all, which reads as a charge rather than a credit — a * typographic nicety turning into a wrong number. Anything outside Latin-1 has the same problem * here; check a render before reaching for a fancy glyph. * * The condition bullets are drawn as a `View` for exactly this reason: a real bullet character is * one more glyph to gamble on, and a 2.5pt rounded square cannot be dropped by an encoding. */
const MINUS = '-';
/** * NO hyphenation, anywhere in the document. * * react-pdf hyphenates by default, which is an English-typesetting habit: Spanish business * documents do not break words, and in a narrow column it produced "Banco Indus-trial" as a bank's * name. A wrong-looking proper noun on the line telling a client where to send money is not a * typographic quibble. Returning the word whole makes the layout engine wrap at spaces only. * * Module scope on purpose — this is a document-wide setting in react-pdf, not a style. */Font.registerHyphenationCallback((word) => [word]);
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
  paidMark: {
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
  // No `marginTop`: every group after the first is preceded by a divider, and the divider owns the
  // WHOLE gap so that it stays centred in it (see `DIVIDER_GAP_TABLE`). The first group carries its
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
   * (2026-08-25). And the fill must be an atomic `Svg` (see `SolidFill`) rather than this View's
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
   * predecessor's two corner notches with a square patch in that predecessor's own tone. Mid-table
   * the repair is invisible (the patch is the colour it replaces) and the rows read as one block. At
   * a break the next row is on the NEXT PAGE, so the patch goes with it and the notches simply stay
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
   * corner box; it is absolutely positioned so it costs no layout. On a continuation page the first
   * row's patches land under the repeated header, where `TableHeadFill` has already drawn a row
   * tone — one step off at worst, across two 6pt corners.
   */
  cornerPatch: {
    position: 'absolute',
    top: -TABLE_RADIUS,
    width: TABLE_RADIUS,
    height: TABLE_RADIUS,
  },
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
  /**
   * A SECTION divider, not the table's bottom border.
   *
   * The distinction is DETACHMENT, not weight. Drawn tight under the last row it reads as part of
   * the table — a border the other three sides do not have. Ten points of air above it and it reads
   * as what it is: the rule between one block and the next, whether that next block is another
   * group's table or the summary. The space below it comes from whatever follows, which is
   * deliberately unequal — a sibling table is one step away, the summary is a section away
   * (`summary.marginTop`).
   *
   * Thinning it to 0.5pt was tried alongside the detachment and reverted: once the rule is no longer
   * touching the table it has to carry the separation on its own, and a half-point hairline is too
   * quiet to divide two sections. Detached AND full weight is the combination that works.
   */
  // Centred HORIZONTALLY by explicit margins, not `alignSelf` (see `DIVIDER_WIDTH`), and centred
  // VERTICALLY by carrying the whole gap itself — the vertical margins arrive per-instance, because
  // how much air the rule needs depends on what follows it.
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
  balanceChip: { position: 'relative', height: 30, marginTop: 8 },
  balanceRow: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 30,
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
  // ── Deposit details (inside the summary's left column) + page furniture ─────────────────────
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
  },});
/** The copy a document needs, resolved by the CALLER through i18next — the template takes strings so *
  it stays pure layout and the whole vocabulary is visible in one place at the call site. */
export interface DocumentCopy {
  title: string;
  reference: string;
  issuedAt: string;
  validUntil: string;
  paid: string;
  quoteNotice: string;
  termsNotice: string;
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
  billedDays: string;
  /** A FUNCTION so the value can be a real plural ("1 día" / "3 días") rather than a bare integer
   *
  the reader has to attach a unit to. */
  billedDaysValue: (days: number) => string;
  /** Why three nights can be three days — the rule, stated once, where the number is. */
  billedDaysHint: string;
  groupRental: string;
  groupSale: string;
  columnDescription: string;
  columnQuantity: string;
  columnDays: string;
  /** The rental table's price column. Names the UNIT, which is also what makes the row's arithmetic
   *
  verifiable by hand: `cantidad × días × precio por día`. */
  columnDailyPrice: string;
  columnUnitPrice: string;
  columnLineTotal: string;
  subtotal: string;
  deliveryFee: string;
  /** What the delivery fee BUYS. The old label priced a trip without saying it was a return trip —
   *
  the one line the hand-made template was explicit about and this one was not. */
  deliveryIncludesReturn: string;
  deliveryIncludesOneWay: string;
  free: string;
  discount: string;
  total: string;
  deposit: string;
  balance: string;
  conditions: string;
  banks: string;
  /** A FUNCTION, not a template: the numbers only exist inside react-pdf's per-page `render`, and
   *
  hand-substituting them would ship an unfilled `{{page}}` through i18next. */
  page: (pageNumber: number, totalPages: number) => string;}
interface OrderDocumentProps {
  model: DocumentModel;
  copy: DocumentCopy;
  /** Preformatted by the caller so currency and dates obey the app's own `es-GT` rules rather than
   *
  a second, subtly different set living in here. */
  money: (amount: number) => string;
  date: (value: Date) => string;
  dateTime: (value: Date) => string;}
/** * A cream→blossom fill. react-pdf has no CSS gradients, but its SVG primitives do — so the brand * is drawn for real rather than approximated with a flat colour or a PNG strip to keep in sync. * * Each instance needs a UNIQUE `id`: gradient definitions live in one document-wide namespace, so * two `<Defs>` sharing an id would silently resolve to whichever was parsed last. */
const BrandFill: React.FC<{
  id: string;
  width: number;
  height: number;
  radius?: number;
  /** Corner-to-corner instead of left-to-right — what the sidebar tile's `bg-gradient-to-br` does.
   *
  The full-bleed rules stay horizontal: a diagonal across 612pt is indistinguishable from one. */
  diagonal?: boolean;}> = ({ id, width, height, radius = 0, diagonal = false }) => (
  <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
    <Defs>
      <LinearGradient id={id} x1="0%" y1="0%" x2="100%" y2={diagonal ? '100%' : '0%'}>
        <Stop offset="0%" stopColor={CREAM} />
        <Stop offset="100%" stopColor={BLOSSOM} />
      </LinearGradient>
    </Defs>
    <Rect x={0} y={0} width={width} height={height} rx={radius} ry={radius} fill={`url(#${id})`} />
  </Svg>);
/** * The app's own isotype, drawn through react-pdf's SVG so it is vector in the PDF and cannot drift * from the mark the app renders (both read `logoMarkPaths.ts`). * * Sized by HEIGHT, because that is how the sidebar sizes it (`size-[88%]` on a square box, which a * DOM `<svg>` letterboxes to the taller dimension). react-pdf's `Svg` does no letterboxing, so the * width is computed from the mark's own aspect — derived from the viewBox, never written twice. */
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
  </Svg>);
/** * A flat rounded fill, drawn as an SVG rather than set as the parent's `backgroundColor`. * * That looks like a pointless indirection and is not. A `fixed` table header whose content turns * out not to fit leaves a painted fragment behind on the page it was measured against (see * `tableHead`), and how much gets painted depends on what is painting: a `backgroundColor` belongs * to the View, so react-pdf fills the whole leftover strip and the clipped labels come with it — * ~10pt of legible, duplicated column headings under an unrelated table. An `Svg` is ATOMIC: the * parent's `overflow: 'hidden'` clips it to a hairline instead. Keep the fill here. */
/** The sliver a row's rounded corner removed, in that row's own tone — see `cornerWedgePath` for why
 *  it is the sliver and not the corner square. */
const CornerWedge: React.FC<{ side: 'left' | 'right'; color: string }> = ({ side, color }) => (
  <Svg
    width={TABLE_RADIUS}
    height={TABLE_RADIUS}
    viewBox={`0 0 ${TABLE_RADIUS} ${TABLE_RADIUS}`}
  >
    <Path d={cornerWedgePath(TABLE_RADIUS, side)} fill={color} />
  </Svg>);
const TableHeadFill: React.FC = () => (
  <Svg
    width={CONTENT_WIDTH}
    height={TABLE_HEAD_HEIGHT}
    viewBox={`0 0 ${CONTENT_WIDTH} ${TABLE_HEAD_HEIGHT}`}
  >
    {/* TWO shapes, in this order. Underneath, the row tone in a shape that is rounded on top and
        SQUARE at the bottom (`roundedTopPath`) — it fills the wedges the band's bottom curve would
        otherwise cut out of the table, so the table's sides run unbroken from the header into the
        rows. On top, the band itself, with all four corners rounded exactly as before.

        The backing is `ROW_BASE` because the first row of a table always is. On a CONTINUATION page
        the row under the repeated header may be the alternate tone, and a `fixed` node drawn once
        cannot know which — the mismatch is two 6pt corner wedges one step off, which is invisible
        beside the page-white it replaced. */}
    <Path
      d={roundedTopPath(CONTENT_WIDTH, TABLE_HEAD_HEIGHT, TABLE_RADIUS)}
      fill={ROW_BASE}
    />
    <Rect
      x={0}
      y={0}
      width={CONTENT_WIDTH}
      height={TABLE_HEAD_HEIGHT}
      rx={TABLE_RADIUS}
      ry={TABLE_RADIUS}
      fill={TABLE_HEAD}
    />
  </Svg>);
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
  </View>);
/** One labelled fact inside a card. `hint` carries the rule behind a number that would otherwise *
  invite the question ("why does a two-night rental bill three days?"). */
const Fact: React.FC<{ label: string; value: string; hint?: string }> = ({ label, value, hint }) => (
  <View>
    <Text style={styles.factLabel}>{label.toUpperCase()}</Text>
    <Text style={styles.factValue}>{value}</Text>
    {hint !== undefined && <Text style={styles.factHint}>{hint}</Text>}
  </View>);
const OrderDocument: React.FC<OrderDocumentProps> = ({ model, copy, money, date, dateTime }) => {
  const reference = documentReference(model);
  const groupTitle = (group: DocumentGroup): string =>
    group.kind === 'rental' ? copy.groupRental : copy.groupSale;
  // Days are a rental-only column, and only when there is a window to bill: a purchase-only order
  // has none, so the table drops the column rather than printing a placeholder.
  const showsDays = (group: DocumentGroup): boolean =>
    group.kind === 'rental' && model.event.billedDays !== undefined;
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
   * covers everything else, and is omitted entirely when no terms are written — pointing at
   * conditions that do not exist would be worse than saying nothing.
   */
  const notes = [
    ...(model.kind === 'quote' ? [copy.quoteNotice] : []),
    ...(model.letterhead.hasTerms ? [copy.termsNotice] : []),
  ];
  return (
    <Document
      title={reference ?? copy.title}
      author={model.letterhead.businessName}
      creator={model.letterhead.businessName}
    >
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
              <Text style={styles.businessName}>{model.letterhead.businessName}</Text>
              {model.letterhead.businessPhone !== '' && (
                <Text style={styles.businessPhone}>
                  {copy.phonePrefix} {model.letterhead.businessPhone}
                </Text>
              )}
            </View>
          </View>
          <View style={styles.headerRight}>
            <Text style={styles.docType}>{copy.title.toUpperCase()}</Text>
            {reference !== undefined && (
              <Text style={styles.docMeta}>
                {copy.reference} {reference}
              </Text>
            )}
            <Text style={styles.docMeta}>
              {copy.issuedAt} {date(model.issuedAt)}
            </Text>
            {model.validUntil !== undefined && (
              <Text style={styles.docMeta}>
                {copy.validUntil} {date(model.validUntil)}
              </Text>
            )}
            {/* The PAGADO mark is the document changing meaning: the same page goes out as a
                request for payment and comes back as proof of one. */}
            {model.isPaid && <Text style={styles.paidMark}>{copy.paid}</Text>}
          </View>
        </View>
        <View style={styles.facts}>
          <View style={styles.factCard}>
            <Text style={styles.factTitle}>{copy.clientCard.toUpperCase()}</Text>
            <Fact label={copy.clientName} value={model.client.name} />
            <Fact label={copy.contact} value={model.client.contact} />
            <Fact label={copy.address} value={model.client.address} />
          </View>
          <View style={styles.factCard}>
            <Text style={styles.factTitle}>{copy.eventCard.toUpperCase()}</Text>
            <Fact label={copy.eventType} value={model.event.type} />
            <Fact label={copy.delivery} value={dateTime(model.event.deliveryAt)} />
            {model.event.pickupAt !== undefined && (
              <Fact label={copy.pickup} value={dateTime(model.event.pickupAt)} />
            )}
            {model.event.billedDays !== undefined && (
              <Fact
                label={copy.billedDays}
                value={copy.billedDaysValue(model.event.billedDays)}
                hint={copy.billedDaysHint}
              />
            )}
          </View>
        </View>
        {model.groups.map((group, groupIndex) => {
          const withDays = showsDays(group);
          const description = descriptionWidth(withDays);
          const lastIndex = group.lines.length - 1;
          // The divider under this group carries the WHOLE gap to whatever comes next — another
          // table for every group but the last, and the summary (a change of section) for that one.
          const dividerGap =
            groupIndex === model.groups.length - 1 ? DIVIDER_GAP_SECTION : DIVIDER_GAP_TABLE;
          /** The rule that closes this group, drawn under its last row. */
          const closingRule = (
            <View
              style={[
                styles.tableEnd,
                { marginTop: dividerGap.above, marginBottom: dividerGap.below },
              ]}
            />
          );
          /**
           * A row, and — on the LAST one — the rule that closes the group, bound to it.
           *
           * The rule used to follow the table as its own element, which let a page break fall
           * between them: a document whose last row ended flush with the foot of a page opened the
           * next one with a lone hairline separating nothing (seen in a render, 2026-08-26). It has
           * no meaning without content above it, so it is not allowed to leave without that content
           * — `wrap={false}` around the pair moves both or neither.
           *
           * The consequence is deliberate and correct: when the pair does not fit, the last row is
           * carried to the next page too, and the repeating header goes with it, so the table
           * legitimately continues and then closes. A rule alone at the top of a page is not a state
           * this can reach.
           */
          const row = (line: DocumentLine, index: number): React.ReactElement => (
            <View key={index} wrap={false}>
            <View
              style={[
                styles.row,
                // EVERY row is filled — see `ROW_BASE`. The alternation carries the eye across a
                // wide row; it is not what makes the table visible, which is why the pair is two
                // fills rather than a fill and the page.
                { backgroundColor: index % 2 === 1 ? ROW_ALT : ROW_BASE },
                // EVERY row is rounded at the bottom, not just the last — the row that ends a page
                // has to close as cleanly as the row that ends the table, and no row can know which
                // it is. The notches are repaired from below instead; see `cornerPatch`.
                {
                  borderBottomLeftRadius: TABLE_RADIUS,
                  borderBottomRightRadius: TABLE_RADIUS,
                },
              ]}
            >
              {/* The two patches that close the row ABOVE — in ITS tone, which is always this row's
                  alternate. Absent on the group's first row, which has a header above it rather than
                  a row, and absent (by landing on the next page) wherever a break falls. */}
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
              {/* A long product name WRAPS — a PDF has no hover, so a truncated description is
                  information the reader can never recover. */}
              <Text style={[styles.cellStrong, { width: description }]}>{line.description}</Text>
              <Text style={[styles.cell, { width: COL_QUANTITY, textAlign: 'right' }]}>
                {line.quantity}
              </Text>
              {withDays && (
                <Text style={[styles.cell, { width: COL_DAYS, textAlign: 'right' }]}>
                  {line.days}
                </Text>
              )}
              <Text style={[styles.cell, { width: COL_PRICE, textAlign: 'right' }]}>
                {money(line.unitPrice)}
              </Text>
              <Text style={[styles.cellStrong, { width: COL_TOTAL, textAlign: 'right' }]}>
                {money(line.total)}
              </Text>
            </View>
              {index === lastIndex && closingRule}
            </View>
          );
          return (
            // FLAT, deliberately: the group TITLE is a page-level sibling, and only the header and
            // rows share a `View`. Two rules depend on that shape and neither survives tidying it
            // into one wrapper per group — see `GROUP_HEAD_AHEAD` for why the title must have
            // previous siblings, and the `View` below for why the header must NOT.
            <Fragment key={group.kind}>
              <Text
                minPresenceAhead={GROUP_HEAD_AHEAD}
                style={[styles.groupTitle, groupIndex === 0 ? styles.firstGroupTitle : {}]}
              >
                {groupTitle(group)}
              </Text>
              {/* This `View` exists ONLY to SCOPE the repeating header to its own table. A `fixed`
                  node repeats on every page for as long as its container is being paginated, so as a
                  page-level child it would go on labelling columns under the sale table and beside
                  the totals. Wrapping it with the rows it labels ends the repeat with the table. */}
              <View>
                {/* `fixed` keeps the columns labelled when a group runs past a page break — the
                    single reason this is react-pdf and not a hand-positioned builder.
                    `overflow: 'hidden'` in the style is NOT decoration; see `tableHead`. */}
                <View style={styles.tableHead} fixed>
                  <TableHeadFill />
                  <View style={styles.tableHeadRow}>
                    <Text style={[styles.headCell, { width: description }]}>
                      {copy.columnDescription}
                    </Text>
                    <Text style={[styles.headCell, { width: COL_QUANTITY, textAlign: 'right' }]}>
                      {copy.columnQuantity}
                    </Text>
                    {withDays && (
                      <Text style={[styles.headCell, { width: COL_DAYS, textAlign: 'right' }]}>
                        {copy.columnDays}
                      </Text>
                    )}
                    <Text style={[styles.headCell, { width: COL_PRICE, textAlign: 'right' }]}>
                      {withDays ? copy.columnDailyPrice : copy.columnUnitPrice}
                    </Text>
                    <Text style={[styles.headCell, { width: COL_TOTAL, textAlign: 'right' }]}>
                      {copy.columnLineTotal}
                    </Text>
                  </View>
                </View>
                {group.lines.map(row)}
              </View>
            </Fragment>
          );
        })}
        {/* Everything that closes the document is ONE block, and it must not be split by a page
            break: the conditions and the deposit details qualify the very figures beside them. */}
        <View style={styles.summary} wrap={false}>
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
              <View>
                <Text style={styles.blockTitle}>{copy.banks.toUpperCase()}</Text>
                <View style={styles.banks}>
                  {model.letterhead.banks.map((bank, index) => {
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
            )}
          </View>
          <View style={styles.totals}>
            {model.totals.groups.map((group) => (
              <View key={group.kind} style={styles.totalLine}>
                <Text style={styles.totalLabel}>
                  {copy.subtotal} {group.kind === 'rental' ? copy.groupRental : copy.groupSale}
                </Text>
                <Text style={styles.totalValue}>{money(group.subtotal)}</Text>
              </View>
            ))}
            {model.totals.delivery !== undefined && (
              <View style={styles.totalLine}>
                <View>
                  <Text style={styles.totalLabel}>{copy.deliveryFee}</Text>
                  <Text style={styles.totalNote}>{deliveryNote}</Text>
                </View>
                {/* Zero is not blank: "Gratis" is something the business is telling the client. */}
                <Text style={styles.totalValue}>
                  {model.totals.delivery === 0 ? copy.free : money(model.totals.delivery)}
                </Text>
              </View>
            )}
            {model.totals.discount !== undefined && (
              <View style={styles.totalLine}>
                <Text style={styles.totalLabel}>{copy.discount}</Text>
                <Text style={styles.totalValue}>{MINUS}{money(model.totals.discount)}</Text>
              </View>
            )}
            <View style={styles.grandLine}>
              <Text style={styles.grandLabel}>{copy.total}</Text>
              <Text style={styles.grandValue}>{money(model.totals.total)}</Text>
            </View>
            {model.totals.deposit !== undefined && (
              <View style={styles.totalLine}>
                <Text style={styles.totalLabel}>{copy.deposit}</Text>
                <Text style={styles.totalValue}>{MINUS}{money(model.totals.deposit)}</Text>
              </View>
            )}
            {/* The number the client acts on, so it gets the brand and the weight. */}
            <View style={styles.balanceChip}>
              <BrandFill id="balance" width={TOTALS_INNER_WIDTH} height={30} radius={8} />
              <View style={styles.balanceRow}>
                <Text style={styles.balanceLabel}>{copy.balance}</Text>
                <Text style={styles.balanceValue}>{money(model.totals.balance)}</Text>
              </View>
            </View>
          </View>
        </View>
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
  );};
export default OrderDocument;
