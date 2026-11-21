import { useId, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { HiOutlineChevronDown } from 'react-icons/hi2';
import Collapse from '@components/Collapse';
import MorphSwap from '@components/MorphSwap';
import { foldGrid, settleFoldedGrid, unfoldGrid } from '../pageMotion';
import type { OrderAction } from '../orders/order.types';
import type { UpNextItem } from './dashboard.types';
import UpNextCard from './UpNextCard';
import { useGridColumns } from './useGridColumns';

const KEY = 'modules.panel.dashboard.upNext';

/**
 * One of the hairlines either side of "Ver N más" (owner, 2026-11-20 — a divider marks the fold
 * better than a filled chip, which weighed as much as the cards' own actions).
 *
 * Each rule is a child of the BUTTON, hung outside it (`right-full` / `left-full`): that way the
 * button's own `hover:` / `focus-visible:` drive it (`group/fold`) — Tailwind gates `hover` to real
 * pointers, so a tap never leaves the rules stuck long — and it rides the label's `MorphSwap` width
 * ease instead of jumping when "Ver 3 más" becomes "Ver menos". `pointer-events-none` keeps it from
 * widening the click target.
 *
 * Length is a share of the ROW (`cqw`, the row is the `@container`): 18% at full stretch, resting at
 * ~10% (`scale-x` 0.56, anchored on the text side so it grows outward). `scale`, not `width`, so
 * the hover never re-lays anything out — and the transition names `scale` itself (a Tailwind v4
 * `scale-x-*` is the independent `scale` property, which `transition-transform` would not animate).
 */
const RULE =
  'pointer-events-none absolute top-1/2 h-px w-[18cqw] scale-x-[0.56] bg-charcoal/15 transition-[scale,background-color] duration-[450ms] ease-[var(--ease-settle)] group-hover/fold:scale-x-100 group-hover/fold:bg-charcoal/30 group-focus-visible/fold:scale-x-100 group-focus-visible/fold:bg-charcoal/30 motion-reduce:transition-none';

/** The cards after the first row — the ones the fold hides. */
const cardsAfterFirstRow = (grid: HTMLElement, columns: number): HTMLElement[] =>
  (Array.from(grid.children) as HTMLElement[]).slice(columns);

/** The height the grid has when only its first row shows: the bottom of that row's tallest card,
 *  measured from the grid's own top. */
const firstRowHeight = (grid: HTMLElement, columns: number): number => {
  const top = grid.getBoundingClientRect().top;
  const firstRow = (Array.from(grid.children) as HTMLElement[]).slice(0, columns);
  return Math.max(0, ...firstRow.map((card) => card.getBoundingClientRect().bottom - top));
};

interface UpNextQueueProps {
  items: readonly UpNextItem[];
  onOpen: (item: UpNextItem) => void;
  onAdvance: (item: UpNextItem, action: OrderAction) => void;
  onPay: (item: UpNextItem) => void;
}

/**
 * The "Lo siguiente" queue, FOLDED to one row (owner, 2026-11-19).
 *
 * The API sends every order with something to do TODAY (overdue included, nothing after — tomorrow is
 * a count, `TomorrowSummary`), so a December day can bring a dozen. At rest the screen shows exactly ONE ROW of them — as many as fit
 * across, which is the grid's own decision (container queries) and is READ from the rendered grid
 * (`useGridColumns`), so a phone shows one, a laptop three, and a resize or the sidebar re-decides it
 * live. The rest wait behind "Ver N más", which unfolds them IN PLACE — it is not a link to the
 * agenda: the point is acting on today without leaving the front door.
 *
 * - **No toggle unless something is folded.** When the queue fits one row the control is not
 *   rendered at all; it eases in (`Collapse`) the moment a refetch or a narrower window folds a card.
 * - **The motion is the space.** Unfold: the grid eases open from the height it had and the revealed
 *   cards fade and rise in a beat behind it. Fold: they fade and tuck up first, then the grid eases
 *   shut underneath — so nothing below ever jumps (`unfoldGrid` / `foldGrid`). Either one reverses
 *   the other from the current frame; a fold that was reversed never commits (`run` token).
 * - **Two pieces of state, on purpose.** `expanded` is what the admin ASKED for — the label, the
 *   chevron and `aria-expanded` follow it at once. `unfolded` is whether the later cards are RENDERED;
 *   it lags a fold by its animation, because hiding the cards before the grid has eased shut would
 *   snap the box. Folded cards are `inert` from the moment a fold starts.
 */
const UpNextQueue: React.FC<UpNextQueueProps> = ({ items, onOpen, onAdvance, onPay }) => {
  const { t } = useTranslation();
  const gridId = useId();
  const { ref: gridRef, element: grid, columns } = useGridColumns<HTMLDivElement>();
  const [expanded, setExpanded] = useState(false);
  const [unfolded, setUnfolded] = useState(false);
  // Every press bumps the run; a fold resolving under a newer run was reversed and must not commit.
  const run = useRef(0);
  // An unfold requested by the press, played once the revealed cards are in the DOM.
  const unfoldRequest = useRef<{ grid: HTMLElement; fromHeight: number; fresh: boolean } | null>(
    null,
  );
  // The grid of a fold that committed: once its cards are hidden, the inline motion state goes.
  const settleGrid = useRef<HTMLElement | null>(null);

  const foldedCount = Math.max(0, items.length - columns);

  useLayoutEffect(() => {
    const request = unfoldRequest.current;
    if (request === null) return;
    unfoldRequest.current = null;
    unfoldGrid(request.grid, request.fromHeight, cardsAfterFirstRow(request.grid, columns), request);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on the press's commit only
  }, [expanded]);

  useLayoutEffect(() => {
    const folded = settleGrid.current;
    if (folded === null) return;
    settleGrid.current = null;
    settleFoldedGrid(folded, cardsAfterFirstRow(folded, columns));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on the fold's commit only
  }, [unfolded]);

  // The toggle only exists beside the rendered grid, whose ref is set at that same commit — so the
  // grid is always there to measure when it is pressed.
  const toggle = (box: HTMLElement): void => {
    run.current += 1;
    if (!expanded) {
      // Measured BEFORE the commit: the height the box has now (folded, or mid-fold), which is
      // where the unfold continues from.
      unfoldRequest.current = { grid: box, fromHeight: box.offsetHeight, fresh: !unfolded };
      setExpanded(true);
      setUnfolded(true);
      return;
    }
    const token = run.current;
    setExpanded(false);
    void foldGrid(box, firstRowHeight(box, columns), cardsAfterFirstRow(box, columns)).then(() => {
      if (run.current !== token) return;
      settleGrid.current = box;
      setUnfolded(false);
    });
  };

  return (
    <div className="flex flex-col gap-3">
      {/* The columns are a CONTAINER question (the section is the `@container`): the cards answer
          to the room the dashboard actually has, not to the window. */}
      <div
        ref={gridRef}
        id={gridId}
        className="grid gap-3 @min-[36rem]:grid-cols-2 @min-[56rem]:grid-cols-3 @min-[84rem]:grid-cols-4"
      >
        {items.map((item, index) => {
          const folded = index >= columns;
          return (
            <div
              key={`${item.id}-${item.event.kind}`}
              inert={folded && !expanded}
              className={`card-item ${folded && !unfolded ? 'hidden' : ''}`}
            >
              <UpNextCard
                item={item}
                rank={index}
                onOpen={onOpen}
                onAdvance={onAdvance}
                onPay={onPay}
              />
            </div>
          );
        })}
      </div>

      <Collapse open={foldedCount > 0} closedClassName="-mt-3">
        {foldedCount > 0 && (
          // `@container` so the side rules are a share of THIS row (`cqw`), not of the window. The
          // 2px of block padding keeps the focus ring inside `Collapse`'s overflow clip.
          <div className="@container flex justify-center py-0.5">
            <button
              type="button"
              aria-expanded={expanded}
              aria-controls={gridId}
              // Never null here: this button renders beside the grid, whose ref is set first.
              onClick={() => toggle(grid as HTMLDivElement)}
              // A quiet text control, not a chip: /60 ink (still AA on the panel's canvas) darkening
              // to full charcoal on hover, keyboard focus or press; 36px tall so it stays tappable.
              className="group/fold relative inline-flex h-9 cursor-pointer select-none items-center gap-1.5 whitespace-nowrap rounded-chip px-3 text-[13px] font-medium text-charcoal/60 outline-none transition-colors duration-200 hover:text-charcoal focus-visible:text-charcoal focus-visible:ring-2 focus-visible:ring-magenta active:text-charcoal motion-reduce:transition-none"
            >
              <span aria-hidden className={`${RULE} right-full origin-right`} />
              <MorphSwap swapKey={expanded ? 'less' : `more-${foldedCount}`}>
                {expanded ? t(`${KEY}.showLess`) : t(`${KEY}.showMore`, { count: foldedCount })}
              </MorphSwap>
              <HiOutlineChevronDown
                aria-hidden
                className={`size-3.5 shrink-0 transition-[rotate] duration-[400ms] ease-[var(--ease-settle)] motion-reduce:transition-none ${
                  expanded ? 'rotate-180' : ''
                }`}
              />
              <span aria-hidden className={`${RULE} left-full origin-left`} />
            </button>
          </div>
        )}
      </Collapse>
    </div>
  );
};

export default UpNextQueue;
