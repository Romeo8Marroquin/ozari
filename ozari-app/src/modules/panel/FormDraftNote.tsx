import { useTranslation } from 'react-i18next';
import { usePanelNavigate } from './PanelNavContext';

const KEY = 'modules.panel.formDraft';

interface FormDraftNoteProps {
  /** Whether a draft was restored AND the feature is still on for this form. */
  visible: boolean;
  onDiscard: () => void;
}

/**
 * "Recuperamos tu borrador" — the note every create form shows after restoring one.
 *
 * **ONE component for both forms** (owner, 2026-08-26). The product and order forms had grown their
 * own copies with their own i18n leaves and their own wording, which is the same drift the shared
 * document template exists to prevent: two screens describing the same mechanism in different words
 * teach the admin that they are different mechanisms. A third form gets this for free.
 *
 * The copy is deliberately SHORT. The first version spelled out the whole feature — "Restauramos un
 * borrador guardado de este formulario. Puedes desactivar los borradores en Preferencias" — which
 * wrapped onto two lines and pushed "Descartar" onto a third. A note about something that already
 * worked does not need a paragraph; it needs to be readable at a glance and to offer the two things
 * the admin might want: undo this, or stop doing this.
 *
 * **Always mounted**, in a `grid-rows 0fr↔1fr` collapse (the `FormError` trick), so appearing and
 * discarding EASE the space open and closed instead of shoving the sections below. `-mb-6` cancels
 * the parent's column gap while collapsed and transitions back in step with the height. Conditional
 * rendering would pop and shove, and would skip the exit entirely.
 */
const FormDraftNote: React.FC<FormDraftNoteProps> = ({ visible, onDiscard }) => {
  const { t } = useTranslation();
  const panelNavigate = usePanelNavigate();

  return (
    <div
      aria-hidden={!visible}
      inert={!visible}
      className={`grid transition-[grid-template-rows,margin] duration-300 ease-[var(--ease-settle)] motion-reduce:transition-none ${
        visible ? 'grid-rows-[1fr]' : '-mb-6 grid-rows-[0fr]'
      }`}
    >
      <div className="overflow-hidden">
        <div className="reveal-block flex flex-wrap items-center gap-x-4 gap-y-1 rounded-control border border-charcoal/[0.08] bg-charcoal/[0.03] px-4 py-2.5 text-sm text-charcoal/70">
          <span className="min-w-0">{t(`${KEY}.restored`)}</span>
          {/* The two things the admin might want, in the order they might want them: undo THIS
              draft, or stop making them at all. `ml-auto` keeps them right-aligned on a wide row
              and lets them wrap together on a narrow one. */}
          <button
            type="button"
            onClick={onDiscard}
            className="ml-auto cursor-pointer rounded-chip font-medium text-charcoal underline-offset-2 transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-magenta"
          >
            {t(`${KEY}.discard`)}
          </button>
          <button
            type="button"
            onClick={() => panelNavigate('/panel/preferencias')}
            className="cursor-pointer rounded-chip text-charcoal/55 underline underline-offset-2 transition-colors hover:text-charcoal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-magenta"
          >
            {t(`${KEY}.disable`)}
          </button>
        </div>
      </div>
    </div>
  );
};

export default FormDraftNote;
