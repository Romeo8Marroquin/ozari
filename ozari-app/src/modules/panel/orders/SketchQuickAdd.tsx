import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { HiArrowRight, HiPlus } from 'react-icons/hi2';
import CrossfadeImage from '@components/CrossfadeImage';
import MorphSwap from '@components/MorphSwap';
import QuantityStepper from '@components/QuantityStepper';
import { isFinePointerDevice } from '@utils/pointer';
import { usePanelNavigate } from '../PanelNavContext';
import { productCoverUrl } from '../products/productPresentation';
import type { Product } from '../products/product.types';
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
/** Breathing room between the button and the card, and between the card and the window's edges. */
const GAP_PX = 8;
const EDGE_PX = 8;
const WIDTH_PX = 272;
/** The exit fade's length — the card stays mounted that long after closing so it can play. */
const EXIT_MS = 200;
/** The probe already answered for the windowed product (`withWindowStock`), so the cap reads it. */
const NO_PROBE = new Map<string, number | null>();

/**
 * The grid tile's cart control (Admin) — a round button in the tile's price row, ALWAYS visible (a
 * hover-only control would not exist on a phone, where a tap on the tile navigates):
 *
 * - **Not in the sketch**: a glass "+" circle. A press adds ONE unit — the product's GENERIC line (its
 *   only variation when it offers exactly one; the form asks for the variation otherwise) — and opens
 *   the little quantity card, so "add" and "how many" are one gesture.
 * - **In the sketch**: the circle turns magenta and wears the quantity (cross-fading as it changes);
 *   a press opens the card again.
 * - **Nothing takeable** (for the sketch's dates, or today): the circle is muted and inert.
 *
 * The card is the user menu's surface and motion, PORTALED to `<body>` at `--z-float-body`, anchored
 * above the button (below it when there is no room), kept inside the window and re-anchored on
 * scroll/resize; an outside press, Escape or taking focus elsewhere closes it, and so does removing
 * the line. `product` arrives WINDOWED (`withWindowStock`), so its figures are already the dates'.
 */
