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
 * On success we simply close the modal and leave: closing dismisses the confirmation, and the panel
 * plays its own coordinated exit (the page's exit + the chrome peeling away) and only navigates when
 * that's done — so the whole layout animates out and hides, then login plays its own mount-in. It's
 * the same "exit, then navigate" hand-off a tab change uses, just scoped to the whole chrome. The
 * query cache is cleared AFTER navigating, so the header keeps showing the user during the exit (no
 * placeholder flash). `runPanelExit` resolves immediately under reduced motion, so it just leaves.
 */
const LogoutConfirmModal: React.FC<LogoutConfirmModalProps> = ({ open, onClose }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const runPanelExit = usePanelExit();

  const handleLoggedOut = () => {
    onClose(); // close the confirmation…
    // …then leave: the panel animates itself out, and navigation happens once it's finished.
    void runPanelExit().then(() => {
      navigate({ to: '/sesion/inicio' });
      queryClient.clear();
    });
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
