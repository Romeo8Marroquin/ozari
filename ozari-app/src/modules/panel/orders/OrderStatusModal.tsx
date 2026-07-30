import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Button from '@components/Button';
import CustomSelect from '@components/CustomSelect';
import FormError from '@components/FormError';
import Modal from '@components/Modal';
import { notify } from '@components/notifications/notify';
import { toFormError } from '@utils/apiError';
import { animateHeightFrom, animateListReflow, captureGalleryLayout } from '../pageMotion';
import { mintEvidencePhotos, revokeEvidencePhotos, type EvidencePhoto } from './evidencePhotos';
import OrderEvidencePicker from './OrderEvidencePicker';
import {
  applicableSteps,
  evidenceSteps,
  purgedSteps,
  stepsBetween,
  walkInventoryEffect,
} from './orderStatusPath';
import { useAdvanceOrder } from './useAdvanceOrder';
import { useOrderEvidenceUploads } from './useOrderEvidenceUploads';
import type {
  OrderDetail,
  OrderStatusCatalogOption,
  OrderStockConflictItem,
} from './order.types';

const KEY = 'modules.panel.orders.detail.changeStatus';
const SECONDARY_COLOR = '#262626';
/** The blocks the chosen target rewrites — FLIP-diffed so only what actually changed moves. */
const STEP = '.status-step';

interface OrderStatusModalProps {
  /** The order being moved — absent while the dialog is closed. */
  order?: OrderDetail;
  /** The lifecycle catalog (published with its flags), which the picker is built from. */
  statuses: OrderStatusCatalogOption[];
  onClose: () => void;
}

/** The structured 409 the backend answers when reopening would double-book the goods. */
const conflictsOf = (error: unknown): OrderStockConflictItem[] =>
  (error as { response?: { data?: { data?: { conflicts?: OrderStockConflictItem[] } } } })?.response
    ?.data?.data?.conflicts ?? [];

/**
 * The ADMIN's free status control: move an order to ANY step of its pipeline, or bring a cancelled
 * one back. It exists because the everyday buttons deliberately offer one step at a time — this is
 * the correction tool, not the daily flow.
 *
 * It never invents a shortcut. Picking a distant step resolves the WALK (every step in between) and
 * the dialog then asks for exactly what that walk needs, in one pass:
 *  - **forward** — the photos of every demanding step it crosses, so nothing lands undocumented;
 *  - **backward** — an explicit warning naming the steps whose photos will be **destroyed**, since
 *    undoing a step deletes what documented it (they don't come back);
 *  - **reopen** — no photos: the order returns to a step it already lived through.
 *
 * The backend re-resolves the same walk under a row lock and re-validates every step, so this is a
 * UX mirror, never an authority. Its one expected failure is a reopen whose goods were promised to
 * someone else meanwhile — shown inline, per product, because that's a decision the admin has to
 * make with the numbers in front of them.
 */
