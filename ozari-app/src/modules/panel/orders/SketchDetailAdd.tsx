import { useTranslation } from 'react-i18next';
import { HiArrowRight, HiOutlineShoppingCart } from 'react-icons/hi2';
import Button from '@components/Button';
import QuantityStepper from '@components/QuantityStepper';
import { usePanelNavigate } from '../PanelNavContext';
import SlotSwap from '../SlotSwap';
import type { Product, ProductVariant } from '../products/product.types';
import { hasVariants } from '../products/productVariations';
import {
  addToSketch,
  findSketchLine,
  genericTarget,
  lineQuantity,
  setSketchQuantity,
  sketchLineCap,
  sketchWindow,
  useOrderSketch,
} from './orderSketch';
import { sketchCapHint } from './sketchCopy';
import SketchNote from './SketchNote';

const KEY = 'modules.panel.orderSketch';
const SECONDARY_COLOR = '#262626';
/** The probe already answered for the windowed product (`withWindowStock`), so the cap reads it. */
const NO_PROBE = new Map<string, number | null>();

interface SketchDetailAddProps {
  /** The product, WINDOWED (`withWindowStock`) — its figures are the sketch's dates'. */
  product: Product;
  /** The visitor's picks, option order (`null` = not picked). */
  picks: readonly (number | null)[];
  /** The variation the picks name, once every option is picked and the combination is offered. */
  variant: ProductVariant | undefined;
}

/**
 * The detail page's cart control (Admin). It speaks for EXACTLY what the page shows:
 *
 * - the picked VARIATION once every option is chosen — its own line in the sketch;
 * - the product itself before that (or a product without variations) — the GENERIC line, carrying
 *   whatever picks were made so the form starts from them; the variation is then chosen in the form,
 *   as the hint says. That is the "add it now, decide the colour later" path.
 *
 * Out of the sketch it is one button ("Agregar al pedido"), disabled when the combination is not
 * offered or nothing is takeable; in the sketch it becomes the quantity stepper + "Ver pedido". The
 * two trade places through a `SlotSwap` (the outgoing slides away, the box eases to the new height,
 * the incoming slides in), so switching the picks between a variation that is in the cart and one
 * that is not glides rather than jumps.
 */
const SketchDetailAdd: React.FC<SketchDetailAddProps> = ({ product, picks, variant }) => {
  const { t } = useTranslation();
  const panelNavigate = usePanelNavigate();
  const sketch = useOrderSketch();

  const withVariants = hasVariants(product);
  const allPicked = withVariants && picks.length > 0 && picks.every((pick) => pick !== null);
  const notOffered = allPicked && variant === undefined;
  const generic = genericTarget(product);
  const target = variant
    ? { variantId: variant.id, pickedValues: [...picks] }
    : generic.variantId !== null
      ? generic
      : { variantId: null, pickedValues: [...picks] };
  const line = findSketchLine(sketch, product.id, target.variantId);
  const quantity = lineQuantity(line);
  const cap = sketchLineCap(product, target.variantId, sketch?.lines ?? [], NO_PROBE);
  const hint = sketchCapHint(t, cap, sketchWindow(sketch) !== null, quantity);
  const needsVariant = withVariants && target.variantId === null;
  // A combination nobody offers already says so in the pick note above (amber); the button only
  // goes quiet. Nothing takeable is said by the cap hint below it.
  const blocked = notOffered || cap === 0;
  // Its spacing lives INSIDE the note, so a silent one takes no room; changes cross-fade and glide.
  const note = <SketchNote hint={notOffered ? null : hint} needsVariant={needsVariant} />;

  return (
    <SlotSwap swapKey={line ? 'held' : 'add'} className="min-w-0">
      {line ? (
        <div className="flex flex-col">
          <span className="text-xs font-semibold uppercase tracking-wide text-magenta">{t(`${KEY}.inSketch`)}</span>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <QuantityStepper
              value={quantity}
              max={cap}
              label={t(`${KEY}.quantity`, { name: product.name })}
              onChange={(next) => setSketchQuantity(product.id, target.variantId, next)}
            />
            <Button
              variant="soft"
              color={SECONDARY_COLOR}
              size="sm"
              endIcon={<HiArrowRight className="size-4" />}
              onClick={() => panelNavigate('/panel/pedidos/nuevo')}
            >
              {t(`${KEY}.view`)}
            </Button>
          </div>
          {note}
        </div>
      ) : (
        <div className="flex flex-col">
          <div>
            <Button
              size="sm"
              disabled={blocked}
              startIcon={<HiOutlineShoppingCart className="size-4" />}
              onClick={() => addToSketch(product, target.variantId, target.pickedValues, cap)}
            >
              {t(`${KEY}.add`)}
            </Button>
          </div>
          {note}
        </div>
      )}
    </SlotSwap>
  );
};

export default SketchDetailAdd;
