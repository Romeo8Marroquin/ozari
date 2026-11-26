import { useTranslation } from 'react-i18next';
import MorphSwap from '@components/MorphSwap';
import { SEGMENT_MOTION, SEGMENT_STAGGER_MS, SEGMENT_TRACK, useRetainedTotal } from './orderProgress';
import { statusFill } from './statusTone';
import type { OrderProgress } from './order.types';

const KEY = 'modules.panel.orders.detail.progress';

/** The label's emphasis moves as the order advances — colour and weight interpolate on the SAME
 *  element (the ticket's `EMPHASIS_MOTION` stance), so "current" travels instead of jumping. */
const LABEL_MOTION =
  'transition-[color,font-weight] duration-300 ease-[var(--ease-settle)] motion-reduce:transition-none';

/**
 * The order DETAIL's progress — the same concept as the cards' left rail (one segment per step of
 * the order's own pipeline, filled in the current status' colour, travelling with a stagger), laid
 * out HORIZONTALLY and NAMED, because the detail is where an order is read rather than scanned.
 *
 * - **Position from the API, names from the catalog.** `progress` (step/total) is the server's count
 *   — the same field the cards draw, so the three screens can never disagree. The names come from
 *   the catalog's mode-aware pipeline (`applicableSteps`), and are used ONLY when that list has the
 *   same length as the server's count; otherwise each step is labelled "Paso N" rather than risking a
 *   name on the wrong segment.
 * - **Responsive by its own box** (`@container`, never the window — the detail column sits beside a
 *   sidebar): wide enough, every step shows its name under its segment; narrower, the names stay for
 *   screen readers and one caption ("Paso 3 de 5") speaks for the bar.
 * - **Cancelled** (no `progress`): the segments stay and DRAIN (`useRetainedTotal`), the caption
 *   says the order left the process — the chip and the state line carry the reason.
 * - **Semantics:** a real `<ol>` with `aria-current="step"` on the current step — a list a screen
 *   reader can walk, not a decorative bar.
 */
const OrderProgressStepper: React.FC<{
  progress?: OrderProgress;
  colorKey?: string;
  /** The order's applicable pipeline, in order (catalog names); may be empty while it loads. */
  stepNames: readonly string[];
}> = ({ progress, colorKey, stepNames }) => {
  const { t } = useTranslation();
  const total = useRetainedTotal(progress) ?? stepNames.length;
  if (total === 0) return null;

  const reached = progress?.step ?? 0;
  const named = stepNames.length === total;
  const fill = statusFill(colorKey);
  const nameOf = (index: number): string =>
    named ? stepNames[index] : t(`${KEY}.step`, { step: index + 1 });

  return (
    <div className="@container" data-testid="order-progress-stepper">
      <ol
        aria-label={t(`${KEY}.aria`)}
        className="grid gap-1.5"
        style={{ gridTemplateColumns: `repeat(${total}, minmax(0, 1fr))` }}
      >
        {Array.from({ length: total }, (_, index) => {
          const done = index < reached;
          const current = index === reached - 1;
          return (
            <li
              // A segment IS its position on the pipeline — the index is its identity here.
              key={index}
              aria-current={current ? 'step' : undefined}
              data-filled={done}
              className="flex min-w-0 flex-col gap-1.5"
            >
              <span
                aria-hidden
                className={`h-1.5 rounded-full ${SEGMENT_MOTION} ${done ? fill : SEGMENT_TRACK}`}
                style={{ transitionDelay: `${index * SEGMENT_STAGGER_MS}ms` }}
              />
              <span
                title={nameOf(index)}
                className={`sr-only truncate text-[10px] uppercase tracking-wide @min-[28rem]:not-sr-only ${LABEL_MOTION} ${
                  current
                    ? 'font-semibold text-charcoal'
                    : done
                      ? 'font-medium text-charcoal/55'
                      : 'font-medium text-charcoal/35'
                }`}
              >
                {nameOf(index)}
              </span>
            </li>
          );
        })}
      </ol>
      {/* The narrow box's one caption — the `<ol>` above already says all of it to assistive tech,
          so this is visual only. It cross-fades (and morphs its width) as the step changes. */}
      <p aria-hidden className="mt-1.5 text-[11px] font-medium text-charcoal/50 @min-[28rem]:hidden">
        <MorphSwap swapKey={progress ? progress.step : 'outside'}>
          {progress
            ? t(`${KEY}.caption`, { step: progress.step, total: progress.total })
            : t(`${KEY}.outside`)}
        </MorphSwap>
      </p>
    </div>
  );
};

export default OrderProgressStepper;