const OrderStatusModal: React.FC<OrderStatusModalProps> = ({ order, statuses, onClose }) => {
  const { t } = useTranslation();
  const [targetId, setTargetId] = useState<number | null>(null);
  const [photos, setPhotos] = useState<Record<number, EvidencePhoto[]>>({});
  const [formError, setFormError] = useState<string | undefined>(undefined);
  const [conflicts, setConflicts] = useState<OrderStockConflictItem[]>([]);
  /** The block that grows/shrinks as a target is chosen (the walk, the warning, the pickers). */
  const dynamic = useRef<HTMLDivElement>(null);
  /** The dynamic block's height + tile layout, captured just BEFORE a new target commits. */
  const pendingSwap = useRef<{
    fromHeight: number;
    state: ReturnType<typeof captureGalleryLayout>;
  } | null>(null);
  const { advanceOrder, isPending } = useAdvanceOrder();
  const { uploadEvidence, isUploading } = useOrderEvidenceUploads();
  const open = order !== undefined;
  const busy = isPending || isUploading;

  // Every preview handle this dialog minted — released when it unmounts (the per-photo revoke on
  // remove / target-change / reset covers the rest).
  const minted = useRef<EvidencePhoto[]>([]);
  useEffect(
    () => () => {
      revokeEvidencePhotos(minted.current);
      minted.current = [];
    },
    [],
  );

  // A fresh dialog per order (and per open) — never inherit another order's staged photos.
  const [shown, setShown] = useState<OrderDetail | undefined>(order);
  if (open && shown !== order) {
    setShown(order);
    setTargetId(null);
    revokeEvidencePhotos(Object.values(photos).flat());
    setPhotos({});
    setFormError(undefined);
    setConflicts([]);
  }
  // Choosing a target rewrites this block — and it must do so as a DIFF, never a re-render: the
  // blocks that survive the change stay exactly where they are, the ones the new walk adds rise in,
  // and the block's height eases so nothing below it jumps. Re-staggering every block on each pick
  // is what made "Entregado → Recolectado" read as "hide the photo picker, then show two new ones"
  // instead of "keep that one, add one".
  useLayoutEffect(() => {
    const captured = pendingSwap.current;
    if (!captured) return;
    pendingSwap.current = null;
    animateHeightFrom(dynamic.current, captured.fromHeight);
    animateListReflow(dynamic.current, STEP, captured.state);
  }, [targetId]);

  if (!shown) return null;

  const isReopen = shown.cancelledAt !== undefined;
  // The steps this order can be placed on — its own applicable pipeline, minus where it already is.
  const options = applicableSteps(statuses, shown).filter((step) => step.id !== shown.status.id);
  const target = options.find((step) => step.id === targetId);
  const walk = target ? stepsBetween(statuses, shown, target) : [];
  const needsPhotos = target ? evidenceSteps(statuses, shown, target) : [];
  const willPurge = target ? purgedSteps(statuses, shown, target) : [];
  // What LANDING on the target does to the goods. A jump has no single offered `OrderAction` for the
  // backend to answer with, so this mirrors the same rule the server applies under the lock — and it
  // is where the reopen/rewind conflict is announced BEFORE the 409 rather than after it.
  const inventory = target ? walkInventoryEffect(statuses, shown, target) : 'none';
  /** What is staged for a step — one place where "nothing yet" becomes an empty list. */
  const stagedFor = (stepId: number): EvidencePhoto[] => photos[stepId] ?? [];
  const enough = needsPhotos.every(
    (step) => stagedFor(step.id).length >= step.minEvidence,
  );

  /** Re-aim the walk. Photos already staged for a step the NEW walk still crosses are kept (that
   *  step didn't stop needing them); the rest are released with their previews. */
  const retarget = (value: string): void => {
    const nextId = value === '' ? null : Number(value);
    const nextTarget = options.find((step) => step.id === nextId);
    const stillNeeded = new Set(
      nextTarget ? evidenceSteps(statuses, shown, nextTarget).map((step) => step.id) : [],
    );
    const kept: Record<number, EvidencePhoto[]> = {};
    for (const [stepId, staged] of Object.entries(photos)) {
      if (stillNeeded.has(Number(stepId))) kept[Number(stepId)] = staged;
      else revokeEvidencePhotos(staged);
    }
    // Measured BEFORE the commit — the height and tile layout the block is easing FROM.
    pendingSwap.current = {
      /* v8 ignore next -- the block is mounted whenever this select can be changed */
      fromHeight: dynamic.current?.offsetHeight ?? 0,
      state: captureGalleryLayout(dynamic.current, STEP),
    };
    setTargetId(nextId);
    setPhotos(kept);
    setConflicts([]);
  };

  const addStepPhotos = (step: OrderStatusCatalogOption, files: File[]): void => {
    const added = mintEvidencePhotos(files);
    minted.current.push(...added);
    setPhotos({
      ...photos,
      // Respect the step's own maximum — the backend rejects an overflow, so never send one.
      [step.id]: [...stagedFor(step.id), ...added].slice(0, step.maxEvidence),
    });
  };

  const removeStepPhoto = (step: OrderStatusCatalogOption, photoId: string): void => {
    const staged = stagedFor(step.id);
    revokeEvidencePhotos(staged.filter((photo) => photo.id === photoId));
    setPhotos({ ...photos, [step.id]: staged.filter((photo) => photo.id !== photoId) });
  };

  const submit = (): void => {
    /* v8 ignore next -- belt to the disabled confirm: unreachable through the UI */
    if (!target || busy || !enough) return;
    setFormError(undefined);
    setConflicts([]);
    // Every step's photos are uploaded BEFORE the move, so a failed upload leaves the order exactly
    // where it was — the same rule as the single-step dialog, applied across the whole walk.
    void Promise.all(
      needsPhotos.map((step) =>
        uploadEvidence(stagedFor(step.id).map((photo) => photo.file)).then((keys) => ({
          statusId: step.id,
          keys,
        })),
      ),
    )
      .then((evidence) => {
        advanceOrder(
          {
            orderId: shown.id,
            toStatusId: target.id,
            ...(evidence.length > 0 && { evidence }),
          },
          {
            onSuccess: () => {
              notify.success(t(`${KEY}.successToast`, { status: target.name }), {
                title: t(`${KEY}.successTitle`),
              });
              onClose();
            },
            onError: (error) => {
              const stockConflicts = conflictsOf(error);
              if (stockConflicts.length > 0) {
                // The expected failure: the goods were taken while this order sat cancelled.
                setConflicts(stockConflicts);
                setFormError(t(`${KEY}.errors.conflict`));
                return;
              }
              const { inline, toast } = toFormError(error, t(`${KEY}.errors.fallback`));
              setFormError(inline ?? t(`${KEY}.errors.fallback`));
              if (toast) notify.error(toast);
            },
          },
        );
      })
      .catch((error: unknown) => {
        const { toast } = toFormError(error, t(`${KEY}.errors.upload`));
        setFormError(t(`${KEY}.errors.upload`));
        if (toast) notify.error(toast);
      });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      locked={busy}
      dismissible
      title={t(`${KEY}.${isReopen ? 'reopenTitle' : 'title'}`)}
      description={t(`${KEY}.${isReopen ? 'reopenDescription' : 'description'}`, {
        client: shown.clientName,
        status: shown.status.name,
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
            {t(`${KEY}.dismiss`)}
          </Button>
          <Button
            color={SECONDARY_COLOR}
            fullWidth
            loading={busy}
            disabled={!target || !enough}
            onClick={submit}
            className="sm:w-auto"
          >
            {t(`${KEY}.confirm`)}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="modal-stagger">
          <CustomSelect
            id="order-target-status"
            data-modal-autofocus
            label={t(`${KEY}.targetLabel`)}
            aria-label={t(`${KEY}.targetLabel`)}
            // Without it the field would LOOK like the first step was already chosen while the
            // confirm stayed disabled — the placeholder is what makes "nothing picked yet" honest.
            placeholderOption={t(`${KEY}.targetPlaceholder`)}
            value={targetId === null ? '' : String(targetId)}
            onChange={(event) => retarget(event.target.value)}
            options={options.map((step) => ({ value: String(step.id), label: step.name }))}
          />
        </div>

        {/* Everything below depends on the chosen target — it grows and shrinks as one block. */}
        <div ref={dynamic} className="flex flex-col gap-4">
          {/* The WALK, spelled out — a jump is several real steps and the admin should see them. */}
          {walk.length > 1 && (
            <p data-flip-id="walk" className="status-step text-sm text-charcoal/60">
              {t(`${KEY}.walk`, { steps: walk.map((step) => step.name).join(' → ') })}
            </p>
          )}

          {/* What the order will be holding once it lands — an amber warning when it TAKES goods
              again (the move can be refused if someone else already has them), a plain note when it
              gives them back. Silent when the reservation doesn't change, so it never claims that
              moving a finished order around frees anything. */}
          {inventory !== 'none' && target && (
            <p
              data-flip-id="inventory"
              className={`status-step rounded-control px-3 py-2 text-sm ${
                inventory === 'reclaim'
                  ? 'bg-amber-50 text-amber-700'
                  : 'bg-charcoal/[0.04] text-charcoal/70'
              }`}
            >
              {t(`${KEY}.${inventory === 'reclaim' ? 'reclaimWarning' : 'releaseNote'}`, {
                status: target.name,
              })}
            </p>
          )}

          {/* Undoing steps destroys their photos — said before it happens, never after. */}
          {willPurge.length > 0 && (
            <p
              data-flip-id="purge"
              className="status-step rounded-control bg-amber-50 px-3 py-2 text-sm text-amber-700"
            >
              {t(`${KEY}.purgeWarning`, {
                steps: willPurge.map((step) => step.name).join(', '),
              })}
            </p>
          )}

          {/* One photo picker per demanding step, all collected in a single pass. Each carries its
              step's identity, so re-aiming the walk keeps the ones it still crosses exactly where
              they are and only animates the difference. */}
          {needsPhotos.map((step) => (
            <OrderEvidencePicker
              key={step.id}
              flipId={`step-${step.id}`}
              className="status-step flex flex-col gap-2"
              label={t(`${KEY}.stepPhotos`, { status: step.name })}
              countLabel={t(`${KEY}.stepCount`, {
                count: stagedFor(step.id).length,
                min: step.minEvidence,
                max: step.maxEvidence,
              })}
              addLabel={t(`${KEY}.addPhotos`)}
              removeLabel={(name) => t(`${KEY}.removePhoto`, { name })}
              photos={stagedFor(step.id)}
              max={step.maxEvidence}
              disabled={busy}
              gridClassName="grid-cols-4 gap-2 sm:grid-cols-6"
              onAdd={(files) => addStepPhotos(step, files)}
              onRemove={(photoId) => removeStepPhoto(step, photoId)}
            />
          ))}
        </div>

        {/* The reopen conflict, per product — a decision needs the numbers, not just a "no". */}
        {conflicts.length > 0 && (
          <ul className="modal-stagger flex flex-col gap-1 rounded-control bg-red-50 px-3 py-2 text-sm text-red-600">
            {conflicts.map((conflict) => (
              <li key={conflict.productId}>
                {t(`${KEY}.conflictLine`, {
                  product: conflict.productName,
                  requested: conflict.requested,
                  available: conflict.available,
                })}
              </li>
            ))}
          </ul>
        )}

        <div className="modal-stagger">
          <FormError message={formError} />
        </div>
      </div>
    </Modal>
  );
};

export default OrderStatusModal;
