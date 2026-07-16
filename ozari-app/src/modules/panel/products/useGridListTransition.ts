import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { animateListReflow, animateTilesOut, captureGalleryLayout } from '../pageMotion';
import type { Product } from './product.types';

/** The FLIP wrapper selector — each rendered card carries `data-flip-id={product.id}`. */
const CARD_SELECTOR = '[data-flip-id]';

const idsOf = (list: Product[]): number[] => list.map((product) => product.id);
const sameIds = (a: number[], b: number[]): boolean =>
  a.length === b.length && a.every((id, index) => id === b[index]);
/** `a` is a strict prefix of `b` — the infinite scroll APPENDED a page (its own machinery owns it). */
const isPrefix = (a: number[], b: number[]): boolean =>
  a.length < b.length && a.every((id, index) => id === b[index]);

/**
 * Smooths a **background-refetch list change** on the (cache-warm) product grid — the moment a
 * deletion/creation lands over an already-rendered list, which used to swap every index-keyed slot
 * abruptly. Two phases, the gallery's removal language at grid scale:
 *
 *  1. cards whose ids VANISHED shrink-fade out in place (`animateTilesOut`) while the old list is
 *     still rendered;
 *  2. the new list commits and the survivors GLIDE to their new cells (matched across DOM nodes by
 *     `data-flip-id`) while new ids fade-rise in (`animateListReflow`).
 *
 * The page renders from the returned `displayed` list, which lags `products` only for the ~0.25s
 * of phase 1. Every OTHER list transition keeps its existing owner and syncs instantly (via the
 * sanctioned adjust-during-render pattern): cold loads / filter changes (the skeleton hand-off),
 * infinite-scroll appends (old ids a strict prefix of the new — the append-slot crossfade), and
 * anything while `animate` is false. In-place field updates (same ids — an edit) also swap
 * directly: the card re-renders its own content, nothing moves.
 */
export function useGridListTransition(
  products: Product[],
  animate: boolean,
  scopeRef: React.RefObject<HTMLElement | null>,
): Product[] {
  const [displayed, setDisplayed] = useState(products);
  // The generation token: any newer change abandons an in-flight phase 1 (latest intent wins).
  const generation = useRef(0);
  const pendingFlip = useRef<ReturnType<typeof captureGalleryLayout>>(null);

  const displayedIds = idsOf(displayed);
  const incomingIds = idsOf(products);
  const orderChanged = !sameIds(displayedIds, incomingIds);
  const animatable = animate && orderChanged && !isPrefix(displayedIds, incomingIds);

  // Non-animated changes (appends, filter/cold flows, same-id field updates) sync during render —
  // the existing machineries expect the list to be current at commit time. (No ref writes here —
  // superseding an in-flight phase 1 is the effect's job below.)
  if (products !== displayed && !animatable) {
    setDisplayed(products);
  }

  useEffect(() => {
    // EVERY id-sequence change advances the generation — including ones the render synced
    // directly — so an in-flight phase 1 from an older change always finds itself superseded.
    generation.current += 1;
    if (!animatable) return;
    const token = generation.current;
    const scope = scopeRef.current;
    const removedEls = displayedIds
      .filter((id) => !incomingIds.includes(id))
      .flatMap((id) => {
        const el = scope?.querySelector<HTMLElement>(`[data-flip-id="${id}"]`);
        return el ? [el] : [];
      });
    void animateTilesOut(removedEls).then(() => {
      if (generation.current !== token) return; // superseded by a newer change
      pendingFlip.current = captureGalleryLayout(scope, CARD_SELECTOR);
      setDisplayed(products);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by the id sequence on purpose
  }, [animatable, incomingIds.join('|')]);

  // Phase 2, before paint: survivors glide from the captured boxes; fresh ids fade in.
  useLayoutEffect(() => {
    const state = pendingFlip.current;
    pendingFlip.current = null;
    if (!state) return;
    animateListReflow(scopeRef.current, CARD_SELECTOR, state);
  }, [displayed, scopeRef]);

  return displayed;
}
