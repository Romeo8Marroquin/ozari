import { useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  HiOutlineArrowLeft,
  HiOutlineArrowPath,
  HiOutlineChevronLeft,
  HiOutlineChevronRight,
  HiOutlinePhoto,
} from 'react-icons/hi2';
import Button from '@components/Button';
import FormError from '@components/FormError';
import { notify } from '@components/notifications/notify';
import { QueryKeys } from '@constants/QueryKeys';
import { getStatus, toFormError } from '@utils/apiError';
import {
  animateGalleryLayout,
  captureGalleryLayout,
  staggerIn,
  staggerOut,
} from '../pageMotion';
import { usePanelNavigate } from '../PanelNavContext';
import { usePanelPageMotion } from '../PanelPageTransitionContext';
import {
  keyboardMoveTarget,
  moveId,
  reconcileArrangement,
  sameOrder,
} from './productArrangement';
import type { ProductArrangementItem } from './product.types';
import ProductsStatus from './ProductsStatus';
import SectionReveal from './SectionReveal';
import { useGalleryDrag } from './useGalleryDrag';
import { useProductArrangement } from './useProductArrangement';
import { useSaveProductArrangement } from './useSaveProductArrangement';

const KEY = 'modules.panel.products.arrange';
const SECONDARY_COLOR = '#262626';
const FORM_ID = 'arrange-products-form';
const HINT_ID = 'arrange-products-hint';
const SKELETON_TILES = 12;
const SKELETON = 'animate-pulse rounded bg-charcoal/10 motion-reduce:animate-none';

// The columns follow the FORM's width, not the window's (the panel sidebar and page padding sit in
// between — FRONTEND-DOCTRINE §10): denser than the catalog grid on purpose, so a whole catalog fits
// in view while arranging. The column count never changes the ORDER — it is row-major either way,
// which is exactly how the catalog grid reads it back.
const GRID =
  'grid grid-cols-2 gap-3 @min-[26rem]:grid-cols-3 @min-[38rem]:grid-cols-4 @min-[52rem]:grid-cols-5 @min-[66rem]:grid-cols-6';

// The tile controls are permanent on touch (no hover to reveal them) and hover/focus-revealed on a
// fine pointer — capability, not viewport, decides (the gallery's rule).
const CONTROL_REVEAL =
  'pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 group-focus-within:opacity-100';

type FlipState = ReturnType<typeof captureGalleryLayout>;

/** The cold-load stand-in: the grid's real shape, shimmering (the loading doctrine). */
const ArrangeSkeleton: React.FC = () => (
  <div className="@container flex flex-col gap-4">
    <span aria-hidden className={`block h-3 w-64 max-w-full ${SKELETON}`} />
    <div className={GRID}>
      {Array.from({ length: SKELETON_TILES }).map((_, index) => (
        <div key={index} className="flex flex-col overflow-hidden rounded-control ring-1 ring-black/[0.06]">
          <span aria-hidden className={`block aspect-[3/4] w-full rounded-none ${SKELETON}`} />
          <div className="flex flex-col gap-1.5 px-2.5 py-2">
            <span aria-hidden className={`block h-3 w-3/4 ${SKELETON}`} />
            <span aria-hidden className={`block h-2.5 w-1/2 ${SKELETON}`} />
          </div>
        </div>
      ))}
    </div>
  </div>
);

/**
 * The catalog ARRANGEMENT page (`/panel/productos/ordenar`) — **Admin only** (the route bounces
 * every other role; the backend 403 on `/products/display-order` is the real boundary). The admin
 * drags the catalog's own tiles into the order clients will see, and saves it as ONE declarative
 * full-state write (every active id, in order).
 *
 * What you arrange is what clients see: the tiles are a compact version of the catalog cards and
 * the order is row-major, exactly how the catalog grid reads it back at any column count. Three
 * ways to move a tile, all landing on the same `moveId`:
 *
 * - **drag** (`useGalleryDrag`, shared with the product photo gallery — the card itself lifts and
 *   follows the pointer, siblings FLIP aside, touch lifts on a still long-press);
 * - **the tile's ‹ › buttons** (one step; permanent on touch, hover-revealed on a mouse);
 * - **the keyboard** on a focused tile: arrows move one step, Home/End to the ends, and an
 *   `aria-live` line announces the new position.
 *
 * Products created since the last save arrive unplaced (`placed: false`, a "Nuevo" chip) and lead
 * the catalog until arranged — so saving is offered even with no move, because it is what places
 * them. A `409` means the catalog itself changed while arranging (a product added or deleted): the
 * save can no longer name the right set, so the page says so and offers to reload it.
 */
