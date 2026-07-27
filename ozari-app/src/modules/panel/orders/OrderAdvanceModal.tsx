import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { HiOutlineCamera, HiOutlineTrash } from 'react-icons/hi2';
import Button from '@components/Button';
import CustomTextarea from '@components/CustomTextarea';
import FormError from '@components/FormError';
import Modal from '@components/Modal';
import { notify } from '@components/notifications/notify';
import { toFormError } from '@utils/apiError';
import type { OrderAction, OrderListItem } from './order.types';
import { useAdvanceOrder } from './useAdvanceOrder';
import { useOrderEvidenceUploads } from './useOrderEvidenceUploads';

const KEY = 'modules.panel.orders.advance';
const SECONDARY_COLOR = '#262626';
/** Same content types the storage policy accepts (the presign re-checks and binds them). */
const ACCEPTED_IMAGES = 'image/jpeg,image/png,image/webp,image/avif';

interface OrderAdvanceModalProps {
  /** The order being moved, and the move — both absent while the dialog is closed. */
  order?: OrderListItem;
  action?: OrderAction;
  onClose: () => void;
}

/**
 * The confirm dialog behind EVERY lifecycle move — the quick action's forward step, an admin's
 * rewind, a cancel. It is entirely driven by the `OrderAction` the backend offered: the copy names
 * the target status the admin configured, the photo picker appears only when that step declares
 * `requiresEvidence` (bounded by its resolved `min`/`max`), and the reason field only when the move
 * is disruptive. Adding, renaming or re-flagging a step in "Estados del pedido" changes this dialog
 * with no code change.
 *
 * Photos upload straight to R2 FIRST (presign → PUT); only their keys travel with the advance, so a
 * failed upload never leaves a half-advanced order. Errors follow the form doctrine
 * (`skipErrorNotification` + `toFormError`): the 409 "it already moved", the 422 "evidence
 * incomplete" and a 403 land in the inline banner, ambient failures toast, an outage stays silent.
 */
