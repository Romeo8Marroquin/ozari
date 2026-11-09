import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { HiOutlineCalendarDays } from 'react-icons/hi2';
import MorphSwap from '@components/MorphSwap';
import { formatDateTime } from './orderDayGroups';

const KEY = 'modules.panel.orderSketch.window';

interface SketchWindowNoteProps {
  /** The sketch's window (`useSketchAvailability().window`); `null` = undated → the note folds away. */
  window: { deliveryAt: Date; pickupAt: Date | null } | null;
  /** Classes for the visible chip (its spacing lives INSIDE the fold, so a closed note takes none). */
  className?: string;
}

/**
 * "The figures on this screen are for THOSE dates": once the order sketch (the admin's cart) has a
 * delivery date, every stock figure on the grid and the detail page speaks for its window rather
 * than for today — a quiet chip says so, with the dates, so a "0 de 10" is never mistaken for an
 * empty warehouse. Always mounted in a `grid-rows 0fr↔1fr` fold (the `FormError` trick): dating the
 * sketch eases it open, clearing the dates eases it shut, and the last dates stay painted meanwhile.
 */
const SketchWindowNote: React.FC<SketchWindowNoteProps> = ({ window: span, className = '' }) => {
  const { t } = useTranslation();
  const text = span
    ? span.pickupAt
      ? t(`${KEY}.range`, {
          from: formatDateTime(span.deliveryAt.toISOString()),
          to: formatDateTime(span.pickupAt.toISOString()),
        })
      : t(`${KEY}.from`, { from: formatDateTime(span.deliveryAt.toISOString()) })
    : null;
  // The last dates stay painted while the note folds away ("adjust state during render").
  const [painted, setPainted] = useState(text);
  if (text !== null && text !== painted) setPainted(text);
  const open = text !== null;

  return (
    <div
      aria-hidden={!open}
      className={`grid transition-[grid-template-rows,opacity] duration-300 ease-[var(--ease-settle)] motion-reduce:transition-none ${
        open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
      }`}
    >
      <div className="min-w-0 overflow-hidden">
        <p
          className={`flex w-fit max-w-full flex-wrap items-center gap-x-1.5 gap-y-0.5 rounded-chip bg-magenta/[0.07] px-2.5 py-1 text-xs text-charcoal/75 ${className}`}
        >
          <HiOutlineCalendarDays aria-hidden className="size-3.5 shrink-0 text-magenta" />
          <span>{t(`${KEY}.label`)}:</span>
          {/* New dates cross-fade in with a width morph — the chip adapts, it never repaints. */}
          <MorphSwap swapKey={painted ?? ''} className="max-w-full font-semibold text-charcoal">
            {painted}
          </MorphSwap>
        </p>
      </div>
    </div>
  );
};

export default SketchWindowNote;
