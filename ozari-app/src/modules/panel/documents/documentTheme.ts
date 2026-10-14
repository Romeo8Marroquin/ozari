/**
 * The document's design tokens — the app's brand, restated in the units a PDF thinks in.
 *
 * A PDF has no CSS custom properties, so these are the one place the values live. They are the
 * SAME colours as `index.css` (`--color-charcoal`, `--color-cream`, `--color-blossom`): a client's
 * paperwork has to look like it came from the app that produced it, which was the whole complaint
 * about the first, entirely monochrome draft.
 */

/** LETTER at 72dpi, in points — react-pdf's native unit. */
export const PAGE_WIDTH = 612;
export const PAGE_HEIGHT = 792;
export const MARGIN = 42;
export const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

/** The full-bleed brand rule at the top and bottom of every page. */
export const BAR_HEIGHT = 10;

// ── Page furniture clearance ──────────────────────────────────────────────────────────────────
//
// The air under the letterhead and above the standing notes belongs to the FURNITURE, never to the
// content that happens to sit next to it (owner rule, 2026-08-26). A margin on the first fact card
// is a rule about fact cards: it holds on page one and nowhere else, so page two — which begins
// with whatever the break handed it — ran straight into the letterhead, and a page whose content
// filled the column ran straight into the notes. Both gaps now come from elements that repeat on
// every page, which is the only kind of promise pagination can keep.

/** Under the repeating letterhead, before the first thing on ANY page. */
export const HEADER_GAP = 16;
/** Above the standing notes. Guaranteed on every page, including one whose content ends exactly at
 *  the column's foot — the case that used to run flush into them. */
export const FOOTER_CLEARANCE = 10;

/**
 * The page's bottom padding: everything the FURNITURE occupies, plus the clearance above it.
 *
 * Computed from the notes that will actually render rather than fixed at the worst case. That is
 * what makes the clearance affordable: the padding was a flat 58 sized for a quote's two standing
 * lines, so a receipt — which prints one — paid for a line it does not have. A receipt now gets
 * those points back as content room, and a quote buys real clearance with them. Adding the
 * clearance to the flat number instead cost the one-page target a whole second sheet, which is a
 * high price for a gap nobody had measured.
 *
 * The floor covers the page number alone, for a document with no standing notes at all.
 */
const NOTES_BOTTOM = 30;
const NOTES_LINE = 7.5 * 1.4;
const NOTES_GAP = 2;
const PAGE_NUMBER_SPACE = 28;
export const footerPadding = (noteCount: number): number =>
  Math.max(
    NOTES_BOTTOM + noteCount * NOTES_LINE + Math.max(noteCount - 1, 0) * NOTES_GAP,
    PAGE_NUMBER_SPACE,
  ) + FOOTER_CLEARANCE;

// ── The letterhead's brand tile ───────────────────────────────────────────────────────────────

/**
 * The mark sits in a gradient tile, exactly as it does in the panel sidebar's `BrandMark` — a
 * cream→blossom rounded square holding the charcoal isotype at 88%.
 *
 * The document used to print the bare isotype, which is the one place the app's chrome and its
 * paperwork disagreed about what the brand looks like. The proportions are taken from the sidebar
 * rather than chosen: `rounded-xl` on a `size-11` tile is a 12/44 corner, and `size-[88%]` letterboxes
 * the mark to 88% of the tile's height.
 */
export const BRAND_TILE = 42;
export const BRAND_TILE_RADIUS = (BRAND_TILE * 12) / 44;
export const BRAND_MARK_HEIGHT = BRAND_TILE * 0.88;

/**
 * WHERE THE BRAND GRADIENT IS ALLOWED (owner rule, 2026-08-26).
 *
 * Exactly four places: the top rule, the bottom rule, the logo TILE, and the SALDO PENDIENTE chip.
 * That is the whole point of a highlight — it marks the frame of the page and the one number the
 * client has to act on. The table headers used to wear it too, which is three or four saturated
 * bands per page and turns the accent into wallpaper: nothing is emphasised because everything is.
 * Headers are a plain neutral now — distinguishable, not highlighted.
 *
 * A new element does NOT get the gradient. If something needs to stand out, it gets the tinted
 * panel surface or weight; if it needs to lead the eye, ask whether it beats the saldo, and it
 * almost certainly does not.
 */
export const CHARCOAL = '#262626';
export const CREAM = '#fceda7';
export const BLOSSOM = '#fca7f0';
/** Body copy that is not a heading — readable, never as heavy as the figures beside it. */
export const INK = '#3f3f3f';
/** Labels and captions. Deliberately above the 4.5:1 line on white: this document gets PRINTED,
 *  and grey that survives a screen can disappear on a home inkjet. */
