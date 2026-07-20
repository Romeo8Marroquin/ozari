import type { ReactNode } from 'react';
import {
  HiOutlineAdjustmentsHorizontal,
  HiOutlineExclamationTriangle,
  HiOutlineSquares2X2,
} from 'react-icons/hi2';

type StatusTone = 'empty' | 'error' | 'config';

/** The icon + tint per tone: `empty` is neutral on-brand, `error` an amber attention cue, `config`
 *  an informational blue (a "this needs setup" state — distinct from a failure to retry). */
const TONE: Record<StatusTone, { Icon: typeof HiOutlineSquares2X2; badge: string }> = {
  empty: {
    Icon: HiOutlineSquares2X2,
    badge: 'bg-gradient-to-br from-cream to-blossom text-charcoal/70 shadow-sm',
  },
  error: { Icon: HiOutlineExclamationTriangle, badge: 'bg-amber-50 text-amber-500' },
  config: { Icon: HiOutlineAdjustmentsHorizontal, badge: 'bg-sky-50 text-sky-500' },
};

/**
 * A calm, centered panel for a page/form's non-content states — an **empty** collection, a real
 * **error**, or a **config** state where required reference/preference data is missing (a "set this
 * up" nudge, NOT a failure to retry). The three read as one family so the transitions between them
 * feel consistent (never a raw error dump, never a frozen skeleton). An optional `action` slot
 * carries whatever the caller needs (a retry button on error, a "go to preferences" CTA on config,
 * a "create" CTA on empty). Entrance/exit is owned by the page: each inner element is a
 * `.reveal-item`, so the page's staggered reveal cascades them (icon → title → description → CTA).
 */
const ProductsStatus: React.FC<{
  tone: StatusTone;
  title: string;
  description: string;
  action?: ReactNode;
}> = ({ tone, title, description, action }) => {
  const { Icon, badge } = TONE[tone];
  return (
    // `flex-1` fills the panel body's full height so the panel true-centers; the small bottom
    // padding is an upward optical bias (dead-center reads a touch low on tall screens).
    <div className="flex flex-1 items-center justify-center pb-[6vh]">
      <div className="flex max-w-md flex-col items-center text-center">
        <span aria-hidden className={`reveal-item grid size-16 place-items-center rounded-2xl ${badge}`}>
          <Icon className="size-7" />
        </span>
        <h2 className="reveal-item mt-5 text-xl font-bold text-charcoal sm:text-2xl">{title}</h2>
        <p className="reveal-item mt-2 text-sm leading-relaxed text-charcoal/55">{description}</p>
        {action && <div className="reveal-item mt-5">{action}</div>}
      </div>
    </div>
  );
};

export default ProductsStatus;
