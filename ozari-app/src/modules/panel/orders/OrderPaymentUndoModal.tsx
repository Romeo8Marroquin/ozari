import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import Button from '@components/Button';
import FormError from '@components/FormError';
import Modal from '@components/Modal';
import { notify } from '@components/notifications/notify';
import { toFormError } from '@utils/apiError';
import type { OrderDetail } from './order.types';
import { useUndoPayment } from './useUndoPayment';

const KEY = 'modules.panel.orders.paymentUndo';
const SECONDARY_COLOR = '#262626';
const DANGER_COLOR = '#dc2626';

/**
 * The confirm dialog behind "Deshacer pago" — deleting an order's payment record.
 *
 * It lives on the ORDER DETAIL only. The agenda and the dashboard are scanning surfaces where the
 * one money action that belongs is the one that moves the job forward; an undo sitting beside it is
 * an invitation to tap the wrong one at a glance.
 *
 * **The copy states what the act DOES, and never implies WHY it is being done.** It is a normal
 * bookkeeping operation — the admin may be correcting a slip, or a payment may simply have fallen
 * through — and copy that assumes a mistake ("esto corrige un registro equivocado") tells the person
 * reading it something about themselves rather than about the button. So: the record is deleted, the
 * order returns to pending, the method goes with it. Then the one thing this could be mistaken for —
 * **it is not a refund.** Money travelling back to a client is a real act with its own amount and
 * date, and nothing here performs it; that is the entire reason there is a warning at all.
 */
const OrderPaymentUndoModal: React.FC<{
  /** The order whose payment is being undone — absent while the dialog is closed. */
  order?: OrderDetail;
  onClose: () => void;
}> = ({ order, onClose }) => {
  const { t } = useTranslation();
  const [formError, setFormError] = useState<string | undefined>(undefined);
  const { undoPayment, isPending } = useUndoPayment();
  const open = order !== undefined;

  // A fresh dialog each time — a previous failure must not greet the next order. Reset DURING
  // RENDER on the open-state edge (the repo's adjust-state-during-render pattern) rather than in an
  // effect, which would commit the stale value for one frame first.
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
    undoPayment(order.id, {
      onSuccess: () => {
        notify.success(t(`${KEY}.successToast`, { client: order.clientName }), {
          title: t(`${KEY}.successTitle`),
        });
        onClose();
      },
      onError: (error) => {
        // The 409 "no payment recorded" is the important one: it means this screen was stale —
        // somebody else already undid it — so it belongs inline where the admin is looking.
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
        {/* What actually happens, in the order it matters: the record is DELETED, the order returns
            to pending, the method goes with it — and then the one thing this could be mistaken for.
            "No devuelve dinero al cliente" is the whole reason there is a note at all: money moving
            back is a real act with its own amount and date, and nothing here does it. */}
        <div className="modal-stagger flex flex-col gap-1.5">
          <div className="rounded-control bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {t(`${KEY}.note`)}
          </div>
          {/* The consequence of the delete being a real delete: there is no stored payment left to
              restore, so re-recording it stamps a new date. Small print — it matters only if you
              change your mind, and it should not compete with the warning above. */}
          <p className="px-2 text-xs text-charcoal/45">{t(`${KEY}.hint`)}</p>
        </div>
        <div className="modal-stagger">
          <FormError id="order-payment-undo-error" message={formError} />
        </div>
      </div>
    </Modal>
  );
};

export default OrderPaymentUndoModal;
