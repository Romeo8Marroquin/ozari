import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import Button from '@components/Button';
import Modal from '@components/Modal';
import { useLogout } from '@hooks/useLogout';
import { usePanelExit } from '../PanelExitContext';

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
 * On success the exit is choreographed for a smooth hand-off to the login page: the modal dismisses,
 * then (with just a slight overlap) the whole panel plays its coordinated exit — the mirror of its
 * entrance — before we navigate, where the login plays its own mount-in animation. The query cache
 * is cleared only after navigating, so the cached profile stays visible (no placeholder flash).
 */
const LogoutConfirmModal: React.FC<LogoutConfirmModalProps> = ({ open, onClose }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const runPanelExit = usePanelExit();

  const handleLoggedOut = () => {
    const goToLogin = () => {
      navigate({ to: '/sesion/inicio' });
      queryClient.clear();
    };

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      goToLogin();
      return;
    }

    onClose(); // dismiss the modal first…
    // …then, almost immediately (a heavy overlap so the whole sign-out stays quick), play the
    // panel's exit and hand off to login.
    window.setTimeout(() => {
      void runPanelExit().then(goToLogin);
    }, 50);
  };

  const { logout, isPending } = useLogout(handleLoggedOut);

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
