import { useParams } from '@tanstack/react-router';
import type { AxiosError } from 'axios';
import { useLayoutEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { HiOutlineArrowLeft, HiOutlineArrowPath } from 'react-icons/hi2';
import Button from '@components/Button';
import { getStatus } from '@utils/apiError';
import { staggerIn, staggerOut } from '../pageMotion';
import { usePanelNavigate } from '../PanelNavContext';
import { usePanelPageMotion } from '../PanelPageTransitionContext';
import ProductForm from './ProductForm';
import ProductFormSkeleton from './ProductFormSkeleton';
import ProductsStatus from './ProductsStatus';
import SectionReveal from './SectionReveal';
import { useProduct } from './useProduct';

const KEY = 'modules.panel.products';
const EKEY = `${KEY}.edit`;
const SECONDARY_COLOR = '#262626';

/**
 * The product edit page (`/panel/productos/:id/editar`) — **Admin only**: the route's `beforeLoad`
 * silently bounces every other role (and any malformed id) to `/panel/productos` before this ever
 * renders; the backend 403 on `PUT /products/:id` stays the real boundary.
 *
 * The form is `ProductForm` in edit mode, mounted only once the product is loaded (RHF captures
 * defaults at mount) — arriving from the detail page the query is cache-seeded, so the form is
 * usually instant; a cold deep-link shows the section skeletons. An unknown/soft-deleted id gets
 * the same honest not-found panel as the detail page.
 */
const ProductEditPage: React.FC = () => {
  const { t } = useTranslation();
  const panelNavigate = usePanelNavigate();
  const { productId } = useParams({ from: '/panel/productos_/$productId_/editar' });
  const id = Number(productId);
  const { data: product, isLoading, isError, isFetching, refetch, error } = useProduct(id);
  const root = useRef<HTMLDivElement>(null);

  const loading = isLoading && !product;
  const notFound = isError && !product && getStatus(error as AxiosError) === 404;
  const hasError = isError && !product && !notFound;

  // Entrance on mount and when an ERROR panel replaces the content. Deliberately NOT keyed on
  // `loading`: skeleton → form is `SectionReveal`'s move (the shimmer dissolves in place while the
  // form's section cards cascade in) — replaying the page stagger there would blank everything and
  // re-run the whole entrance.
  useLayoutEffect(() => {
    staggerIn(root.current, '.reveal-block');
  }, [notFound, hasError]);

  usePanelPageMotion(
    useMemo(
      () => ({
        enter: (options) => staggerIn(root.current, '.reveal-block', options),
        exit: () => staggerOut(root.current, '.reveal-block'),
      }),
      [],
    ),
  );

  const backPath = `/panel/productos/${id}` as const;

  return (
    <div ref={root} className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6">
      <div className="reveal-block flex flex-col gap-1.5">
        <button
          type="button"
          onClick={() => panelNavigate(backPath)}
          className="flex w-fit cursor-pointer items-center gap-1.5 text-sm text-charcoal/55 transition-colors hover:text-charcoal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-magenta focus-visible:ring-offset-2 rounded-chip"
        >
          <HiOutlineArrowLeft aria-hidden className="size-4" />
          {t(`${EKEY}.back`)}
        </button>
        <h2 className="text-xl font-bold text-charcoal sm:text-2xl">{t(`${EKEY}.title`)}</h2>
        <p className="text-sm text-charcoal/55">{t(`${EKEY}.lead`)}</p>
      </div>

      {notFound ? (
        <div className="reveal-block flex flex-1 flex-col">
          <ProductsStatus
            tone="empty"
            title={t(`${KEY}.detail.notFound.title`)}
            description={t(`${KEY}.detail.notFound.description`)}
            action={
              <Button
                variant="soft"
                color={SECONDARY_COLOR}
                size="sm"
                startIcon={<HiOutlineArrowLeft className="size-4" />}
                onClick={() => panelNavigate('/panel/productos')}
              >
                {t(`${KEY}.detail.notFound.back`)}
              </Button>
            }
          />
        </div>
      ) : hasError ? (
        <div className="reveal-block flex flex-1 flex-col">
          <ProductsStatus
            tone="error"
            title={t(`${KEY}.detail.error.title`)}
            description={t(`${KEY}.detail.error.description`)}
            action={
              <Button
                variant="soft"
                color={SECONDARY_COLOR}
                size="sm"
                loading={isFetching}
                startIcon={<HiOutlineArrowPath className="size-4" />}
                onClick={() => void refetch()}
              >
                {t(`${KEY}.detail.error.retry`)}
              </Button>
            }
          />
        </div>
      ) : (
        /* Skeleton → form is an IN-PLACE reveal, and the skeleton IS the form's real structure
           (`ProductFormSkeleton`: actual section cards, titles, footer — only the value-dependent
           bodies shimmer), so the dissolve lands chrome on chrome while the real cards
           (`.reveal-block`) cascade in — the add-product doctrine at page scale, never a
           blank-out + re-entrance. */
        <SectionReveal
          loading={loading}
          itemSelector=".reveal-block"
          skeleton={
            <div role="status" aria-label={t(`${EKEY}.loading`)}>
              <ProductFormSkeleton />
            </div>
          }
        >
          {product && <ProductForm mode="edit" product={product} />}
        </SectionReveal>
      )}
    </div>
  );
};

export default ProductEditPage;
