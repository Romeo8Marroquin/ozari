import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import Button from '@components/Button';
import Modal from '@components/Modal';
import type { CatalogRow } from './preference.types';

const KEY = 'modules.panel.preferences.deleteRow';
const SECONDARY_COLOR = '#262626';
const DANGER_COLOR = '#dc2626';

interface PreferenceRowDeleteModalProps {
  /** The row to remove — absent while the dialog is closed. */
  row?: CatalogRow;
  busy: boolean;
  onClose: () => void;
  onConfirm: (row: CatalogRow) => void;
}

/**
 * The confirm for removing a catalog row.
 *
 * **It names the outcome instead of hedging about it.** A delete either destroys the row or merely
 * unpublishes it, depending on whether anything already points at it — and the row carries that answer
 * (`isReferenced`), so the whole dialog commits to one of the two: *remove* (title, note and button
 * all say removal) or *hide* (it is in use, so it stays and existing records keep their name). Copy
 * that lists both possibilities is copy an admin learns to skip.
 *
 * The flag is a PREVIEW; the server re-decides under the transaction that acts, and the toast reports
 * what actually happened.
 *
 * Kept mounted while it closes, like every dialog here, so the primitive can play its exit.
 */
const PreferenceRowDeleteModal: React.FC<PreferenceRowDeleteModalProps> = ({
  row,
  busy,
  onClose,
  onConfirm,
}) => {
  const { t } = useTranslation();
  const open = row !== undefined;

  const [shown, setShown] = useState<CatalogRow | undefined>(row);
  if (open && shown !== row) {
    setShown(row);
  }
  if (!shown) return null;

  // ONE token picks every string, so the title, the note and the button can never describe different
  // acts (the failure mode of per-string conditions).
  const variant = shown.isReferenced ? 'hide' : 'remove';

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      role="alertdialog"
      locked={busy}
      dismissible
      title={t(`${KEY}.${variant}.title`)}
      description={t(`${KEY}.${variant}.description`, { name: shown.name })}
      footer={
        <>
          <Button
            variant="soft"
            color={SECONDARY_COLOR}
            fullWidth
            disabled={busy}
            onClick={onClose}
            className="sm:w-auto"
          >
            {t(`${KEY}.dismiss`)}
          </Button>
          <Button
            color={DANGER_COLOR}
            fullWidth
            loading={busy}
            onClick={() => onConfirm(shown)}
            className="sm:w-auto"
          >
            {/* The label matches the act: hiding a row in use is not a deletion, and calling it one
                would make the admin think their records lost something. */}
            {t(`${KEY}.${variant}.confirm`)}
          </Button>
        </>
      }
    >
      <p className="modal-stagger rounded-control bg-charcoal/[0.04] px-3 py-2 text-sm text-charcoal/70">
        {t(`${KEY}.${variant}.note`)}
      </p>
    </Modal>
  );
};

export default PreferenceRowDeleteModal;
