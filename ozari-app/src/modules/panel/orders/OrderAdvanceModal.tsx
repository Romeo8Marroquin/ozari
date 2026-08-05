import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Button from '@components/Button';
import CustomTextarea from '@components/CustomTextarea';
import FormError from '@components/FormError';
import Modal from '@components/Modal';
import { notify } from '@components/notifications/notify';
import { Role } from '@constants/Roles';
import { useHasRole } from '@hooks/useRole';
import { toFormError } from '@utils/apiError';
import { mintEvidencePhotos, revokeEvidencePhotos, type EvidencePhoto } from './evidencePhotos';
import OrderEvidencePicker from './OrderEvidencePicker';
import type { OrderAction, OrderListItem } from './order.types';
import { useAdvanceOrder } from './useAdvanceOrder';
import { useOrderEvidenceUploads } from './useOrderEvidenceUploads';

const KEY = 'modules.panel.orders.advance';
const SECONDARY_COLOR = '#262626';
/** The same red the delete dialogs use — reserved for actions that destroy work. */
const DANGER_COLOR = '#dc2626';

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
const OrderAdvanceModal: React.FC<OrderAdvanceModalProps> = ({
  order: pendingOrder,
  action: pendingAction,
  onClose,
}) => {
  const { t } = useTranslation();
  const [photos, setPhotos] = useState<EvidencePhoto[]>([]);
  const [reason, setReason] = useState('');
  const [formError, setFormError] = useState<string | undefined>(undefined);
  const isAdmin = useHasRole([Role.Admin]);
  const { advanceOrder, isPending } = useAdvanceOrder();
  const { uploadEvidence, isUploading } = useOrderEvidenceUploads();
  const open = pendingOrder !== undefined && pendingAction !== undefined;
  const busy = isPending || isUploading;

  // Every object URL this dialog ever minted, revoked when it unmounts (the per-photo revoke on
  // remove/reset handles the rest) — a preview handle is a live reference to the file's bytes.
  const minted = useRef<EvidencePhoto[]>([]);
  useEffect(
    () => () => {
      revokeEvidencePhotos(minted.current);
      minted.current = [];
    },
    [],
  );

  // The dialog keeps rendering the move it LAST showed, so the `Modal` primitive can play its exit
  // (fade + reverse content sweep, ~480ms) instead of being torn out of the tree the instant the
  // page clears its pending move — which is exactly what made closing SNAP while opening was smooth.
  const [shown, setShown] = useState<{ order: OrderListItem; action: OrderAction }>();
  if (open && (shown?.order !== pendingOrder || shown.action !== pendingAction)) {
    setShown({ order: pendingOrder, action: pendingAction });
    // A fresh dialog for every NEW move — and never on the way out, so the photos and the reason
    // stay painted while it animates away. React's sanctioned "adjust state during render".
    revokeEvidencePhotos(photos);
    setPhotos([]);
    setReason('');
    setFormError(undefined);
  }

  // Nothing has ever been opened → nothing in the tree at all.
  if (!shown) return null;
  const { order, action } = shown;

  const needsEvidence = action.requiresEvidence;
  const needsReason = action.requiresReason;
  const enoughEvidence = !needsEvidence || photos.length >= action.minEvidence;
  const enoughReason = !needsReason || reason.trim().length > 0;

  const addPhotos = (files: File[]): void => {
    const added = mintEvidencePhotos(files);
    minted.current.push(...added);
    // Respect the step's own maximum — the backend rejects an overflow, so never let it be sent.
    setPhotos((current) => [...current, ...added].slice(0, action.maxEvidence));
  };

  const removePhoto = (id: string): void => {
    setPhotos((current) =>
      current.filter((photo) => {
        if (photo.id !== id) return true;
        // The preview holds the file's bytes — release it with the photo it belonged to.
        URL.revokeObjectURL(photo.previewUrl);
        return false;
      }),
    );
  };

  const submit = (): void => {
    /* v8 ignore next -- belt to the disabled button: unreachable through the UI, and a double
       submit while uploading/advancing would double-charge the lifecycle */
    if (busy || !enoughEvidence || !enoughReason) return;
    setFormError(undefined);
    const fallback = t(`${KEY}.errors.fallback`);
    // Photos first: their keys are what the advance records, and a failed upload must leave the
    // order exactly where it was.
    void uploadEvidence(photos.map((photo) => photo.file))
      .then((evidenceKeys) => {
        advanceOrder(
          {
            orderId: order.id,
            toStatusId: action.statusId,
            // Photos are tagged with the step they document — this dialog moves ONE step, so it's a
            // single entry (the multi-step jump on the detail page sends one per crossed step).
            ...(evidenceKeys.length > 0 && {
              evidence: [{ statusId: action.statusId, keys: evidenceKeys }],
            }),
            ...(needsReason && { reason: reason.trim() }),
          },
          {
            onSuccess: () => {
              // BOTH values — the toast names the client as well as the step ("El pedido de María
              // López pasó a En ruta"), and a missing one renders as a literal `{{client}}`.
              notify.success(
                t(`${KEY}.successToast`, {
                  status: action.statusName,
                  client: order.clientName,
                }),
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

  // The copy is per KIND (advance / rewind / cancel), phrased as the INSTRUCTION being confirmed
  // ("Mover pedido a En ruta"), never as a label ("Marcar En ruta") — the person tapping this is
  // often mid-delivery on a phone, so it must say exactly what is about to happen, to WHICH order,
  // and FROM where. The status names are whatever the admin configured them to be.
  const kindKey = needsReason ? 'cancel' : action.kind === 'backward' ? 'rewind' : 'forward';
  // Cancelling only frees goods the order was still HOLDING. On one that already finished (its units
  // went back to the fleet at the last step) or whose sale units were already delivered, the old
  // blanket promise — "sus productos volverán a estar disponibles" — was simply false, so the
  // description and the reversibility note both follow the move's real `inventoryEffect`.
  const settled = action.inventoryEffect === 'none';
  const COPY = {
    forward: { title: 'title', description: 'description', confirm: 'confirm' },
    rewind: {
      title: 'rewindTitle',
      description: 'rewindDescription',
      confirm: 'confirmRewind',
    },
    cancel: {
      title: 'cancelTitle',
      description: settled ? 'cancelDescriptionSettled' : 'cancelDescription',
      confirm: 'confirmCancel',
    },
  }[kindKey];
  // Naming BOTH ends of the move ("de Pendiente a En ruta") removes the last ambiguity for someone
  // who can't see the row they tapped once the dialog covers it.
  const copyValues = {
    status: action.statusName,
    from: order.status.name,
    client: order.clientName,
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      locked={busy}
      dismissible
      title={t(`${KEY}.${COPY.title}`, copyValues)}
      description={t(`${KEY}.${COPY.description}`, copyValues)}
      footer={
        <>
          {/* "Volver", never "Cancelar" — on the CANCEL dialog a button labelled "Cancelar" beside
              one that cancels the order is exactly the kind of ambiguity this screen can't afford. */}
          <Button
            variant="soft"
            color={SECONDARY_COLOR}
            fullWidth
            onClick={onClose}
            disabled={busy}
            className="sm:w-auto"
          >
            {t(`${KEY}.dismiss`)}
          </Button>
          {/* The confirm repeats the instruction rather than saying "Confirmar", so the last thing
              read before the tap is the action itself. */}
          <Button
            // A DISRUPTIVE move (cancelling an order) wears the danger colour, exactly like the
            // delete dialogs: charcoal is the app's "proceed" colour, and using it for the one
            // action here that destroys work made a cancel look like any other step.
            color={pendingAction?.kind === 'disruptive' ? DANGER_COLOR : SECONDARY_COLOR}
            fullWidth
            loading={busy}
            disabled={!enoughEvidence || !enoughReason}
            onClick={submit}
            className="sm:w-auto"
          >
            {t(`${KEY}.${COPY.confirm}`, copyValues)}
          </Button>
        </>
      }
    >
      {/* Each block below is its own `.modal-stagger` target, so the dialog's open/close sweep
          CASCADES through the body (label → hint → picker → photos → reason → error) instead of
          moving the whole content as one slab. */}
      <div className="flex flex-col gap-4">
        {/* Cancelling is REVERSIBLE — but only by an admin, and only while the freed products are
            still free. Saying "no se puede deshacer" to an admin was simply untrue; saying nothing
            to a driver would be worse, since they genuinely can't undo it. So each reader gets the
            sentence that applies to them. */}
        {needsReason && (
          <p
            className={`modal-stagger rounded-control px-3 py-2 text-sm ${
              isAdmin ? 'bg-charcoal/[0.04] text-charcoal/70' : 'bg-amber-50 text-amber-700'
            }`}
          >
            {isAdmin
              ? t(`${KEY}.${settled ? 'cancelReversibleSettled' : 'cancelReversible'}`)
              : t(`${KEY}.cancelFinal`)}
          </p>
        )}
        {/* What this move does to the goods, stated only when it does something. A `reclaim` is the
            one that can FAIL — the order takes units back, and someone else may already have them —
            so it's an amber warning; a `release` is just useful news. Both come from the lifecycle
            flags, so inserting or re-flagging a step rewrites them with no code change. */}
        {!needsReason && action.inventoryEffect !== 'none' && (
          <p
            className={`modal-stagger rounded-control px-3 py-2 text-sm ${
              action.inventoryEffect === 'reclaim'
                ? 'bg-amber-50 text-amber-700'
                : 'bg-charcoal/[0.04] text-charcoal/70'
            }`}
          >
            {t(`${KEY}.${action.inventoryEffect === 'reclaim' ? 'reclaimWarning' : 'releaseNote'}`)}
          </p>
        )}
        {/* Undoing a documented step destroys its photos — said here, before it happens, exactly as
            the multi-step dialog does for every step of a walk. */}
        {action.purgesEvidence && (
          <p className="modal-stagger rounded-control bg-amber-50 px-3 py-2 text-sm text-amber-700">
            {t(`${KEY}.purgeWarning`, { from: order.status.name })}
          </p>
        )}
        {needsEvidence && (
          <OrderEvidencePicker
            className="flex flex-col gap-4"
            blockClassName="modal-stagger"
            label={t(`${KEY}.evidenceLabel`)}
            hint={t(`${KEY}.evidenceHint`)}
            countLabel={t(`${KEY}.evidenceCount`, {
              count: photos.length,
              min: action.minEvidence,
              max: action.maxEvidence,
            })}
            addLabel={t(`${KEY}.addPhotos`)}
            removeLabel={(name) => t(`${KEY}.removePhoto`, { name })}
            photos={photos}
            max={action.maxEvidence}
            disabled={busy}
            onAdd={addPhotos}
            onRemove={removePhoto}
          />
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

        <div className="modal-stagger">
          <FormError message={formError} />
        </div>
      </div>
    </Modal>
  );
};

export default OrderAdvanceModal;
