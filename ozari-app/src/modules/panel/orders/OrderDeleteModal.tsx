import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import Button from '@components/Button';
import FormError from '@components/FormError';
import Modal from '@components/Modal';
import { notify } from '@components/notifications/notify';
import { toFormError } from '@utils/apiError';
import { useDeleteOrder } from './useDeleteOrder';
import type { OrderDetail } from './order.types';

const KEY = 'modules.panel.orders.detail.delete';
const SECONDARY_COLOR = '#262626';
const DANGER_COLOR = '#dc2626';

interface OrderDeleteModalProps {
  /** The order to destroy — absent while the dialog is closed. */
  order?: OrderDetail;
  onClose: () => void;
  /** Called after a successful delete, so the page can leave (there's nothing to return to). */
  onDeleted: () => void;
}

/**
 * The permanent-deletion confirm. Cancelling is how an order that HAPPENED is closed; this is for
 * one that should never have existed, so the copy says exactly what goes and that it cannot be
 * undone — including the fact that its photos and its whole trail go with it.
 *
 * Kept mounted while it closes (like every dialog here) so the primitive can play its exit.
 */
const OrderDeleteModal: React.FC<OrderDeleteModalProps> = ({ order, onClose, onDeleted }) => {
  const { t } = useTranslation();
  const [formError, setFormError] = useState<string | undefined>(undefined);
  const { deleteOrder, isPending } = useDeleteOrder();
  const open = order !== undefined;

  const [shown, setShown] = useState<OrderDetail | undefined>(order);
  if (open && shown !== order) {
    setShown(order);
    setFormError(undefined);
  }
  if (!shown) return null;

  const submit = (): void => {
    setFormError(undefined);
    deleteOrder(shown.id, {
      onSuccess: () => {
        notify.success(t(`${KEY}.successToast`, { client: shown.clientName }), {
          title: t(`${KEY}.successTitle`),
        });
        onClose();
        onDeleted();
      },
      onError: (error) => {
        const { inline, toast } = toFormError(error, t(`${KEY}.error`));
        setFormError(inline ?? t(`${KEY}.error`));
        if (toast) notify.error(toast);
      },
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      role="alertdialog"
      locked={isPending}
      dismissible
      title={t(`${KEY}.title`)}
      description={t(`${KEY}.description`, { client: shown.clientName })}
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
            {t(`${KEY}.dismiss`)}
          </Button>
          <Button
            color={DANGER_COLOR}
            fullWidth
            loading={isPending}
            onClick={submit}
            className="sm:w-auto"
          >
            {t(`${KEY}.confirm`)}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {/* Spelled out, not implied: what disappears, and that nothing brings it back. */}
        <ul className="modal-stagger flex list-disc flex-col gap-1 pl-5 text-sm text-charcoal/70">
          <li>{t(`${KEY}.bullets.record`)}</li>
          <li>{t(`${KEY}.bullets.evidence`)}</li>
          {/* Stated, never hedged. An order still holding goods gives them back; one that finished
              or was cancelled released them at that moment, and "restoring" them again would invent
              stock — the backend refuses to, so the dialog must not imply it. `holdsInventory` is
              the same derivation the server acts on. */}
          <li>{t(`${KEY}.bullets.${shown.holdsInventory ? 'stock' : 'stockFree'}`)}</li>
        </ul>
        <p className="modal-stagger rounded-control bg-red-50 px-3 py-2 text-sm font-medium text-red-600">
          {t(`${KEY}.warning`)}
        </p>
        <div className="modal-stagger">
          <FormError message={formError} />
        </div>
      </div>
    </Modal>
  );
};

export default OrderDeleteModal;
