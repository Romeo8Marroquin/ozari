import { useLayoutEffect, useRef, useState } from 'react';
import { animateListReflow, animateTilesOut, captureGalleryLayout } from './pageMotion';

/** The captured layout `captureGalleryLayout` hands back — named from its own return type so this
 *  module never has to import GSAP just to describe an opaque value it only passes along. */
type CapturedLayout = ReturnType<typeof captureGalleryLayout>;

/** One action in the row. `key` is its IDENTITY — what makes it the same action across renders, and
 *  therefore what tells "this button changed its label" apart from "this button was replaced". */
export interface ActionRowItem {
  key: string;
  node: React.ReactNode;
}

/** The FLIP group. Scoped to this component so a row nested inside another morph region (the order
 *  detail's state card) cannot be picked up by the outer one. */
const ITEM = '.action-flip';

/** Are these the same keys, in the same order? Order matters: an action moving position is a layout
 *  change that should glide, exactly like one arriving. */
const sameKeys = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((key, index) => key === b[index]);

/**
 * A row of quick actions that ADAPTS when the set of actions changes, instead of popping.
 *
 * The problem it solves is specific and was visible on three screens at once. An order's actions are
 * derived from its state — "Marcar Entregado" comes from the lifecycle engine, "Abrir en mapas"
 * appears only while the next move is a trip, "Registrar pago" only while the money is out — so a
 * single tap can remove one button, add another, and re-align everything to the right. React does
 * all of that in ONE frame: the middle button vanishes and its neighbour teleports into the gap.
 *
 * **The sequence is: leave, THEN reflow.** Not both at once. The two are different statements — "this
 * action is gone" and "the row is now shorter" — and running them together produces a mush where the
 * eye cannot follow either. It is also the order the rest of the app already uses (the products grid
 * diff, and the deletion doctrine: never remove something before the change is real). Concretely:
 *
 * 1. Buttons whose key disappeared keep their space and fade out where they stand (`animateTilesOut`,
 *    the same removal language the photo gallery uses).
 * 2. The row's boxes are captured, the new set commits, and the survivors GLIDE from their old
 *    positions into the space that just opened while arrivals rise in (`animateListReflow`).
 *
 * Nothing here knows what an action IS. It takes rendered nodes with stable keys, which is what lets
 * the agenda ticket, the dashboard's up-next card and the order detail share one behaviour rather
 * than three near-copies that drift.
 *
 * Under reduced motion every step resolves instantly, so the row simply swaps — as everywhere else.
 */
const ActionRow: React.FC<{
  items: ActionRowItem[];
  /** The row's own layout classes — it IS the flex container, so a caller never wraps it in one. */
  className?: string;
}> = ({ items, className = '' }) => {
  const root = useRef<HTMLDivElement>(null);
  /**
   * The list this row has COMMITTED to, which lags `items` while something is leaving — and which
   * is therefore also where a departing action's last node is kept, so it can still be drawn after
   * its source item is gone. Deliberately state rather than a ref: what is on screen is rendering
   * data, and a ref read during render is both a lint error here and a genuine staleness hazard.
   */
  const [rendered, setRendered] = useState<ActionRowItem[]>(items);
  /** The boxes captured just before a commit, consumed by the reflow on the very next one. */
  const captured = useRef<CapturedLayout>(null);
  /** Which leave is in flight — a second change mid-exit must not let the first one commit a set
   *  that is already out of date (the panel's "latest intent wins" rule, in miniature). */
  const run = useRef(0);

  const structural = !sameKeys(
    items.map((item) => item.key),
    rendered.map((item) => item.key),
  );
  // Nothing structural changed, so there is nothing to choreograph: adopt the caller's fresh items
  // straight away, which keeps a departing action's stored copy from ever being an old one. Adjusted
  // DURING RENDER (the repo's pattern, as in `OrderPaymentModal`) rather than in an effect: an
  // effect would commit the stale list for a frame first, and it converges immediately because the
  // next render finds `rendered` already identical to `items`.
  if (!structural && items !== rendered) {
    setRendered(items);
  }

  useLayoutEffect(() => {
    if (!structural) {
      // The commit a leave was waiting for: everything is in its new place, so glide the survivors
      // from where they were. `captured` is null on an ordinary re-render, which is a no-op.
      if (captured.current) {
        animateListReflow(root.current, ITEM, captured.current);
        captured.current = null;
      }
      return;
    }

    const token = (run.current += 1);
    const commit = (): void => {
      if (run.current !== token) return;
      captured.current = captureGalleryLayout(root.current, ITEM);
      setRendered(items);
    };

    // Phase 1: whatever is leaving fades where it stands, still occupying its space — so nothing
    // moves until the row is genuinely shorter. With nothing to remove the promise is already
    // resolved, so the commit still lands in the same frame, before paint.
    const next = items.map((item) => item.key);
    const leaving = rendered
      .map((item) => item.key)
      .filter((key) => !next.includes(key))
      .map((key) => root.current?.querySelector<HTMLElement>(`[data-flip-id="${key}"]`))
      .filter((element): element is HTMLElement => element !== null && element !== undefined);
    void animateTilesOut(leaving).then(commit);
  }, [items, rendered, structural]);

  if (rendered.length === 0) {
    return null;
  }

  return (
    <div ref={root} className={className}>
      {rendered.map((entry) => (
        // The wrapper carries the identity, so the action itself stays an ordinary `Button` — the
        // row's choreography is never something a caller has to remember to opt into.
        <span key={entry.key} data-flip-id={entry.key} className={`${ITEM.slice(1)} inline-flex`}>
          {/* A SURVIVOR renders the caller's newest node, so a label that morphs mid-transition
              (Marcar En ruta → Marcar Entregado) is never a frame behind the status chip beside it.
              Only what is on its way OUT falls back to the copy this row committed. */}
          {items.find((item) => item.key === entry.key)?.node ?? entry.node}
        </span>
      ))}
    </div>
  );
};

export default ActionRow;
