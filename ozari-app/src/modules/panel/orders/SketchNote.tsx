import { useTranslation } from 'react-i18next';
import MorphSwap from '@components/MorphSwap';
import useMorphOnChange from '../useMorphOnChange';

interface SketchNoteProps {
  /** The cap hint (`sketchCapHint`), or `null` when there is nothing to say about the quantity. */
  hint: { text: string; warn: boolean } | null;
  /** The line is GENERIC on a product with variations — the variation is chosen in the form. */
  needsVariant: boolean;
  /** The space above the note, INSIDE it — so an empty note takes none (a parent `gap` would). */
  spacing?: string;
}

/**
 * The quiet lines under a cart control ("Máx. 4 para las fechas del pedido", "Elegirás la variación
 * en el pedido."). They change under the admin's hands — a press on + reaching the cap, the cart's
 * dates answering, a pick naming a variation — so they never repaint:
 *
 * - the WHOLE note is one `MorphSwap` keyed on what it says, so a change cross-fades (old out, new
 *   in) and an appearing or vanishing note is the same cross-fade from or to nothing;
 * - it sits in a `useMorphOnChange` region, which eases the height from what it was to what the new
 *   text needs — a hint that wraps onto a second line, or a note that leaves, glides instead of
 *   shoving what is below. ONE height owner (the region; `MorphSwap` only fades), so nothing fights.
 *
 * The warning tone is part of the key, so amber arrives with its own words rather than recolouring
 * the old ones.
 */
const SketchNote: React.FC<SketchNoteProps> = ({ hint, needsVariant, spacing = 'pt-2' }) => {
  const { t } = useTranslation();
  const key = `${hint?.warn ? '!' : ''}${hint?.text ?? ''}|${needsVariant ? 'v' : ''}`;
  const region = useMorphOnChange<HTMLDivElement>(key);
  const empty = hint === null && !needsVariant;

  return (
    <div ref={region} className="min-w-0">
      <MorphSwap swapKey={key} block>
        {empty ? null : (
          <span className={`flex flex-col gap-0.5 text-xs leading-snug ${spacing}`}>
            {hint && <span className={hint.warn ? 'text-amber-700' : 'text-charcoal/55'}>{hint.text}</span>}
            {needsVariant && (
              <span className="text-charcoal/55">{t('modules.panel.orderSketch.variantLater')}</span>
            )}
          </span>
        )}
      </MorphSwap>
    </div>
  );
};

export default SketchNote;
