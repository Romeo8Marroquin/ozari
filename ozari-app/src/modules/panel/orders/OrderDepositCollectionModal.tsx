import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import Button from '@components/Button';
import CustomTextarea from '@components/CustomTextarea';
import FormError from '@components/FormError';
import Modal from '@components/Modal';
import { notify } from '@components/notifications/notify';
import { QueryKeys } from '@constants/QueryKeys';
import { toFormError } from '@utils/apiError';
import { formatMoney } from './orderEstimate';
import type { OrderDetail, OrderDetailEnvelope } from './order.types';
import { depositCollectionReasonError, toDepositCollectionBody } from './SchemaDepositCollection';
import { useClearDepositCollection, useRecordDepositCollection } from './useDepositCollection';
import type { OzariSuccessResponse } from '../../../types/api.types';
import type { AxiosResponse } from 'axios';

const KEY = 'modules.panel.orders.depositCollection';
const FORM_ID = 'order-deposit-collection-form';
const SECONDARY_COLOR = '#262626';
const DANGER_COLOR = '#dc2626';

/** What the dialog records: the deposit was received, it was NOT received (with why), or the record
 *  is cleared back to PENDING ("Corregir"). */
export type DepositCollectionMode = 'receive' | 'waive' | 'clear';

/**
 * The deposit's "¿Se recibió el depósito?" dialogs — one component, three acts, because they share
 * everything but their copy and their body. Opened from the Depósito card, and from the "Reportar
 * daños" page when the deposit is not received (only a RECEIVED deposit is money we have — owner,
 * 2026-10-28 — so recording it there recomputes the report in place):
 *
 * - `receive` → a quick confirm, `PUT { received: true }` (also from WAIVED: it may arrive later);
 * - `waive` → "no recibido" — the REQUIRED reason (an internal note, never printed for the client),
 *   mirrored by `SchemaDepositCollection`, `PUT { received: false, reason }`. It never means the
 *   deposit was forgiven: it is simply not in our hands;
 * - `clear` → a confirm of the "Corregir", `DELETE` (back to pending; it moves no money).
 *
 * Confirm FIRST (FRONTEND-DOCTRINE §7): the dialog holds (`locked`) until the server answers; the
 * response's order is seeded into the detail and the hooks re-read every view. Errors follow the
 * form doctrine (`skipErrorNotification` + `toFormError`): a 409 — a cancelled order, or a stale
 * screen — lands inline. The reason is a `<textarea>`, so it is submitted by its button
 * (Enter inserts a newline — FRONTEND-DOCTRINE §8), inside a real `noValidate` form.
 */
const OrderDepositCollectionModal: React.FC<{
  /** The order — absent while the dialog is closed. */
  order?: OrderDetail;
  mode?: DepositCollectionMode;
  onClose: () => void;
}> = ({ order, mode, onClose }) => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const [formError, setFormError] = useState<string | undefined>(undefined);
  const record = useRecordDepositCollection();
  const clear = useClearDepositCollection();
  const isPending = record.isPending || clear.isPending;
  const open = order !== undefined && mode !== undefined;

  // The dialog keeps showing the act it last opened with, so its exit never re-words itself.
  const [shown, setShown] = useState<{ order: OrderDetail; mode: DepositCollectionMode }>();
  if (open && (shown?.order !== order || shown.mode !== mode)) {
    setShown({ order, mode });
    // A fresh dialog for every opening — adjusted during render, never in an effect.
    setReason('');
    setFormError(undefined);
  }
  if (!shown) return null;
  const act = shown.mode;
  const client = shown.order.clientName;
  const amount = formatMoney(shown.order.currency.symbol, shown.order.securityDeposit?.total ?? 0);
  const reasonError =
    act === 'waive' ? depositCollectionReasonError({ received: false, reason }) : undefined;
  // "Required" is said by the disabled button; only a TOO-LONG reason needs words under the field.
  const visibleReasonError = reason.trim() === '' ? undefined : reasonError;

  const onSuccess = (response: AxiosResponse<OzariSuccessResponse<OrderDetailEnvelope>>): void => {
    const saved = response.data.data?.order;
    if (saved) queryClient.setQueryData([QueryKeys.ORDER, shown.order.id], saved);
    notify.success(t(`${KEY}.${act}.successToast`, { client }), {
      title: t(`${KEY}.${act}.successTitle`),
    });
    onClose();
  };
  const onError = (error: unknown): void => {
    const { inline, toast } = toFormError(error, t(`${KEY}.errors.fallback`));
    if (inline) setFormError(inline);
    if (toast) notify.error(toast);
  };

  const confirm = (): void => {
    if (isPending || reasonError) return;
    setFormError(undefined);
    if (act === 'clear') {
      clear.clearCollection(shown.order.id, { onSuccess, onError });
      return;
    }
    record.recordCollection(
      {
        orderId: shown.order.id,
        body: toDepositCollectionBody({ received: act === 'receive', reason }),
      },
      { onSuccess, onError },
    );
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      locked={isPending}
      role={act === 'clear' ? 'alertdialog' : 'dialog'}
      title={t(`${KEY}.${act}.title`)}
      description={t(`${KEY}.${act}.description`, { client, amount })}
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
            type="submit"
            form={FORM_ID}
            color={act === 'clear' ? DANGER_COLOR : SECONDARY_COLOR}
            fullWidth
            loading={isPending}
            disabled={reasonError !== undefined}
            className="sm:w-auto"
          >
            {t(`${KEY}.${act}.confirm`)}
          </Button>
        </>
      }
    >
      <form
        id={FORM_ID}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          confirm();
        }}
        className="flex flex-col gap-4"
      >
        {act === 'waive' && (
          <div className="modal-stagger flex flex-col gap-1.5">
            <CustomTextarea
              id="deposit-collection-reason"
              rows={3}
              data-modal-autofocus
              label={t(`${KEY}.reasonLabel`)}
              placeholder={t(`${KEY}.reasonPlaceholder`)}
              aria-label={t(`${KEY}.reasonLabel`)}
              value={reason}
              error={visibleReasonError !== undefined}
              onChange={(event) => setReason(event.target.value)}
            />
            {visibleReasonError && (
              <p className="px-2 text-xs text-red-600">{visibleReasonError}</p>
            )}
            <p className="px-2 text-xs text-charcoal/45">{t(`${KEY}.internalNote`)}</p>
          </div>
        )}
        <p
          className={`modal-stagger rounded-control px-3 py-2 text-sm ${
            act === 'clear' ? 'bg-amber-50 text-amber-900' : 'bg-charcoal/[0.04] text-charcoal/70'
          }`}
        >
          {t(`${KEY}.${act}.note`)}
        </p>
        <div className="modal-stagger">
          <FormError id="order-deposit-collection-error" message={formError} />
        </div>
      </form>
    </Modal>
  );
};

export default OrderDepositCollectionModal;