const OrderAdvanceModal: React.FC<OrderAdvanceModalProps> = ({ order, action, onClose }) => {
  const { t } = useTranslation();
  const [files, setFiles] = useState<File[]>([]);
  const [reason, setReason] = useState('');
  const [formError, setFormError] = useState<string | undefined>(undefined);
  const fileInput = useRef<HTMLInputElement>(null);
  const { advanceOrder, isPending } = useAdvanceOrder();
  const { uploadEvidence, isUploading } = useOrderEvidenceUploads();
  const open = order !== undefined && action !== undefined;
  const busy = isPending || isUploading;

  // A fresh dialog for every move — the next one must never inherit the previous photos, reason or
  // error. Done as React's sanctioned "adjust state during render" (keyed by which move is up)
  // rather than an effect, so nothing renders once with stale content.
  const move = open ? `${order.id}:${action.statusId}` : undefined;
  const [openedMove, setOpenedMove] = useState(move);
  if (openedMove !== move) {
    setOpenedMove(move);
    setFiles([]);
    setReason('');
    setFormError(undefined);
  }

  if (!open) return null;

  const needsEvidence = action.requiresEvidence;
  const needsReason = action.requiresReason;
  const enoughEvidence = !needsEvidence || files.length >= action.minEvidence;
  const enoughReason = !needsReason || reason.trim().length > 0;

  const addFiles = (input: HTMLInputElement): void => {
    // Read the picked files BEFORE clearing the input (the reset empties its FileList, and the
    // state updater runs later). Clearing it is what lets the SAME file be re-picked afterwards.
    const picked = Array.from(input.files ?? []);
    input.value = '';
    // Respect the step's own maximum — the backend rejects an overflow, so never let it be sent.
    setFiles((current) => [...current, ...picked].slice(0, action.maxEvidence));
  };

  const removeFile = (index: number): void => {
    setFiles((current) => current.filter((_, position) => position !== index));
  };

  const submit = (): void => {
    /* v8 ignore next -- belt to the disabled button: unreachable through the UI, and a double
       submit while uploading/advancing would double-charge the lifecycle */
    if (busy || !enoughEvidence || !enoughReason) return;
    setFormError(undefined);
    const fallback = t(`${KEY}.errors.fallback`);
    // Photos first: their keys are what the advance records, and a failed upload must leave the
    // order exactly where it was.
    void uploadEvidence(files)
      .then((evidenceKeys) => {
        advanceOrder(
          {
            orderId: order.id,
            toStatusId: action.statusId,
            ...(evidenceKeys.length > 0 && { evidenceKeys }),
            ...(needsReason && { reason: reason.trim() }),
          },
          {
            onSuccess: () => {
              notify.success(
                t(`${KEY}.successToast`, { status: action.statusName }),
                { title: t(`${KEY}.successTitle`) },
              );
              onClose();
            },
            onError: (error) => {
              const { inline, toast } = toFormError(error, fallback);
              if (inline) setFormError(inline);
              if (toast) notify.error(toast);
            },
          },
        );
      })
      .catch((error: unknown) => {
        const { inline, toast } = toFormError(error, t(`${KEY}.errors.upload`));
        setFormError(inline ?? t(`${KEY}.errors.upload`));
        if (toast) notify.error(toast);
      });
  };

  // The copy is per KIND (advance / rewind / cancel), with the admin-configured status name in it.
  const titleKey = needsReason ? 'cancelTitle' : action.kind === 'backward' ? 'rewindTitle' : 'title';
  const descriptionKey = needsReason
    ? 'cancelDescription'
    : action.kind === 'backward'
      ? 'rewindDescription'
      : 'description';

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      locked={busy}
      dismissible
      title={t(`${KEY}.${titleKey}`, { status: action.statusName })}
      description={t(`${KEY}.${descriptionKey}`, {
        status: action.statusName,
        client: order.clientName,
      })}
      footer={
        <>
          <Button
            variant="soft"
            color={SECONDARY_COLOR}
            fullWidth
            onClick={onClose}
            disabled={busy}
            className="sm:w-auto"
          >
            {t(`${KEY}.cancelAction`)}
          </Button>
          <Button
            color={SECONDARY_COLOR}
            fullWidth
            loading={busy}
            disabled={!enoughEvidence || !enoughReason}
            onClick={submit}
            className="sm:w-auto"
          >
            {t(`${KEY}.confirm`)}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        {needsEvidence && (
          <div className="modal-stagger flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-semibold text-charcoal/80">
                {t(`${KEY}.evidenceLabel`)}
              </span>
              <span className="text-xs text-charcoal/45">
                {t(`${KEY}.evidenceCount`, {
                  count: files.length,
                  min: action.minEvidence,
                  max: action.maxEvidence,
                })}
              </span>
            </div>
            <input
              ref={fileInput}
              type="file"
              accept={ACCEPTED_IMAGES}
              multiple
              // `capture` is deliberately absent: the driver may shoot now OR pick a photo already
              // taken — quality of evidence over forcing the camera (EPIC-2 §8).
              className="sr-only"
              aria-label={t(`${KEY}.evidenceLabel`)}
              onChange={(event) => addFiles(event.target)}
            />
            <Button
              variant="soft"
              color={SECONDARY_COLOR}
              size="sm"
              startIcon={<HiOutlineCamera className="size-4" />}
              disabled={busy || files.length >= action.maxEvidence}
              onClick={() => fileInput.current?.click()}
            >
              {t(`${KEY}.addPhotos`)}
            </Button>
            {files.length > 0 && (
              <ul className="flex flex-col gap-2">
                {files.map((file, index) => (
                  <li
                    key={`${file.name}-${index}`}
                    className="flex items-center gap-3 rounded-control bg-charcoal/[0.03] px-3 py-2"
                  >
                    <span className="min-w-0 flex-1 truncate text-xs text-charcoal/70">
                      {file.name}
                    </span>
                    <button
                      type="button"
                      aria-label={t(`${KEY}.removePhoto`, { name: file.name })}
                      disabled={busy}
                      onClick={() => removeFile(index)}
                      className="shrink-0 cursor-pointer rounded-control p-1 text-charcoal/50 outline-none transition-[color] hover:text-red-500 focus-visible:ring-2 focus-visible:ring-charcoal/30 disabled:cursor-not-allowed"
                    >
                      <HiOutlineTrash className="size-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {needsReason && (
          <div className="modal-stagger">
            <CustomTextarea
              id="advance-reason"
              rows={3}
              data-modal-autofocus
              label={t(`${KEY}.reasonLabel`)}
              placeholder={t(`${KEY}.reasonPlaceholder`)}
              aria-label={t(`${KEY}.reasonLabel`)}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </div>
        )}

        <FormError message={formError} />
      </div>
    </Modal>
  );
};

export default OrderAdvanceModal;
