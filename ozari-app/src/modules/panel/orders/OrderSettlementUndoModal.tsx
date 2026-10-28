import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import Button from '@components/Button';
import FormError from '@components/FormError';
import Modal from '@components/Modal';
import { notify } from '@components/notifications/notify';
import { toFormError } from '@utils/apiError';
import type { OrderDetail } from './order.types';
import { useUndoOrderSettlement } from './useUndoOrderSettlement';

const KEY = 'modules.panel.orders.settlementUndo';
const SECONDARY_COLOR = '#262626';
const DANGER_COLOR = '#dc2626';

/**
 * The confirm dialog behind the Depósito card's "Deshacer" ("Deshacer el registro del depósito") —
 * clearing an order's deposit settlement. The twin of `OrderPaymentUndoModal`, and it follows the
 * same copy rule: state what the act DOES, never imply WHY. The record is cleared (the retention, the
 * damage description, every lost/broken count) and the
 * deposit is "pendiente" again — and then the one thing this could be mistaken for: **it moves no
 * money.** A refund already handed back, or a balance already collected, happened outside this
 * record and stays happened.
 *
 * Confirm FIRST: the dialog holds (`locked`) with its spinner until the server answers; only then
 * does it close, and the hook's invalidations make the detail re-read itself.
 */
const OrderSettlementUndoModal: React.FC<{
  /** The order whose settlement is being cleared — absent while the dialog is closed. */
  order?: OrderDetail;
  onClose: () => void;
}> = ({ order, onClose }) => {
  const { t } = useTranslation();
  const [formError, setFormError] = useState<string | undefined>(undefined);
  const { undoSettlement, isPending } = useUndoOrderSettlement();
  const open = order !== undefined;

  // A fresh dialog each time — reset DURING RENDER on the open-state edge (the repo's
  // adjust-state-during-render pattern), never in an effect that would commit the stale value first.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (!open) setFormError(undefined);
  }

  const confirm = (): void => {
    /* v8 ignore next -- `order` is what OPENS the dialog, so the footer can only be reached with one
       present; the guard is a type narrowing, and `isPending` is the real double-tap check */
    if (!order || isPending) return;
    setFormError(undefined);
    undoSettlement(order.id, {
      onSuccess: () => {
        notify.success(t(`${KEY}.successToast`, { client: order.clientName }), {
          title: t(`${KEY}.successTitle`),
        });
        onClose();
      },
      onError: (error) => {
        // The 409 "no settlement recorded" means this screen was stale — somebody already cleared
        // it — so it belongs inline, where the admin is looking.
        const { inline, toast } = toFormError(error, t(`${KEY}.errors.fallback`));
        if (inline) setFormError(inline);
        if (toast) notify.error(toast);
      },
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      locked={isPending}
      role="alertdialog"
      title={t(`${KEY}.title`)}
      description={t(`${KEY}.description`, { client: order?.clientName ?? '' })}
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
            color={DANGER_COLOR}
            fullWidth
            loading={isPending}
            onClick={confirm}
            className="sm:w-auto"
          >
            {t(`${KEY}.confirm`)}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="modal-stagger flex flex-col gap-1.5">
          <div className="rounded-control bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {t(`${KEY}.note`)}
          </div>
          <p className="px-2 text-xs text-charcoal/45">{t(`${KEY}.hint`)}</p>
        </div>
        <div className="modal-stagger">
          <FormError id="order-settlement-undo-error" message={formError} />
        </div>
      </div>
    </Modal>
  );
};

export default OrderSettlementUndoModal;