export const MUTED = '#6e6e6e';
export const HAIRLINE = '#e8e4e6';
/** The soft brand wash behind panels — blossom at a few percent, not a neutral grey. */
export const TINT = '#fdf6fb';
/**
 * Table rows — TWO fills, and neither of them is paper (owner, 2026-08-26).
 *
 * The stripe used to alternate a fill with nothing, which works only once a table is long enough for
 * the pattern to read AS a pattern. On a one- or three-line group — the ordinary case here — the row
 * under the header was bare paper, so the table had no visible body: the header band floated over
 * what looked like empty page, and the white belonged to the row without ever saying so.
 *
 * Giving every row a fill makes the table a BLOCK at any length, and the alternation keeps doing its
 * real job (carrying the eye across a wide row) at the same strength as before: the step between the
 * two fills matches the step the old white→zebra pair had. It also repairs a rule that was quietly
 * conditional — the last row's rounded bottom corners only ever appeared when the row count happened
 * to be odd, because a row with no fill has no corner to round. A table is now a rounded rectangle
 * every time.
 *
 * Both tones sit in the same warm-neutral family as `HAIRLINE` and `TABLE_HEAD`, so a table reads as
 * one material rather than as a second, colder neutral on a page that has only ever had one. The
 * family is a HUE, not a fixed offset — red leads and blue sits halfway to green (`R−G = 2(B−G)`),
 * with the chroma shrinking as a tone approaches white. Asserted, because "pick something light
 * grey" is exactly how a second neutral gets in.
 *
 * Both are OFF-WHITE, not two greys (owner, 2026-08-26). The pair has one job each: the lighter
 * tone separates the TABLE from the paper, the darker one separates a ROW from its neighbour.
 * `ROW_BASE` is therefore as close to white as it can get while still being seen — it is not a
 * candidate for adjustment, so every change to the contrast is a change to `ROW_ALT` alone.
 *
 * The step between them is exactly the step the old white→fill stripe had (5/7/6 per channel).
 * Landing there took an overshoot in each direction: at 94% the alternate read as a second grey and
 * the table stopped looking like paper with ruled rows; pulled back to 95.3% the two rows were hard
 * to tell apart. Restoring the ORIGINAL delta, with both tones now sitting off the paper, is the
 * non-arbitrary answer — the alternation is as strong as it ever was, it simply no longer carries
 * the table's visibility as well.
 */
export const ROW_BASE = '#faf8f9';
export const ROW_ALT = '#f5f1f3';
/**
 * The band a table's column labels sit on — a neutral, and the DARKEST of the light surfaces so the
 * stack reads in order: header (`#e4e0e2`) > hairline > alternate row > base row > tint panel > paper.
 *
 * Warm rather than a pure grey, so it belongs to the same family as `HAIRLINE` and the tint instead
 * of introducing a second, colder neutral to a page that has only ever had one.
 */
export const TABLE_HEAD = '#e4e0e2';

/**
 * Column geometry for the line tables, in points, resolved ONCE here.
 *
 * Declared as absolute widths rather than flex ratios because the header and the body rows are
 * separate elements — `fixed` repeats the header on every page, so it cannot share a flex context
 * with the rows it labels. Two independent flex layouts drift by a point or two and the columns
 * stop lining up; fixed widths cannot.
 *
 * They are sized for the LABELS, not the figures (2026-08-25): the headings used to be abbreviated
 * to fit the columns — `Cant.`, a bare `Precio` that never said *per what*, a `Total` on a line that
 * is not the document's total — and an abbreviation the reader has to decode is a worse trade than
 * a few points of description width. Every heading is now a whole word.
 */
export const COL_QUANTITY = 54;
export const COL_DAYS = 34;
export const COL_PRICE = 82;
export const COL_TOTAL = 84;

export const ROW_PADDING = 10;
/** A single-line row. The floor, not the height — a description that wraps makes its row taller. */
export const ROW_MIN_HEIGHT = 21;
/** The column-label band. Named because the keep-together rule has to reserve it by number. */
export const TABLE_HEAD_HEIGHT = 24;

