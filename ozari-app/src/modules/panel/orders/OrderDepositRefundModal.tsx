import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import Button from '@components/Button';
import FormError from '@components/FormError';
import Modal from '@components/Modal';
import { notify } from '@components/notifications/notify';
import { QueryKeys } from '@constants/QueryKeys';
import { toFormError } from '@utils/apiError';
import { formatMoney } from './orderEstimate';
import type { OrderDetail } from './order.types';
import { useSettleOrder } from './useSettleOrder';

const KEY = 'modules.panel.orders.depositRefund';
const SECONDARY_COLOR = '#262626';

/**
 * The deposit's HAPPY PATH — "Devolver depósito" (or "Sin daños" when the order carries only
 * replacement values and no deposit): one confirm that records the settlement with nothing claimed,
 * `{ retainedAmount: 0, damages: [] }`, through the same `PUT /orders/:id/settlement` the
 * "Reportar daños" page uses. The common case should cost one tap and one confirmation, not a form.
 *
 * Confirm FIRST (FRONTEND-DOCTRINE §7): the dialog holds (`locked`) with its spinner until the server
 * answers; only then does it close. The response is the re-projected order, seeded into the detail's
 * cache, and the hook's invalidations make every screen re-read itself. `skipErrorNotification` is on
 * the mutation, so `toFormError` routes a 409 (a stale screen — already recorded, cancelled) inline.
 */
const OrderDepositRefundModal: React.FC<{
  /** The order whose deposit goes back whole — absent while the dialog is closed. */
  order?: OrderDetail;
  onClose: () => void;
}> = ({ order, onClose }) => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | undefined>(undefined);
  const { settleOrder, isPending } = useSettleOrder();
  const open = order !== undefined;

  // The copy is decided by the order SHOWN — kept while the dialog closes, so its exit never
  // re-words itself mid-fade.
  const [shown, setShown] = useState(order);
  // A fresh dialog each time — reset DURING RENDER on the open-state edge (the repo's
  // adjust-state-during-render pattern), never in an effect that would commit the stale value first.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (!open) setFormError(undefined);
  }
  if (order && order !== shown) setShown(order);

  const total = shown?.securityDeposit?.total ?? 0;
  const symbol = shown?.currency.symbol ?? '';
  const client = shown?.clientName ?? '';
  const variant = total > 0 ? '' : 'NoDeposit';

  const confirm = (): void => {
    /* v8 ignore next -- `order` is what OPENS the dialog, so the footer can only be reached with one
       present; the guard is a type narrowing, and `isPending` is the real double-tap check */
    if (!order || isPending) return;
    setFormError(undefined);
    settleOrder(
      { orderId: order.id, body: { retainedAmount: 0, damages: [] } },
      {
        onSuccess: (response) => {
          const saved = response.data.data?.order;
          if (saved) queryClient.setQueryData([QueryKeys.ORDER, order.id], saved);
          notify.success(t(`${KEY}.successToast${variant}`, { client: order.clientName }), {
            title: t(`${KEY}.successTitle${variant}`),
          });
          onClose();
        },
        onError: (error) => {
          const { inline, toast } = toFormError(error, t(`${KEY}.errors.fallback`));
          if (inline) setFormError(inline);
          if (toast) notify.error(toast);
        },
      },
    );
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      locked={isPending}
      title={t(`${KEY}.title${variant}`)}
      description={
        total > 0
          ? t(`${KEY}.description`, { amount: formatMoney(symbol, total) })
          : t(`${KEY}.descriptionNoDeposit`)
      }
      footer={
        <>
          <Button
            variant="soft"
            color={SECONDARY_COLOR}
            fullWidth
            onClick={onClose}
            disabled={isPending}
            className="sm:w-auto"
          >
            {t(`${KEY}.cancel`)}
          </Button>
          <Button
            color={SECONDARY_COLOR}
            fullWidth
            loading={isPending}
            onClick={confirm}
            className="sm:w-auto"
          >
            {t(`${KEY}.confirm${variant}`)}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="modal-stagger flex flex-col gap-1.5">
          <p className="break-words text-sm font-medium text-charcoal/70">
            {t(`${KEY}.client`, { client })}
          </p>
          <p className="text-xs text-charcoal/45">{t(`${KEY}.hint`)}</p>
        </div>
        <div className="modal-stagger">
          <FormError id="order-deposit-refund-error" message={formError} />
        </div>
      </div>
    </Modal>
  );
};

export default OrderDepositRefundModal;