const SketchQuickAdd: React.FC<{ product: Product }> = ({ product }) => {
  const { t } = useTranslation();
  const panelNavigate = usePanelNavigate();
  const sketch = useOrderSketch();
  const cardId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [present, setPresent] = useState(false);
  const [placement, setPlacement] = useState<{ left: number; top?: number; bottom?: number; above: boolean }>({
    left: 0,
    top: 0,
    above: true,
  });

  const target = genericTarget(product);
  const line = findSketchLine(sketch, product.id, target.variantId);
  const quantity = lineQuantity(line);
  const inSketch = line !== undefined;
  const cap = sketchLineCap(product, target.variantId, sketch?.lines ?? [], NO_PROBE);
  const blocked = !inSketch && cap === 0;
  const dated = sketchWindow(sketch) !== null;
  const hint = sketchCapHint(t, cap, dated, quantity);
  // A generic line of a product WITH variations still needs one chosen — in the form.
  const needsVariant = hasVariants(product) && target.variantId === null;

  // Mounted while open AND through the exit fade ("adjust state during render" for the mount).
  if (open && !present) setPresent(true);
  // The line went away (the trash can here, the form, another tab): nothing left to adjust.
  if (open && !inSketch) setOpen(false);
  useEffect(() => {
    if (open || !present) return undefined;
    const timer = window.setTimeout(() => setPresent(false), EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [open, present]);

  // Above the button (it sits at the tile's foot), below it when there is no room above; right
  // edges aligned, clamped inside the window. Whole pixels: a fixed box on a sub-pixel blurs.
  const place = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    /* v8 ignore next -- the trigger is mounted whenever the card is */
    if (!rect) return;
    const width = Math.min(WIDTH_PX, window.innerWidth - 2 * EDGE_PX);
    const left = Math.round(Math.min(Math.max(rect.right - width, EDGE_PX), window.innerWidth - EDGE_PX - width));
    const above = rect.top > 240 || rect.top > window.innerHeight - rect.bottom;
    setPlacement(
      above
        ? { left, bottom: Math.round(window.innerHeight - rect.top + GAP_PX), above }
        : { left, top: Math.round(rect.bottom + GAP_PX), above },
    );
  }, []);

  useLayoutEffect(() => {
    if (!open) return undefined;
    place();
    const onPointerDown = (event: PointerEvent): void => {
      const node = event.target as Node;
      if (cardRef.current?.contains(node) || triggerRef.current?.contains(node)) return;
      setOpen(false);
    };
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open, place]);

  const press = (): void => {
    if (open) {
      setOpen(false);
      return;
    }
    // Out of the sketch the button is only enabled while something is takeable, so this adds one.
    if (!inSketch) addToSketch(product, target.variantId, target.pickedValues, cap);
    setOpen(true);
  };

  const label = blocked
    ? t(`${KEY}.unavailableNamed`, { name: product.name })
    : inSketch
      ? t(`${KEY}.editNamed`, { name: product.name, count: quantity })
      : t(`${KEY}.addNamed`, { name: product.name });

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={press}
        disabled={blocked}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={present ? cardId : undefined}
        // The info layer is tap-transparent (so a tap anywhere reaches the stretched link below);
        // this control takes its own presses back.
        className={`pointer-events-auto grid h-9 min-w-9 shrink-0 cursor-pointer place-items-center rounded-full px-2 text-sm font-bold tabular-nums shadow-sm ring-1 backdrop-blur transition-[background-color,color,box-shadow,opacity,scale] duration-200 ease-[var(--ease-settle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-magenta active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none ${
          inSketch
            ? 'bg-magenta text-white ring-magenta/30'
            : 'bg-white/90 text-charcoal ring-black/[0.06] enabled:hover:bg-white'
        }`}
      >
        <MorphSwap swapKey={inSketch ? quantity : 'add'}>
          {inSketch ? quantity : <HiPlus aria-hidden className="size-4.5" />}
        </MorphSwap>
      </button>

      {present &&
        createPortal(
          <div
            ref={cardRef}
            id={cardId}
            role="dialog"
            aria-label={product.name}
            inert={!open}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                setOpen(false);
                triggerRef.current?.focus();
              }
            }}
            onBlur={(event) => {
              const next = event.relatedTarget as Node | null;
              if (next && (cardRef.current?.contains(next) || triggerRef.current?.contains(next))) return;
              // Only a focus that went SOMEWHERE closes it — a press on the card's own padding
              // blurs to nothing and must not.
              if (next) setOpen(false);
            }}
            style={{ left: placement.left, top: placement.top, bottom: placement.bottom, width: WIDTH_PX }}
            className={`fixed z-[var(--z-float-body)] flex max-w-[calc(100vw-1rem)] flex-col gap-3 rounded-card border border-charcoal/[0.07] bg-white p-3 shadow-[0_10px_26px_-14px_rgba(38,38,38,0.30)] transition-[opacity,translate] duration-200 ease-[var(--ease-settle)] motion-reduce:transition-none ${
              open
                ? `translate-y-0 opacity-100 starting:opacity-0 ${placement.above ? 'starting:translate-y-1' : 'starting:-translate-y-1'}`
                : `pointer-events-none opacity-0 ${placement.above ? 'translate-y-1' : '-translate-y-1'}`
            }`}
          >
            <div className="flex min-w-0 items-center gap-3">
              <CrossfadeImage src={productCoverUrl(product)} className="size-11 shrink-0 rounded-chip ring-1 ring-black/[0.04]" />
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-sm font-semibold text-charcoal">{product.name}</span>
                <span className="text-xs font-medium text-magenta">{t(`${KEY}.inSketch`)}</span>
              </div>
            </div>
            {/* The note's spacing lives inside it (a silent note takes no room); anchored by its
                bottom edge when it opens above the button, the card grows UPWARD as a hint wraps. */}
            <div className="flex min-w-0 flex-col">
              <QuantityStepper
                size="sm"
                value={quantity}
                max={cap}
                label={t(`${KEY}.quantity`, { name: product.name })}
                autoFocus={isFinePointerDevice()}
                onChange={(next) => setSketchQuantity(product.id, target.variantId, next)}
              />
              <SketchNote hint={hint} needsVariant={needsVariant} />
            </div>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                panelNavigate('/panel/pedidos/nuevo');
              }}
              className="-mx-1 flex cursor-pointer items-center justify-between rounded-control px-2 py-1.5 text-sm font-semibold text-charcoal transition-colors duration-200 hover:bg-charcoal/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-magenta"
            >
              {t(`${KEY}.view`)}
              <HiArrowRight aria-hidden className="size-4" />
            </button>
          </div>,
          document.body,
        )}
    </>
  );
};

export default SketchQuickAdd;
