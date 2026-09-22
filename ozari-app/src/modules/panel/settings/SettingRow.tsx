import MorphSwap from '@components/MorphSwap';

/**
 * ONE settings row, shared by every card on this screen: what the setting IS on the left, the
 * control that changes it (or the value that states it) on the right.
 *
 * It exists because there were two of these — security's and the calendar's — and they had already
 * drifted apart in the two ways a row like this can go wrong. Both are fixed here, once:
 *
 * **1. Vertical alignment.** The control is `items-center`, so a button, a switch, a dropdown and a
 * plain value all sit on the middle of their description instead of being pinned to its first line.
 * A two-line description with a button hanging off its top read as a mistake next to the password
 * row right above it, which was centred.
 *
 * **2. The row splits or stacks by ITS OWN width, never the viewport's.** This is the whole bug, and
 * it took three attempts to get right.
 *
 * - `shrink-0` on the action group says "never give way", so the group pushes straight past the
 *   card's padding and hangs outside its right edge (what "Quitar enlace" did on an iPhone).
 * - `min-w-0` says "squash me to nothing", which lets the flex algorithm size the group *below* its
 *   own buttons. The buttons are `whitespace-nowrap`, so they simply paint outside the box — and
 *   because the group was `justify-end`, that overflow went LEFTWARD, straight over the description.
 * - A `sm:flex-row` breakpoint (the version the owner reported, 2026-09-21) asks the wrong question.
 *   `sm:` measures the WINDOW, and this row's width has almost nothing to do with the window: the
 *   card is two thirds of a section inside a page inside a `main` beside a sidebar that the user can
 *   expand. At 793px — a perfectly wide window — the card is ~260px, so the row happily split
 *   left/right and the description came out one word per line beside a stack of buttons.
 *
 * The answer is to measure nothing at all. The row WRAPS, and the description carries a `basis-56`
 * floor (14rem — about 32 characters, the width below which a sentence stops reading as a sentence):
 *
 * - while the description's floor AND the action group's natural width both fit, they sit side by
 *   side, and the description takes every pixel left over (`grow`), which is what pins the actions
 *   to the right edge without a `justify-*` anywhere;
 * - the moment they do not fit, the actions fold onto their own line below the description, which
 *   then spans the full width.
 *
 * So the fold is decided by the real widths of the real content — this row's own buttons in this
 * card at this sidebar state — and every layout between a phone and an ultrawide falls out of one
 * rule. Nothing here may be given `shrink-0` (it would overflow again), `min-w-0` on the action side
 * (it would overlap again), or a `sm:`/`md:` variant (it would ask the window again).
 */
const SettingRow: React.FC<{
  label: string;
  description: string;
  /**
   * Cross-fade the description when it genuinely rewrites itself ("Conecta tu cuenta…" →
   * "Conectado como a@b.com"). Off by default: a static sentence has nothing to morph, and mounting
   * a swap layer around it would only add a box for no reason.
   */
  morphDescription?: boolean;
  /** FLIP identity, when the row lives inside a morph region that glides its rows into place. */
  flipId?: string;
  /** The row's own extra classes — in practice the morph region's item selector. */
  className?: string;
  /** The control(s). More than one is fine: they lay out in a wrapping, right-aligned group. */
  children: React.ReactNode;
}> = ({ label, description, morphDescription = false, flipId, className = '', children }) => (
  <div
    data-flip-id={flipId}
    className={`flex flex-wrap items-center gap-x-6 gap-y-3 py-4 ${className}`}
  >
    {/* `grow` + a `basis-56` floor: it takes the leftover space when the row is split, and it is
        also what decides WHEN the row splits — see the note above. */}
    <div className="min-w-0 grow basis-56">
      <span className="text-sm font-medium text-charcoal">{label}</span>
      {morphDescription ? (
        <MorphSwap block swapKey={description} className="mt-0.5">
          <p className="text-sm leading-relaxed text-charcoal/55">{description}</p>
        </MorphSwap>
      ) : (
        <p className="mt-0.5 text-sm leading-relaxed text-charcoal/55">{description}</p>
      )}
    </div>
    {/* No `min-w-0`, no `shrink-0` and no breakpoint here — see the note above; all three are how
        this row breaks. It only has to be able to WRAP internally, so a group too wide for a phone
        card breaks between its own buttons instead of out of the card. */}
    <div className="flex flex-wrap items-center gap-2">{children}</div>
  </div>
);

export default SettingRow;
