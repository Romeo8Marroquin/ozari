import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import Button from '@components/Button';
import CustomSelect from '@components/CustomSelect';
import FormError from '@components/FormError';
import Modal from '@components/Modal';
import { notify } from '@components/notifications/notify';
import { toFormError } from '@utils/apiError';
import type { OrderListItem } from './order.types';
import { useOrdersCatalog } from './useOrdersCatalog';
import { usePayOrder } from './usePayOrder';

const KEY = 'modules.panel.orders.payment';
const SECONDARY_COLOR = '#262626';

const MONEY = new Intl.NumberFormat('es-GT', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * The confirm dialog behind "Registrar pago" — the one place money is marked as received, shared by
 * the agenda ticket, the dashboard's up-next card and the order detail.
 *
 * It asks for the METHOD rather than assuming one, because that is the single piece of information
 * the act creates and nobody will go back to fill in later. It is still optional: cash handed over
 * at the door often has no method worth recording, and forcing a choice would only teach the admin
 * to pick whatever is first in the list.
 *
 * The amount is stated, not editable — partial payments are the deposit's job, and an editable
 * figure here would quietly become a second, competing source of truth for what the order costs.
 */
const OrderPaymentModal: React.FC<{
  /** The order being settled — absent while the dialog is closed. */
  order?: OrderListItem;
  onClose: () => void;
}> = ({ order, onClose }) => {
  const { t } = useTranslation();
  const [methodId, setMethodId] = useState<number | null>(null);
  const [formError, setFormError] = useState<string | undefined>(undefined);
  const { payOrder, isPending } = usePayOrder();
  const catalogQuery = useOrdersCatalog();
  const open = order !== undefined;

  // A fresh dialog each time: neither a previous order's method nor a previous failure may greet the
  // next one. Reset DURING RENDER on the open-state edge (the repo's adjust-state-during-render
  // pattern) rather than in an effect — an effect would commit the stale values for one frame first.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (!open) {
      setMethodId(null);
      setFormError(undefined);
    }
  }

  const confirm = (): void => {
    /* v8 ignore next -- `order` is what OPENS the dialog, so the footer can only be reached with
       one present; the guard is a type narrowing, and `isPending` is the real double-tap check */
    if (!order || isPending) return;
    setFormError(undefined);
    payOrder(
      { orderId: order.id, ...(methodId !== null && { paymentMethodId: methodId }) },
      {
        onSuccess: () => {
          notify.success(t(`${KEY}.successToast`, { client: order.clientName }), {
            title: t(`${KEY}.successTitle`),
          });
          onClose();
        },
        onError: (error) => {
          // The 409 "already paid" is the important one: it means this screen was stale, so it
          // belongs inline where the admin is looking, never as a toast they might miss.
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
            color={SECONDARY_COLOR}
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
      {/* The blocks need real air between them: the select's floating label RISES above its box on
          focus, and with the amount panel flush against it the label landed on top of the amount.
          `gap-6` is the clearance that label needs, not decoration. */}
      <div className="flex flex-col gap-6">
        <div className="modal-stagger">
          {/* The amount is the fact being confirmed, so it leads — bigger, on the app's own soft
              surface. Deliberately NOT "cash green": the palette has no green token, and inventing
              one for a single element is what made the map buttons read as foreign chrome. Money
              elsewhere in the app (the ticket total, the detail's breakdown) is charcoal too. */}
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 rounded-control bg-charcoal/[0.04] px-4 py-3">
            <span className="text-xs font-medium uppercase tracking-wide text-charcoal/45">
              {t(`${KEY}.amountLabel`)}
            </span>
            <span className="text-xl font-bold tabular-nums text-charcoal">
              {order ? `${order.currency.symbol} ${MONEY.format(order.totalAmount)}` : ''}
            </span>
          </div>
        </div>

        <div className="modal-stagger">
          <CustomSelect
            id="order-payment-method"
            optionalLabel
            label={t(`${KEY}.methodLabel`)}
            placeholderOption={t(`${KEY}.methodPlaceholder`)}
            value={methodId ?? ''}
            onChange={(event) =>
              setMethodId(event.target.value === '' ? null : Number(event.target.value))
            }
            options={(catalogQuery.data?.paymentMethods ?? []).map((method) => ({
              value: method.id,
              label: method.name,
            }))}
          />
          <p className="mt-1.5 px-2 text-xs text-charcoal/45">{t(`${KEY}.methodHint`)}</p>
        </div>

        <div className="modal-stagger">
          <FormError id="order-payment-error" message={formError} />
        </div>
      </div>
    </Modal>
  );
};

export default OrderPaymentModal;