const ProductArrangePage: React.FC = () => {
  const { t } = useTranslation();
  const panelNavigate = usePanelNavigate();
  const queryClient = useQueryClient();
  const { data, isLoading, isError, isFetching, refetch } = useProductArrangement();
  const { saveArrangement, isPending } = useSaveProductArrangement();
  const root = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLUListElement>(null);
  const tileRefs = useRef(new Map<string, HTMLLIElement>());
  // A keyboard/button move's FLIP snapshot, captured just before the commit (never held across a
  // scroll — FRONTEND-DOCTRINE §4) and consumed by the layout effect below.
  const pendingFlip = useRef<FlipState>(null);
  // React MOVES the focused <li> when the order changes, which drops its focus — a keyboard move
  // puts it back so the arrows keep driving the same product.
  const refocusId = useRef<string | null>(null);

  const [draft, setDraft] = useState<number[] | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [formError, setFormError] = useState<string | undefined>(undefined);
  const [conflict, setConflict] = useState(false);

  const loading = isLoading && !data;
  const hasError = isError && !data;
  const products = useMemo(() => data ?? [], [data]);
  const serverIds = useMemo(() => products.map((product) => product.id), [products]);
  const byId = useMemo(() => new Map(products.map((product) => [product.id, product])), [products]);
  const order = useMemo(() => reconcileArrangement(draft, serverIds), [draft, serverIds]);
  const dirty = !sameOrder(order, serverIds);
  const unplacedCount = products.filter((product) => !product.placed).length;
  // Saving PLACES the new products, so it is meaningful with no move at all while any are unplaced.
  const canSave = dirty || unplacedCount > 0;
  const tiles = useMemo(() => order.map((id) => ({ id: String(id) })), [order]);

  // Entrance on mount and when the error panel replaces the content. Skeleton → grid is
  // `SectionReveal`'s in-place move, never a re-staggered page.
  useLayoutEffect(() => {
    staggerIn(root.current, '.reveal-block');
  }, [hasError]);

  usePanelPageMotion(
    useMemo(
      () => ({
        enter: (options) => staggerIn(root.current, '.reveal-block', options),
        exit: () => staggerOut(root.current, '.reveal-block'),
      }),
      [],
    ),
  );

  const { draggingId, getThumbHandlers } = useGalleryDrag({
    disabled: isPending,
    images: tiles,
    moveImage: (id, toIndex) =>
      setDraft((current) => moveId(reconcileArrangement(current, serverIds), Number(id), toIndex)),
    scopeRef: gridRef,
    thumbRefs: tileRefs,
  });

  const orderKey = order.join('|');
  useLayoutEffect(() => {
    const state = pendingFlip.current;
    pendingFlip.current = null;
    if (state) animateGalleryLayout(gridRef.current, state);
    const focusId = refocusId.current;
    refocusId.current = null;
    /* v8 ignore next -- `?.`: the tile a keyboard move refocuses was rendered in this very commit */
    if (focusId) tileRefs.current.get(focusId)?.focus();
  }, [orderKey]);

  /** One step (or a jump) from a button or the keyboard — FLIPped and announced. */
  const moveTo = (product: ProductArrangementItem, toIndex: number, refocus: boolean): void => {
    pendingFlip.current = captureGalleryLayout(gridRef.current);
    if (refocus) refocusId.current = String(product.id);
    setDraft(moveId(order, product.id, toIndex));
    setAnnouncement(
      t(`${KEY}.announce`, { name: product.name, position: toIndex + 1, total: order.length }),
    );
  };

  const resetFeedback = (): void => {
    setFormError(undefined);
    setConflict(false);
  };

  const discard = (): void => {
    setDraft(null);
    resetFeedback();
  };

  const reload = (): void => {
    void refetch().then(() => {
      setDraft(null);
      resetFeedback();
    });
  };

  const onSubmit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (!canSave || isPending) return;
    resetFeedback();
    saveArrangement(order, {
      onSuccess: (response) => {
        const saved = response.data.data?.products;
        if (saved) queryClient.setQueryData([QueryKeys.PRODUCT_ARRANGEMENT], saved);
        setDraft(null);
        void queryClient.invalidateQueries({ queryKey: [QueryKeys.PRODUCTS] });
        notify.success(t(`${KEY}.successToast`), { title: t(`${KEY}.successTitle`) });
        panelNavigate('/panel/productos');
      },
      onError: (error) => {
        if (axios.isAxiosError(error) && getStatus(error) === 409) setConflict(true);
        const { inline, toast } = toFormError(error, t(`${KEY}.errors.submitFallback`));
        if (inline) setFormError(inline);
        if (toast) notify.error(toast);
      },
    });
  };

  const backButton = (
    <Button
      variant="soft"
      color={SECONDARY_COLOR}
      size="sm"
      startIcon={<HiOutlineArrowLeft className="size-4" />}
      onClick={() => panelNavigate('/panel/productos')}
    >
      {t(`${KEY}.back`)}
    </Button>
  );

  return (
    <div ref={root} className="flex w-full flex-1 flex-col gap-6">
      <div className="reveal-block flex flex-col gap-1.5">
        <button
          type="button"
          onClick={() => panelNavigate('/panel/productos')}
          className="flex w-fit cursor-pointer items-center gap-1.5 rounded-chip text-sm text-charcoal/55 transition-colors hover:text-charcoal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-magenta focus-visible:ring-offset-2"
        >
          <HiOutlineArrowLeft aria-hidden className="size-4" />
          {t(`${KEY}.back`)}
        </button>
        <h2 className="text-xl font-bold text-charcoal sm:text-2xl">{t(`${KEY}.title`)}</h2>
        <p className="text-sm text-charcoal/55">{t(`${KEY}.lead`)}</p>
      </div>

      {hasError ? (
        <div className="reveal-block flex flex-1 flex-col">
          <ProductsStatus
            tone="error"
            title={t(`${KEY}.error.title`)}
            description={t(`${KEY}.error.description`)}
            action={
              <Button
                variant="soft"
                color={SECONDARY_COLOR}
                size="sm"
                loading={isFetching}
                startIcon={<HiOutlineArrowPath className="size-4" />}
                onClick={() => void refetch()}
              >
                {t(`${KEY}.error.retry`)}
              </Button>
            }
          />
        </div>
      ) : (
        <div className="reveal-block flex flex-1 flex-col">
          <SectionReveal
            loading={loading}
            skeleton={
              <div role="status" aria-label={t(`${KEY}.loading`)}>
                <ArrangeSkeleton />
              </div>
            }
          >
            {products.length === 0 ? (
              <ProductsStatus
                tone="empty"
                title={t(`${KEY}.empty.title`)}
                description={t(`${KEY}.empty.description`)}
                action={backButton}
              />
            ) : (
              <form id={FORM_ID} onSubmit={onSubmit} className="@container flex flex-col gap-4">
                <div className="reveal-item flex flex-col gap-1">
                  <p id={HINT_ID} className="text-xs text-charcoal/50">
                    {t(`${KEY}.hint`)}
                  </p>
                  {unplacedCount > 0 && (
                    <p className="text-xs text-charcoal/50">
                      {t(`${KEY}.unplacedNote`, { count: unplacedCount })}
                    </p>
                  )}
                </div>
                <p aria-live="polite" className="sr-only">
                  {announcement}
                </p>

                <ul ref={gridRef} className={GRID} role="list">
                  {order.map((id, index) => {
                    const product = byId.get(id);
                    /* v8 ignore next -- `order` is reconciled against the same server list `byId` maps */
                    if (!product) return null;
                    const key = String(id);
                    const isDragging = draggingId === key;
                    const position = index + 1;
                    return (
                      <li
                        key={key}
                        ref={(el) => {
                          if (el) tileRefs.current.set(key, el);
                          else tileRefs.current.delete(key);
                        }}
                        {...getThumbHandlers(key)}
                        tabIndex={0}
                        aria-label={t(`${KEY}.tileLabel`, {
                          name: product.name,
                          position,
                          total: order.length,
                        })}
                        aria-describedby={HINT_ID}
                        onKeyDown={(event) => {
                          if (isPending || event.target !== event.currentTarget) return;
                          const target = keyboardMoveTarget(event.key, index, order.length);
                          if (target === null) return;
                          event.preventDefault();
                          moveTo(product, target, true);
                        }}
                        // A long-press means "pick the tile up", never the browser's image menu.
                        onContextMenu={(event) => event.preventDefault()}
                        className={`reveal-item gallery-flip group relative flex min-w-0 select-none flex-col overflow-hidden rounded-control bg-white transition-[box-shadow] duration-200 [-webkit-touch-callout:none] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-magenta ${
                          isDragging
                            ? 'cursor-grabbing shadow-xl ring-2 ring-magenta/40'
                            : 'pointer-fine:cursor-grab shadow-sm ring-1 ring-black/[0.06]'
                        }`}
                      >
                        <div className="relative aspect-[3/4] overflow-hidden bg-charcoal/[0.04]">
                          {product.imageUrl ? (
                            <img
                              src={product.imageUrl}
                              alt=""
                              draggable={false}
                              className="size-full object-cover"
                            />
                          ) : (
                            <span className="grid size-full place-items-center text-charcoal/25">
                              <HiOutlinePhoto aria-hidden className="size-8" />
                            </span>
                          )}
                          <span
                            aria-hidden
                            className="absolute left-1.5 top-1.5 grid min-w-6 place-items-center rounded-full bg-white/90 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-charcoal/75 shadow-sm backdrop-blur"
                          >
                            {position}
                          </span>
                          {!product.placed && (
                            <span
                              aria-hidden
                              className="absolute right-1.5 top-1.5 rounded-chip bg-magenta px-1.5 py-0.5 text-[10px] font-semibold text-white shadow-sm"
                            >
                              {t(`${KEY}.newBadge`)}
                            </span>
                          )}
                          <div
                            className={`absolute inset-x-1.5 bottom-1.5 flex justify-between transition-opacity duration-200 ${CONTROL_REVEAL}`}
                          >
                            <button
                              type="button"
                              tabIndex={-1}
                              disabled={isPending || index === 0}
                              onClick={() => moveTo(product, index - 1, false)}
                              aria-label={t(`${KEY}.actions.earlier`, { name: product.name })}
                              className="grid size-7 cursor-pointer place-items-center rounded-full bg-white/90 text-charcoal/60 shadow-sm backdrop-blur transition-[color,opacity] hover:text-charcoal disabled:cursor-default disabled:opacity-0"
                            >
                              <HiOutlineChevronLeft aria-hidden className="size-4" />
                            </button>
                            <button
                              type="button"
                              tabIndex={-1}
                              disabled={isPending || index === order.length - 1}
                              onClick={() => moveTo(product, index + 1, false)}
                              aria-label={t(`${KEY}.actions.later`, { name: product.name })}
                              className="grid size-7 cursor-pointer place-items-center rounded-full bg-white/90 text-charcoal/60 shadow-sm backdrop-blur transition-[color,opacity] hover:text-charcoal disabled:cursor-default disabled:opacity-0"
                            >
                              <HiOutlineChevronRight aria-hidden className="size-4" />
                            </button>
                          </div>
                        </div>
                        <div className="flex min-w-0 flex-col px-2.5 py-2">
                          <p className="truncate text-sm font-semibold text-charcoal">{product.name}</p>
                          <p className="truncate text-xs text-charcoal/50">{product.category}</p>
                        </div>
                      </li>
                    );
                  })}
                </ul>

                <div className="reveal-item flex flex-col">
                  <FormError id="arrange-products-error" message={formError} />
                  <div className="flex flex-col-reverse gap-3 @min-[30rem]:flex-row @min-[30rem]:justify-end">
                    {conflict ? (
                      <Button
                        variant="soft"
                        color={SECONDARY_COLOR}
                        fullWidth
                        loading={isFetching}
                        startIcon={<HiOutlineArrowPath className="size-4" />}
                        onClick={reload}
                        className="@min-[30rem]:w-auto"
                      >
                        {t(`${KEY}.actions.reload`)}
                      </Button>
                    ) : (
                      <Button
                        variant="soft"
                        color={SECONDARY_COLOR}
                        fullWidth
                        disabled={!dirty || isPending}
                        onClick={discard}
                        className="@min-[30rem]:w-auto"
                      >
                        {t(`${KEY}.actions.discard`)}
                      </Button>
                    )}
                    <Button
                      type="submit"
                      form={FORM_ID}
                      color={SECONDARY_COLOR}
                      fullWidth
                      disabled={!canSave}
                      loading={isPending}
                      className="@min-[30rem]:w-auto"
                    >
                      {t(`${KEY}.actions.submit`)}
                    </Button>
                  </div>
                </div>
              </form>
            )}
          </SectionReveal>
        </div>
      )}
    </div>
  );
};

export default ProductArrangePage;
