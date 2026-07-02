import { useTranslation } from 'react-i18next';
import Button from '@components/Button';
import Modal from '@components/Modal';
import { useLogout } from '@hooks/useLogout';
import { useSessionTeardown } from '../hooks/useSessionTeardown';

interface LogoutConfirmModalProps {
  open: boolean;
  onClose: () => void;
}

// The destructive confirm colour, matching the "Cerrar sesión" menu item (red-600).
const DANGER = '#dc2626';

/**
 * Confirmation before signing out. A two-button, non-dismissable confirm: the explicit Cancel
 * (focused by default) is the single way to back out — no redundant ✕/backdrop/Escape. While the
 * request is in flight Cancel is disabled and the confirm button owns the loading spinner (never a
 * full-screen block). Errors surface as a toast (via the axios interceptor) and leave the modal
 * open for a retry.
 *
 * On success we run the shared session teardown (`useSessionTeardown`): it sweeps the modal, plays
 * the panel's coordinated exit, navigates to login, then clears auth + the query cache — the exact
 * same choreography a forced 401 logout uses, so the two never drift. It resolves immediately under
 * reduced motion, so it just leaves.
 */
const LogoutConfirmModal: React.FC<LogoutConfirmModalProps> = ({ open, onClose }) => {
  const { t } = useTranslation();
  const teardown = useSessionTeardown();

  const { logout, isPending } = useLogout(() => void teardown('user'));

  return (
    <Modal
      open={open}
      onClose={onClose}
      role="alertdialog"
      size="sm"
      locked={isPending}
      dismissible={false}
      title={t('modules.panel.logout.title')}
      description={t('modules.panel.logout.message')}
      footer={
        <>
          <Button
            variant="soft"
            color="#262626"
            fullWidth
            onClick={onClose}
            disabled={isPending}
            data-modal-autofocus
            className="sm:w-auto"
          >
            {t('modules.panel.logout.cancel')}
          </Button>
          <Button
            variant="solid"
            color={DANGER}
            fullWidth
            loading={isPending}
            onClick={() => logout()}
            className="sm:w-auto"
          >
            {t('modules.panel.logout.confirm')}
          </Button>
        </>
      }
    />
  );
};

export default LogoutConfirmModal;