/**
 * How much room a group TITLE demands after itself before it is allowed to end a page.
 *
 * A table's title, its column labels and its first row are ONE thought. A heading alone at the foot
 * of a page announces a table that is not there — and it was also the cause of the clipped grey band
 * beneath it, because a `fixed` header laid out in the last points of a page leaves its partial copy
 * behind (see `tableHead`). Reserving the header plus one row moves all three together.
 *
 * ⚠️ **This number only works because of WHERE the title sits in the tree.** react-pdf's
 * `shouldBreak` ignores `minPresenceAhead` when the node has no non-fixed previous sibling on the
 * page — `breakingImprovesPresence`, i.e. "you are already at the top of your box, so moving you
 * cannot help". A title nested as the FIRST child of a per-group `View` is always in exactly that
 * position, which is why the prop appeared to do nothing on the group, on the header and on the
 * title alike (2026-08-25/26). The title is a PAGE-level sibling now, after the facts block and the
 * previous group's rows, so the rule can actually fire. Do not re-nest it to tidy the JSX.
 *
 * A floor, not a promise: a description that wraps to two lines makes its row taller than this, so a
 * group may still split right after its first row — which is fine, and is the case the repeating
 * header exists to serve. The title's own `marginBottom` is added by the engine, so it is not here.
 */
export const GROUP_HEAD_AHEAD = TABLE_HEAD_HEIGHT + ROW_MIN_HEIGHT;

/** The table's corner. Used by the header band AND by the last row, so a table is a rounded
 *  rectangle rather than a rounded top on a square bottom. */
export const TABLE_RADIUS = 6;

/**
 * A rectangle rounded on its TOP corners only — the shape BEHIND the table header's band.
 *
 * The header keeps all four of its own corners; this sits under it, in the row tone, and fills the
 * two wedges its bottom curve would otherwise cut out of the table (owner, 2026-08-26). Before it,
 * the header's bottom corners curved away from the square row beneath them and the table's left and
 * right edges broke for 6pt and then resumed — page-white intruding into the middle of the table.
 *
 * Squaring the header's own bottom instead was tried and rejected: it makes the same picture, but by
 * altering the element that was already right. Two shapes keep the header a header, and the shape is
 * rounded on TOP so it hides completely behind the band rather than adding its own square corners to
 * the top of the table.
 *
 * A `Path` because SVG's `rx` rounds all four corners and cannot be told to round two.
 */
/**
 * The sliver a rounded corner cuts away: the square minus its quarter disc.
 *
 * Painting the whole corner SQUARE instead is the obvious shortcut and it fails visibly — the patch
 * that repairs a row's corners lands under the repeated table header on a continuation page, where a
 * square covers header band as well as the sliver, nicking a light notch out of it (seen in a
 * render, 2026-08-26). Filling only what the curve removed means the patch can never cover anything
 * that was not already the colour it is replacing.
 */
export const cornerWedgePath = (radius: number, side: 'left' | 'right'): string =>
  side === 'left'
    ? `M 0 0 L 0 ${radius} L ${radius} ${radius} A ${radius} ${radius} 0 0 1 0 0 Z`
    : `M ${radius} 0 L ${radius} ${radius} L 0 ${radius} A ${radius} ${radius} 0 0 0 ${radius} 0 Z`;

export const roundedTopPath = (width: number, height: number, radius: number): string =>
  [
    `M 0 ${height}`,
    `L 0 ${radius}`,
    `A ${radius} ${radius} 0 0 1 ${radius} 0`,
    `L ${width - radius} 0`,
    `A ${radius} ${radius} 0 0 1 ${width} ${radius}`,
    `L ${width} ${height}`,
    'Z',
  ].join(' ');

/**
 * The rule between one block and the next — half the content width, centred.
 *
 * Centred by explicit MARGINS rather than `alignSelf: 'center'`: react-pdf resolved a percentage
 * width against a box that made the rule sit off to one side (visible in a render, 2026-08-26), and
 * points computed here cannot drift. Half-width is deliberate — long enough to read as a divider,
 * short enough that it can never be mistaken for a table's bottom border.
 */
export const DIVIDER_WIDTH = CONTENT_WIDTH * 0.5;
export const DIVIDER_INSET = (CONTENT_WIDTH - DIVIDER_WIDTH) / 2;

/**
 * The air on EACH side of a divider — equal, because a rule that is not centred in the gap it
 * divides reads as BELONGING to whichever block it sits nearer. It sat 9pt under a table and 16pt
 * above the next one, so it looked like the first table's bottom border, which is the one reading
 * the whole detached-divider design exists to prevent.
 *
 * Two values, because the two gaps mean different things: one table to the next is a STEP within a
 * list, the tables to the summary is a change of SECTION. The elements that follow a divider
 * therefore carry NO top margin of their own — the divider owns the whole gap, which is the only
 * way "centred" can stay true when the thing below it changes.
 */
