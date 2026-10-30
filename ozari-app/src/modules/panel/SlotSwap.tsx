import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { prefersReducedMotion } from '@utils/motion';
import { animateHeightFrom, editorSlotIn, editorSlotOut } from './pageMotion';

interface SlotSwapProps {
  /** What the slot holds. A NEW key swaps the content; the same key renders the children live. */
  swapKey: string;
  children: React.ReactNode;
  /** The box's classes (it is the grid/flex item; the content moves inside it). */
  className?: string;
}

/**
 * One SLOT whose content is REPLACED by something else — the product form's stock field giving way
 * to "managed per variation" when the first option arrives, and coming back when the last leaves.
 * The editor-slot vocabulary, sequenced: the outgoing content leaves (`editorSlotOut`, 0.22s to the
 * right), the swap commits, and the box eases from the height it had to the new content's
 * (`animateHeightFrom`, 0.35s `power3.out`) while the incoming content slides in (`editorSlotIn`,
 * 0.35s from the left) — so what sits below glides with it.
 *
 * Interruptible: a key that flips back while the old content is leaving brings that content back
 * from where it stands (nothing commits); a third key retargets the same exit. The outgoing content
 * is `inert` while it leaves. Reduced motion swaps at once.
 */
const SlotSwap: React.FC<SlotSwapProps> = ({ swapKey, children, className }) => {
  const [shown, setShown] = useState({ key: swapKey, children });
  const box = useRef<HTMLDivElement>(null);
  const slot = useRef<HTMLDivElement>(null);
  const latestChildren = useRef(children);
  const leavingPlays = useRef(false);
  const fromHeight = useRef<number | null>(null);
  const swapping = shown.key !== swapKey;

  // React's "adjust state during render": the frozen copy follows the live content while the key
  // holds (so a swap freezes what was last on screen); with motion reduced a new key lands at once.
  if (!swapping && shown.children !== children) setShown({ key: swapKey, children });
  else if (swapping && prefersReducedMotion()) setShown({ key: swapKey, children });

  useLayoutEffect(() => {
    latestChildren.current = children;
  });

  useEffect(() => {
    if (!swapping) {
      // The key came back mid-exit: the content it was taking away returns instead.
      if (leavingPlays.current) {
        leavingPlays.current = false;
        editorSlotIn(slot.current);
      }
      return;
    }
    let live = true;
    leavingPlays.current = true;
    void editorSlotOut(slot.current).then(() => {
      if (!live) return;
      leavingPlays.current = false;
      /* v8 ignore next -- the box is mounted for as long as this effect is */
      fromHeight.current = box.current?.offsetHeight ?? null;
      setShown({ key: swapKey, children: latestChildren.current });
    });
    return () => {
      live = false;
    };
  }, [swapping, swapKey]);

  useLayoutEffect(() => {
    const from = fromHeight.current;
    if (from === null) return;
    fromHeight.current = null;
    animateHeightFrom(box.current, from);
    editorSlotIn(slot.current);
  }, [shown.key]);

  return (
    <div ref={box} className={className}>
      <div ref={slot} inert={swapping}>
        {swapping ? shown.children : children}
      </div>
    </div>
  );
};

export default SlotSwap;
