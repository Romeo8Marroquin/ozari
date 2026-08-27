import { useTranslation } from 'react-i18next';
import Button from '@components/Button';
import Modal from '@components/Modal';

const KEY = 'modules.sesion.register.terms';

interface TermsModalProps {
  open: boolean;
  onClose: () => void;
  /** The terms as the admin wrote them — newlines and all. Never rendered as HTML. */
  terms: string;
}

/**
 * The terms and conditions, as a reading dialog.
 *
 * A modal rather than a route: the visitor is mid-form, and sending them to another page to read
 * this means abandoning what they have typed. The card keeps its place, the terms open over it, and
 * closing puts them back exactly where they were.
 *
 * The text is rendered as **plain text with its line breaks preserved** (`whitespace-pre-wrap`),
 * never as markup. It is admin-authored, so it is not hostile input — but it also has no reason to
 * carry formatting, and the moment a document like this is interpreted as HTML it becomes an
 * injection surface for whatever the next person pastes into a preferences field.
 *
 * Long terms SCROLL inside the dialog (`Modal` already owns the scroll lock and the focus trap), so
 * the page behind never moves and the acknowledgement button stays reachable at the bottom.
 */
const TermsModal: React.FC<TermsModalProps> = ({ open, onClose, terms }) => {
  const { t } = useTranslation();

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={t(`${KEY}.title`)}
      description={t(`${KEY}.description`)}
      footer={
        <Button size="sm" onClick={onClose}>
          {t(`${KEY}.close`)}
        </Button>
      }
    >
      {/* `max-h` + its own scroller: the dialog stays a readable column on a phone instead of
          growing past the viewport, and the footer button never drifts out of reach. */}
      <div className="max-h-[50vh] overflow-y-auto overscroll-contain pr-1">
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-charcoal/75">{terms}</p>
      </div>
    </Modal>
  );
};

export default TermsModal;
