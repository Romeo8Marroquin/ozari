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
import ProductsStatus from '../products/ProductsStatus';
import SectionReveal from '../products/SectionReveal';
import OrderForm from './OrderForm';
import OrderFormSkeleton from './OrderFormSkeleton';
import { useOrder } from './useOrder';

const KEY = 'modules.panel.orders.detail';
const EKEY = 'modules.panel.orders.edit';
const SECONDARY_COLOR = '#262626';

/**
 * The order edit page (`/panel/pedidos/:id/editar`) — **Admin only**: the route's `beforeLoad`
 * silently bounces every other role (and any malformed id) to `/panel/pedidos` before this renders;
 * the backend 403 on `PUT /orders/:id` stays the real boundary.
 *
 * The form is `OrderForm` in edit mode, mounted only once the order has loaded — RHF captures its
 * defaults at mount, so handing it a half-order would freeze the wrong values in. Until then the
 * page shows the form's OWN structure and dissolves it in place (`SectionReveal`), the same
 * skeleton→content move as the product edit page and the order detail.
 *
 * An unknown id — or one belonging to another worker, which the backend answers identically — gets
 * the detail page's honest not-found panel rather than an empty form.
 */
const OrderEditPage: React.FC = () => {
  const { t } = useTranslation();
  const panelNavigate = usePanelNavigate();
  const { orderId } = useParams({ from: '/panel/pedidos_/$orderId_/editar' });
  const id = Number(orderId);
  const { data: order, isLoading, isError, isFetching, refetch, error } = useOrder(id);
  const root = useRef<HTMLDivElement>(null);

  const loading = isLoading && !order;
  const notFound = isError && !order && getStatus(error as AxiosError) === 404;
  const hasError = isError && !order && !notFound;

  // Entrance on mount and when an ERROR panel replaces the content. Deliberately NOT keyed on
  // `loading`: skeleton → form is `SectionReveal`'s move (the shimmer dissolves in place while the
  // section cards cascade in) — replaying the page stagger there would blank everything.
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

  const goBack = (): void => panelNavigate(`/panel/pedidos/${id}`);

  return (
    <div ref={root} className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6">
      <div className="reveal-block flex flex-col gap-1.5">
        <button
          type="button"
          onClick={goBack}
          className="flex w-fit cursor-pointer items-center gap-1.5 rounded-chip text-sm text-charcoal/55 transition-colors hover:text-charcoal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-magenta focus-visible:ring-offset-2"
        >
          <HiOutlineArrowLeft aria-hidden className="size-4" />
          {t(`${EKEY}.back`)}
        </button>
        <h2 className="text-xl font-bold text-charcoal sm:text-2xl">{t(`${EKEY}.title`)}</h2>
        <p className="text-sm text-charcoal/55">{t(`${EKEY}.lead`)}</p>
      </div>

      {notFound || hasError ? (
        <div className="reveal-block flex flex-1 flex-col">
          <ProductsStatus
            tone={notFound ? 'empty' : 'error'}
            title={t(`${KEY}.${notFound ? 'notFound' : 'error'}.title`)}
            description={t(`${KEY}.${notFound ? 'notFound' : 'error'}.description`)}
            action={
              notFound ? (
                <Button
                  variant="soft"
                  color={SECONDARY_COLOR}
                  size="sm"
                  startIcon={<HiOutlineArrowLeft className="size-4" />}
                  onClick={() => panelNavigate('/panel/pedidos')}
                >
                  {t(`${KEY}.notFound.action`)}
                </Button>
              ) : (
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
              )
            }
          />
        </div>
      ) : (
        <SectionReveal
          loading={loading}
          itemSelector=".reveal-block"
          skeleton={
            <div role="status" aria-label={t(`${EKEY}.loading`)}>
              <OrderFormSkeleton />
            </div>
          }
        >
          {order && <OrderForm mode="edit" order={order} />}
        </SectionReveal>
      )}
    </div>
  );
};

export default OrderEditPage;
