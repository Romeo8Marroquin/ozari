import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import Button from '@components/Button';
import FormError from '@components/FormError';
import Modal from '@components/Modal';

const KEY = 'modules.panel.settings.calendar.confirm';
const SECONDARY_COLOR = '#262626';
const DANGER_COLOR = '#dc2626';

/**
 * Which unlink is being confirmed. ONE token picks the title, the description, the warning AND the
 * button label — the `PreferenceCatalogCard` rule, so the four can never end up describing different
 * acts. A new destructive calendar action is a member here plus its copy, never a second dialog.
 */
export type CalendarConfirmAction = 'googleDisconnect' | 'feedRemove' | 'feedRegenerate';

/**
 * The confirm step in front of every calendar action that BREAKS something already in use.
 *
 * All three are cheap to undo in the sense that you can reconnect or regenerate — but none of them
 * is cheap to undo *silently*, and that is the distinction that earns a dialog: disconnecting stops
 * a calendar somebody relies on from updating, and both feed actions invalidate a URL that is
 * already sitting inside other people's phones, where nothing announces that it died. A tap that
 * reaches other devices is not a tap to take on the way past.
 *
 * **The copy states what the act DOES, never why it is being done** (the `OrderPaymentUndoModal`
 * rule): the outcome first, then the one thing the act could be mistaken for — that events already
 * written stay put, and that a subscription that stops updating does not remove itself from the
 * phone it lives on. Both are things the admin would otherwise discover from somebody else.
 */
const CalendarConfirmModal: React.FC<{
  /** The action being confirmed — absent while the dialog is closed. */
  action?: CalendarConfirmAction;
  pending: boolean;
  /** A failed attempt, shown inline: the admin is looking here, and the dialog stays open to retry. */
  error?: string;
  onConfirm: () => void;
  onClose: () => void;
}> = ({ action, pending, error, onConfirm, onClose }) => {
  const { t } = useTranslation();
  const open = action !== undefined;

  /**
   * ⚠️ The copy a CLOSING dialog shows is the one it was opened with.
   *
   * The modal stays mounted through its exit animation (that is how it gets an exit at all), so it
   * renders at least one more time with `action` already `undefined`. Falling back to a fixed member
   * there — which shipped — meant every dialog turned into "Desconectar Google Calendar" on its way
   * out, whichever action it had actually been: you dismissed the Apple one and watched the Google
   * copy fade away. Remembering the last real action instead keeps the dialog telling the truth
   * until it is gone. Adjusted DURING RENDER (the repo's pattern), never in an effect, which would
   * paint the wrong copy for a frame first.
   */
  const [leaf, setLeaf] = useState<CalendarConfirmAction>('googleDisconnect');
  if (action !== undefined && action !== leaf) {
    setLeaf(action);
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      locked={pending}
      role="alertdialog"
      title={t(`${KEY}.${leaf}.title`)}
      description={t(`${KEY}.${leaf}.description`)}
      footer={
        <>
          <Button
            variant="soft"
            color={SECONDARY_COLOR}
            fullWidth
            onClick={onClose}
            disabled={pending}
            className="sm:w-auto"
          >
            {t(`${KEY}.cancel`)}
          </Button>
          <Button
            color={DANGER_COLOR}
            fullWidth
            loading={pending}
            onClick={onConfirm}
            className="sm:w-auto"
          >
            {t(`${KEY}.${leaf}.confirm`)}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="modal-stagger flex flex-col gap-1.5">
          {/* What this reaches beyond this screen — the calendar that stops updating, the devices
              that go quiet. Amber, like every other "read this before you tap" note in the app. */}
          <div className="rounded-control bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {t(`${KEY}.${leaf}.note`)}
          </div>
          {/* The way back, in small print: it matters only once you have decided, and it must not
              compete with the warning above. */}
          <p className="px-2 text-xs text-charcoal/45">{t(`${KEY}.${leaf}.hint`)}</p>
        </div>
        <div className="modal-stagger">
          <FormError id="calendar-confirm-error" message={error} />
        </div>
      </div>
    </Modal>
  );
};

export default CalendarConfirmModal;
