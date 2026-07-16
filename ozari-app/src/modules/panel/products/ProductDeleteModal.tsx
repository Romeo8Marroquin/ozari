import { useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { HiOutlineExclamationTriangle } from 'react-icons/hi2';
import Button from '@components/Button';
import FormError from '@components/FormError';
import Modal from '@components/Modal';
import { notify } from '@components/notifications/notify';
import { QueryKeys } from '@constants/QueryKeys';
import { getStatus, toFormError } from '@utils/apiError';
import type { Product } from './product.types';
import { useDeleteProduct } from './useDeleteProduct';

const KEY = 'modules.panel.products.detail.deleteModal';
const SECONDARY_COLOR = '#262626';
const DANGER_COLOR = '#dc2626';

interface ProductDeleteModalProps {
  open: boolean;
  onClose: () => void;
  product: Product;
  /** Fired once the deletion is done (or the product was already gone) — the HOST page owns the
   *  departure (it must leave with a PLAIN fade: there is no grid card left to morph onto). */
  onDeleted: () => void;
}

/**
 * The delete confirmation — a destructive, irreversible action, so it's a step the user must
 * explicitly take (the `Modal` primitive: focus-trap, scroll-lock, dismissal suspended while the
 * request is in flight via `locked`). The amber note states the consequence plainly: the product
 * (and its photos) leaves the catalog; the backend decides hard-vs-tombstone per the no-trash
 * policy — invisible to the user either way.
 *
 * On success (and on a 404 — someone else deleted it first; the OUTCOME is identical): the list
 * invalidates and refetches in the background (its pages keep rendering meanwhile — no skeleton
 * flash), the detail entry is marked stale WITHOUT refetching (`refetchType: 'none'` — removing it
 * while the page still observes it would force an immediate refetch → a loading flash + 404 UNDER
 * the exit animation, the bug this replaces; a later history visit refetches, 404s, and gets the
 * honest not-found panel), a toast confirms, and `onDeleted` hands the departure to the host page.
 * Failures per the form doctrine: inline-class errors land in the dialog's banner, ambient ones
 * toast, an outage stays silent (the overlay owns it).
 */
const ProductDeleteModal: React.FC<ProductDeleteModalProps> = ({
  open,
  onClose,
  product,
  onDeleted,
}) => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { deleteProduct, isPending } = useDeleteProduct();
  const [error, setError] = useState<string | undefined>(undefined);

  // A fresh dialog each time it opens — no stale error banner from a previous attempt. React's
  // sanctioned "adjust state during render" pattern (no effect, no cascading render).
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (!open) setError(undefined);
  }

  const leaveDeleted = (): void => {
    onClose();
    notify.success(t(`${KEY}.successToast`), { title: t(`${KEY}.successTitle`) });
    void queryClient.invalidateQueries({ queryKey: [QueryKeys.PRODUCTS] });
    // Stale, but NOT refetched now — the page is still showing this data while it fades out.
    void queryClient.invalidateQueries({
      queryKey: [QueryKeys.PRODUCT, product.id],
      refetchType: 'none',
    });
    onDeleted();
  };

  // No in-flight re-entry guard needed: the confirm button disables itself while `loading`, and
  // the modal is `locked` — there is no path to a second click.
  const confirm = (): void => {
    setError(undefined);
    deleteProduct(product.id, {
      onSuccess: leaveDeleted,
      onError: (failure) => {
        // 404 = the product is ALREADY gone (deleted elsewhere) — the user's goal is met; treat
        // it exactly like success instead of stranding them on a dead page with an error.
        if (axios.isAxiosError(failure) && getStatus(failure) === 404) {
          leaveDeleted();
          return;
        }
        const { inline, toast } = toFormError(failure, t(`${KEY}.errors.fallback`));
        if (inline) setError(inline);
        if (toast) notify.error(toast);
      },
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      locked={isPending}
      title={t(`${KEY}.title`)}
      description={t(`${KEY}.description`, { name: product.name })}
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
        <div
          role="note"
          className="modal-stagger flex items-start gap-2.5 rounded-control bg-amber-50 px-3.5 py-3 text-sm text-amber-700"
        >
          <HiOutlineExclamationTriangle aria-hidden className="mt-0.5 size-5 shrink-0" />
          <p className="leading-relaxed">{t(`${KEY}.warning`)}</p>
        </div>
        <FormError id="product-delete-error" message={error} />
      </div>
    </Modal>
  );
};

export default ProductDeleteModal;
