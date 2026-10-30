import { useState } from 'react';
import { prefersReducedMotion } from '@utils/motion';

interface CollapseProps {
  /** Shown (eased open) or hidden (eased shut). */
  open: boolean;
  /**
   * The content. Pass it only while open (`{open && …}`) and the LAST open content stays painted
   * through the closing ease — a note never blanks out mid-collapse — then unmounts. Content passed
   * while closed renders live and stays mounted (a block that keeps state, like a photo set).
   */
  children?: React.ReactNode;
  className?: string;
  /**
   * Inside a `gap-*` column a folded block still owns the gap before it. Pass the matching negative
   * top margin (`-mt-3` in a `gap-3` column) and the closed block swallows it — eased on the same
   * transition, so the column closes up exactly as far as the block took.
   */
  closedClassName?: string;
}

/**
 * A block that APPEARS and DISAPPEARS in flow without a jump — the app's binary show/hide motion as
 * one primitive (the recipe `FormError` and the order form's line note use): the row's height eases
 * through a `grid-template-rows` 0fr ↔ 1fr transition while the content fades, so whatever sits below
 * glides instead of snapping. Binary UI state, so CSS owns it (the motion division rule) — it
 * retargets natively when toggled mid-flight, and `motion-reduce` makes it instant.
 *
 * Closed content is `inert` + `aria-hidden`: nothing inside can be focused or read while it is
 * folded away.
 */
const Collapse: React.FC<CollapseProps> = ({ open, children, className, closedClassName }) => {
  // React's "adjust state during render": remember the latest OPEN content, so closing can keep
  // painting it. Loop-free — after the update the same `children` object compares equal.
  const [shown, setShown] = useState<React.ReactNode>(open ? children : null);
  if (open && children !== shown) setShown(children);
  const hasContent = children !== null && children !== undefined && children !== false;
  // The frozen copy lives only for the closing ease — with motion reduced there is none to wait for.
  const content = hasContent || open ? children : prefersReducedMotion() ? null : shown;

  return (
    <div
      aria-hidden={!open}
      inert={!open}
      onTransitionEnd={(event) => {
        if (open || event.target !== event.currentTarget || event.propertyName !== 'opacity') return;
        setShown(null);
      }}
      className={`grid transition-[grid-template-rows,opacity,margin] duration-300 ease-[var(--ease-settle)] motion-reduce:transition-none ${
        open ? 'grid-rows-[1fr] opacity-100' : `grid-rows-[0fr] opacity-0 ${closedClassName ?? ''}`
      } ${className ?? ''}`}
    >
      <div className="min-h-0 overflow-hidden">{content}</div>
    </div>
  );
};

export default Collapse;
