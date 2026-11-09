import gsap from 'gsap';
import { useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { HiOutlineShoppingCart } from 'react-icons/hi2';
import MorphSwap from '@components/MorphSwap';
import { prefersReducedMotion } from '@utils/motion';
import { usePanelNavigate } from '../PanelNavContext';
import { sketchCount, useOrderSketch } from './orderSketch';

const KEY = 'modules.panel.orderSketch';
const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-magenta focus-visible:ring-offset-2 focus-visible:ring-offset-white';

/**
 * The header's cart (Admin): the order SKETCH, counted. It opens `/panel/pedidos/nuevo`, where the
 * form restores the sketch — the cart and the form are the same object (`orderSketch.ts`).
 *
 * Motion, split by the doctrine's division rule: the BADGE's appearance is binary state, so CSS owns
 * it (scale + opacity, and it keeps the last number painted while it fades away — an emptied cart
 * never flashes a "0"); a changing number cross-fades in place (`MorphSwap`); and a line ADDED gives
 * the cart icon a small hop — choreography, so GSAP, on the icon (never on the badge's own scale).
 */
const OrderSketchButton: React.FC = () => {
  const { t } = useTranslation();
  const panelNavigate = usePanelNavigate();
  const count = sketchCount(useOrderSketch());
  const icon = useRef<HTMLSpanElement>(null);

  // The number the badge paints: the live count, or the last one while it fades out.
  const [painted, setPainted] = useState(count);
  if (count > 0 && count !== painted) setPainted(count);

  const previous = useRef(count);
  useLayoutEffect(() => {
    const grew = count > previous.current;
    previous.current = count;
    if (!grew || prefersReducedMotion()) return;
    gsap.fromTo(
      icon.current,
      { y: 0, rotate: 0 },
      {
        keyframes: [
          { y: -4, rotate: -8, duration: 0.14, ease: 'power2.out' },
          { y: 0, rotate: 0, duration: 0.42, ease: 'bounce.out' },
        ],
        overwrite: true,
      },
    );
  }, [count]);

  return (
    <button
      type="button"
      onClick={() => panelNavigate('/panel/pedidos/nuevo')}
      aria-label={count > 0 ? t(`${KEY}.buttonCount`, { count }) : t(`${KEY}.buttonEmpty`)}
      title={t(`${KEY}.button`)}
      className={`relative grid size-10 cursor-pointer place-items-center rounded-xl text-charcoal/70 transition-[color,background-color,box-shadow] duration-200 hover:bg-charcoal/[0.05] hover:text-charcoal ${FOCUS_RING}`}
    >
      <span ref={icon} aria-hidden className="grid">
        <HiOutlineShoppingCart className="size-6" />
      </span>
      <span
        aria-hidden
        data-sketch-badge
        className={`pointer-events-none absolute -right-0.5 -top-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-magenta px-1 text-[11px] font-bold leading-none text-white tabular-nums ring-2 ring-white transition-[opacity,scale] duration-300 ease-[var(--ease-settle)] motion-reduce:transition-none ${
          count > 0 ? 'scale-100 opacity-100' : 'scale-50 opacity-0'
        }`}
      >
        <MorphSwap swapKey={painted}>{painted}</MorphSwap>
      </span>
    </button>
  );
};

export default OrderSketchButton;
