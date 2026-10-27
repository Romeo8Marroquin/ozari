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
import OrderSettlementForm from './OrderSettlementForm';
import { useOrder } from './useOrder';

const KEY = 'modules.panel.orders.detail';
const SKEY = 'modules.panel.orders.settlement';
const SECONDARY_COLOR = '#262626';
const SKELETON = 'animate-pulse rounded bg-charcoal/10 motion-reduce:animate-none';

/** The form's own structure while the order loads — two section cards of the right shape. */
const SettlementSkeleton: React.FC = () => (
  <div className="flex flex-col gap-6" aria-hidden>
    {[0, 1].map((card) => (
      <div
        key={card}
        className="flex flex-col gap-4 rounded-card border border-charcoal/[0.07] bg-white px-5 py-5 shadow-sm sm:px-6"
      >
        <span className={`block h-4 w-32 ${SKELETON}`} />
        <span className={`block h-3 w-2/3 ${SKELETON}`} />
        <span className={`block h-11 w-full ${SKELETON}`} />
        <span className={`block h-11 w-full ${SKELETON}`} />
      </div>
    ))}
  </div>
);

/**
 * The deposit settlement page (`/panel/pedidos/:id/garantia`) — **Admin only**: the route's
 * `beforeLoad` bounces every other role (and a malformed id) to the agenda; the backend 403 stays
 * the real boundary.
 *
 * A dedicated PAGE through the panel transition, never a modal: it is an entity form with several
 * fields per line (the page-vs-modal doctrine). It records, or corrects, how the deposit comes back
 * — its own door like the payment, NOT a lifecycle step.
 *
 * The form mounts only once the order is loaded AND the API says it can be settled
 * (`securityDeposit.canSettle`); an order that cannot (not delivered yet, cancelled, nothing to
 * settle — or a stale URL) gets an honest panel back to the order rather than a form whose save
 * would be refused. A 404 is the detail page's not-found, a transient failure its retry.
 */
const OrderSettlementPage: React.FC = () => {
  const { t } = useTranslation();
  const panelNavigate = usePanelNavigate();
  const { orderId } = useParams({ from: '/panel/pedidos_/$orderId_/garantia' });
  const id = Number(orderId);
  const { data: order, isLoading, isError, isFetching, refetch, error } = useOrder(id);
  const root = useRef<HTMLDivElement>(null);

  const loading = isLoading && !order;
  const notFound = isError && !order && getStatus(error as AxiosError) === 404;
  const hasError = isError && !order && !notFound;
  const deposit = order?.securityDeposit;
  const unavailable = Boolean(order) && !deposit?.canSettle;

  // Entrance on mount and when a status panel replaces the content — never on `loading`
  // (skeleton → form is `SectionReveal`'s move, not a page replay).
  useLayoutEffect(() => {
    staggerIn(root.current, '.reveal-block');
  }, [notFound, hasError, unavailable]);

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

  const statusPanel =
    notFound || hasError ? (
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
    ) : unavailable ? (
      <ProductsStatus
        tone="empty"
        title={t(`${SKEY}.unavailable.title`)}
        description={t(`${SKEY}.unavailable.description`)}
        action={
          <Button
            variant="soft"
            color={SECONDARY_COLOR}
            size="sm"
            startIcon={<HiOutlineArrowLeft className="size-4" />}
            onClick={goBack}
          >
            {t(`${SKEY}.unavailable.action`)}
          </Button>
        }
      />
    ) : undefined;

  return (
    <div ref={root} className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6">
      <div className="reveal-block flex min-w-0 flex-col gap-1.5">
        <button
          type="button"
          onClick={goBack}
          className="flex w-fit cursor-pointer items-center gap-1.5 rounded-chip text-sm text-charcoal/55 transition-colors hover:text-charcoal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-magenta focus-visible:ring-offset-2"
        >
          <HiOutlineArrowLeft aria-hidden className="size-4" />
          {t(`${SKEY}.back`)}
        </button>
        <h2 className="text-xl font-bold text-charcoal sm:text-2xl">
          {t(`${SKEY}.${deposit?.settlement ? 'editTitle' : 'title'}`)}
        </h2>
        {order && (
          <p className="break-words text-sm font-medium text-charcoal/70">
            {t(`${SKEY}.client`, { client: order.clientName })}
          </p>
        )}
        <p className="text-sm text-charcoal/55">{t(`${SKEY}.lead`)}</p>
      </div>

      {statusPanel ? (
        <div className="reveal-block flex flex-1 flex-col">{statusPanel}</div>
      ) : (
        <SectionReveal
          loading={loading}
          itemSelector=".reveal-block"
          skeleton={
            <div role="status" aria-label={t(`${SKEY}.loading`)}>
              <SettlementSkeleton />
            </div>
          }
        >
          {order && deposit && <OrderSettlementForm order={order} deposit={deposit} />}
        </SectionReveal>
      )}
    </div>
  );
};

export default OrderSettlementPage;
