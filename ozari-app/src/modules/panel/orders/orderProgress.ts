import { useState } from 'react';
import type { OrderProgress } from './order.types';

/**
 * What the two progress surfaces share — the cards' vertical rail (`OrderCardRails`) and the
 * detail's labelled stepper (`OrderProgressStepper`) — so they read as ONE concept and move at the
 * same pace. Both draw the API's `progress` (never a client-side step count) in the current status'
 * colour (`statusFill`).
 */

/** How far each segment's recolour trails the one before it — so a step forward reads as the colour
 *  TRAVELLING along the bar, not as every segment flipping in one frame. */
export const SEGMENT_STAGGER_MS = 60;

/** Colour is a binary state per segment → a CSS transition (GSAP owns choreography only), on the
 *  app's settle curve, off under reduced motion. */
export const SEGMENT_MOTION =
  'transition-[background-color] duration-300 ease-[var(--ease-settle)] motion-reduce:transition-none';

/** The empty segment — the track the fill travels along. */
export const SEGMENT_TRACK = 'bg-charcoal/[0.07]';

/**
 * The segment COUNT to draw, held across the moments the API sends no `progress` — so cancelling an
 * order DRAINS the bar it had (the fill fades out segment by segment) instead of the segments
 * collapsing into one in a single frame. Live data always wins; the retained count is only the
 * memory of the last real one. (`useState` adjusted during render — React's documented "store
 * information from previous renders" pattern: no effect, no extra paint.)
 */
export function useRetainedTotal(progress?: OrderProgress): number | undefined {
  const [retained, setRetained] = useState(progress?.total);
  if (progress !== undefined && progress.total !== retained) {
    setRetained(progress.total);
  }
  return progress?.total ?? retained;
}