/**
 * The air above and below the rule, per context — DELIBERATELY not symmetric, and tuned by eye
 * rather than derived.
 *
 * Geometric centring is not optical centring here, because the two sides of the gap are not the
 * same kind of edge: above the rule a table row ends with its own vertical padding, below it a
 * heading begins with leading above its cap height. Split the gap exactly in half and the rule
 * still reads as sitting nearer the table — which is exactly how it looked once it WAS centred
 * (2026-08-26), so it sits a little below the middle.
 *
 * Two contexts, because the two gaps mean different things: one table to the next is a STEP within
 * a list, the tables to the summary is a change of SECTION. The elements that follow a divider
 * carry NO top margin of their own — the divider owns the whole gap, which is the only way these
 * numbers can stay meaningful when what follows changes.
 */
export const DIVIDER_GAP_TABLE = { above: 15, below: 10 };
export const DIVIDER_GAP_SECTION = { above: 21, below: 16 };

/** What is left for the description once the numeric columns have taken their share. */
export const descriptionWidth = (withDays: boolean): number =>
  CONTENT_WIDTH -
  COL_QUANTITY -
  COL_PRICE -
  COL_TOTAL -
  (withDays ? COL_DAYS : 0) -
  // The row's own horizontal padding, both sides.
  ROW_PADDING * 2;

/**
 * The totals panel, right-aligned beside the conditions.
 *
 * It is a PANEL, not loose lines (owner, 2026-08-26). On white, the running subtotals, the total and
 * the balance read as three unrelated things floating beside the tables rather than as the summary
 * OF them — "I don't see the distinction between the tables and the mini table down". Giving it the
 * same tinted surface the fact cards use makes the document's vocabulary consistent: panels are
 * tinted, tables have a gradient header.
 */
export const TOTALS_WIDTH = 264;
export const TOTALS_PADDING = 12;
/** What the panel's own padding leaves for the balance chip — which is drawn at an explicit width
 *  because it is an SVG, and an SVG cannot be told to fill its parent. */
export const TOTALS_INNER_WIDTH = TOTALS_WIDTH - TOTALS_PADDING * 2;

// ── Bank details ──────────────────────────────────────────────────────────────────────────────

/**
 * The deposit block is a STACK of borderless rows — logo, then account type / number / holder —
 * rather than the bordered cards the first attempt used (owner, 2026-08-25: the hand-made template
 * read better, and this is the shape it had).
 *
 * It lives in the SUMMARY's left column, beside the totals, which is both where the space already
 * was and where the information belongs: the client reads what they owe and finds where to pay it
 * without moving their eyes. As a full-width band under the totals it needed ~95pt that an ordinary
 * order does not have, and pushed the business's own bank details onto a second sheet — the one
 * place the person meant to use them is least likely to look.
 */
export const BANK_ROW_GAP = 8;
/**
 * The mark's slot. Fixed, and reserved even for a bank that ships no logo (its name goes here
 * instead), so every account's number starts at the same x — the alignment IS the block.
 *
 * It must clear the WIDEST mark we print: a logo is sized by height and takes whatever width its
 * aspect gives it, so `height × aspect` has to fit here or the slot crops it. BAC is the current
 * bound at 22pt × 2.92 ≈ 64pt. Check a render when adding a logo or changing a height.
 */
export const BANK_MARK_WIDTH = 70;

// ── Optical centring ──────────────────────────────────────────────────────────────────────────

/**
 * The padding that lifts vertically-centred text into the OPTICAL middle of its box.
 *
 * react-pdf centres the line BOX, and a line box is not symmetric about the glyphs it holds: the
 * baseline sits at the font's ascent from the top, so the space below it — descender room these
 * labels (`Saldo pendiente`, `TOTAL`, a table heading) mostly do not use — is counted as if it were
 * ink. Centre the box and the visible letters land BELOW the middle of the chip.
 *
 * Padding shifts centred content by HALF of what is added, and it is added at the BOTTOM because
 * the correction is upward. The coefficient is measured, not derived: at `lineHeight: 1` the cap
 * band of a 12pt run sits ~1.05pt low, i.e. about 0.0875 of the font size, so lifting it needs
 * ~0.175 × fontSize of bottom padding. Take the size of the LARGEST text in the row — it is the one
 * the eye centres on.
 *
 * ⚠️ **This was wrong once, in the direction as well as the size** (2026-08-25 → 26). The first
 * attempt reasoned from font metrics that "the glyphs must sit high", added top padding, and was
 * confirmed by a preview raster — which was silently substituting a SERIF for Helvetica because its
 * font pack failed to load, so every glyph sat somewhere else entirely. **Verify a metric like this
 * against a render you have checked is using the real font**, and prefer measuring pixels to
 * reasoning about ascents.
 */
export const opticalCenterPad = (fontSize: number): number => Math.round(fontSize * 0.175 * 2) / 2;
