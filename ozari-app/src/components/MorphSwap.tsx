import { useLayoutEffect, useRef, useState } from 'react';
import { morphSwap } from '../modules/panel/pageMotion';

interface MorphSwapProps {
  /** Identity of the CONTENT. A change here is what triggers the morph; re-rendering the same key
   *  (a refetch handing back equal data) does nothing. */
  swapKey: string | number;
  children: React.ReactNode;
  className?: string;
  /**
   * Lay the swap out as a BLOCK that wraps, for prose rather than a chip.
   *
   * The default is a nowrap inline box because that is what a status chip or a button label needs —
   * but a sentence that rewrites itself ("Conecta tu cuenta…" → "Conectado como a@b.com") must keep
   * wrapping, and forcing it onto one line pushes it out of its column. The outgoing copy then needs
   * `w-full` so it wraps at exactly the same width it did in flow; without it the abandoned copy
   * shrink-wraps to its own text and visibly re-flows on its way out.
   *
   * Height is deliberately NOT animated here — a wrapping swap belongs inside a `useMorphOnChange`
   * region, which owns the height for everything in it, and two height tweens on nested elements
   * fight (the repo's layered-not-nested rule).
   */
  block?: boolean;
}

/**
 * Content that **adapts** instead of swapping: when `swapKey` changes, the box eases from the width
 * it had to the width the new content needs while the old and new cross-fade through each other.
 * Nothing ever blanks out, and no size ever jumps — the same read as a skeleton morphing into its
 * loaded content, applied to a label that changes in place.
 *
 * Used for the pieces of an agenda ticket that rewrite themselves as an order advances (the status
 * chip and the next-step button), where a plain React swap reads as a glitch: both change WORD and
 * WIDTH at once, mid-list.
 *
 * How it stays honest: the outgoing copy is rendered ABSOLUTELY (out of flow), so the box's natural
 * width is always the incoming content's — the morph target is therefore `auto`, never a measured
 * number that an interrupted animation could freeze at, and the STARTING width is simply the
 * outgoing copy's own (it is still on screen at its natural size when the morph begins). Under
 * reduced motion the morph resolves instantly and only the current content is ever painted.
 */
const MorphSwap: React.FC<MorphSwapProps> = ({ swapKey, children, className, block = false }) => {
  const container = useRef<HTMLSpanElement>(null);
  const incoming = useRef<HTMLSpanElement>(null);
  const outgoingElement = useRef<HTMLSpanElement>(null);

  // React's sanctioned "adjust state during render": the moment a new key arrives, the content
  // rendered under the PREVIOUS key is promoted to the outgoing layer, so both are painted in the
  // same commit — that overlap is what makes it a cross-fade rather than a swap. (Key and content
  // change together by contract, so the stored node is always the one currently on screen.)
  const [shown, setShown] = useState<{
    key: string | number;
    node: React.ReactNode;
    outgoing: React.ReactNode | null;
  }>({ key: swapKey, node: children, outgoing: null });

  if (shown.key !== swapKey) {
    setShown({ key: swapKey, node: children, outgoing: shown.node });
  }

  useLayoutEffect(() => {
    if (shown.outgoing === null) return;
    let live = true;
    void morphSwap({
      container: container.current,
      incoming: incoming.current,
      outgoing: outgoingElement.current,
    }).then(() => {
      if (live) setShown((current) => ({ ...current, outgoing: null }));
    });
    return () => {
      live = false;
    };
  }, [shown]);

  return (
    <span
      ref={container}
      className={`relative overflow-hidden ${
        block ? 'block' : 'inline-block whitespace-nowrap align-bottom'
      } ${className ?? ''}`}
    >
      <span ref={incoming} className="block">
        {children}
      </span>
      {shown.outgoing !== null && (
        <span
          ref={outgoingElement}
          aria-hidden
          className={`absolute left-0 top-0 block ${block ? 'w-full' : ''}`}
        >
          {shown.outgoing}
        </span>
      )}
    </span>
  );
};

export default MorphSwap;
