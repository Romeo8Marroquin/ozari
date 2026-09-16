import MorphSwap from '@components/MorphSwap';

/**
 * ONE settings row, shared by every card on this screen: what the setting IS on the left, the
 * control that changes it (or the value that states it) on the right.
 *
 * It exists because there were two of these — security's and the calendar's — and they had already
 * drifted apart in the two ways a row like this can go wrong. Both are fixed here, once:
 *
 * **1. Vertical alignment.** The control is `sm:items-center`, so a button, a switch, a dropdown and
 * a plain value all sit on the middle of their description instead of being pinned to its first
 * line. A two-line description with a button hanging off its top read as a mistake next to the
 * password row right above it, which was centred.
 *
 * **2. The right column must WRAP, never shrink and never hold firm.** This is the whole bug, and
 * both obvious fixes are wrong:
 *
 * - `shrink-0` says "never give way", so at `sm` and up the group pushes straight past the card's
 *   padding and hangs outside its right edge (what "Quitar enlace" did on an iPhone).
 * - `min-w-0` says "squash me to nothing", which lets the flex algorithm size the group *below* its
 *   own buttons. The buttons are `whitespace-nowrap`, so they simply paint outside the box — and
 *   because the group is `justify-end`, that overflow goes LEFTWARD, straight over the description.
 *   That is the "Generar enlace sits on top of the text" overlap.
 *
 * The right answer is the DEFAULT (`min-width: auto`) plus `flex-wrap`: the group's floor becomes
 * its widest BUTTON rather than the whole row, so when space runs out the actions fold onto a second
 * line, right-aligned, and nothing ever overlaps or overflows. The left column carries `min-w-0` and
 * `sm:flex-1` so it is the side that gives way — wrapping a sentence is free, wrapping buttons is
 * not, so the text yields first and the actions only fold when even that is not enough.
 * (`sm:flex-1` is gated at `sm` on purpose: `flex-1` in the stacked `flex-col` layout would set a
 * zero basis on the BLOCK axis and collapse the column.)
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
    className={`flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6 ${className}`}
  >
    <div className="min-w-0 sm:flex-1">
      <span className="text-sm font-medium text-charcoal">{label}</span>
      {morphDescription ? (
        <MorphSwap block swapKey={description} className="mt-0.5">
          <p className="text-sm leading-relaxed text-charcoal/55">{description}</p>
        </MorphSwap>
      ) : (
        <p className="mt-0.5 text-sm leading-relaxed text-charcoal/55">{description}</p>
      )}
    </div>
    {/* No `min-w-0` and no `shrink-0` here — see the note above; both are how this row breaks. */}
    <div className="flex flex-wrap items-center gap-2 sm:justify-end">{children}</div>
  </div>
);

export default SettingRow;
