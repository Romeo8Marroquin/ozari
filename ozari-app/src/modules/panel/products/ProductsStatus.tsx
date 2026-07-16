import type { ReactNode } from 'react';
import { HiOutlineExclamationTriangle, HiOutlineSquares2X2 } from 'react-icons/hi2';

/**
 * The catalog's non-grid states — an **empty** catalog or a **cold error** — as one calm, centered
 * panel so the two read as the same family (never a raw error dump, never a frozen skeleton). `empty`
 * is neutral and on-brand (the cream→blossom mark); `error` is an amber attention cue. An optional
 * `action` slot carries whatever the caller needs (a retry button on error, an admin "add" CTA on an
 * empty catalog). Entrance/exit is owned by the page: each inner element is a `.reveal-item`, so the
 * page's staggered reveal cascades them (mark → title → description → CTA) for a gentle, deliberate
 * entrance rather than one popped block. The outer div is only the centerer, not an animation target.
 */
const ProductsStatus: React.FC<{
  tone: 'empty' | 'error';
  title: string;
  description: string;
  action?: ReactNode;
}> = ({ tone, title, description, action }) => (
  // `flex-1` fills the panel body's full height so the panel true-centers in the available area; the
  // small bottom padding is an upward optical bias (dead-center reads a touch low on tall screens).
  <div className="flex flex-1 items-center justify-center pb-[6vh]">
    <div className="flex max-w-md flex-col items-center text-center">
      {tone === 'error' ? (
        <span aria-hidden className="reveal-item grid size-16 place-items-center rounded-2xl bg-amber-50 text-amber-500">
          <HiOutlineExclamationTriangle className="size-7" />
        </span>
      ) : (
        <span
          aria-hidden
          className="reveal-item grid size-16 place-items-center rounded-2xl bg-gradient-to-br from-cream to-blossom text-charcoal/70 shadow-sm"
        >
          <HiOutlineSquares2X2 className="size-7" />
        </span>
      )}
      <h2 className="reveal-item mt-5 text-xl font-bold text-charcoal sm:text-2xl">{title}</h2>
      <p className="reveal-item mt-2 text-sm leading-relaxed text-charcoal/55">{description}</p>
      {action && <div className="reveal-item mt-5">{action}</div>}
    </div>
  </div>
);

export default ProductsStatus;
