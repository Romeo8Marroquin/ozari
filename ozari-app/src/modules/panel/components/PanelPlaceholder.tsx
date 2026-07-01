import { useTranslation } from 'react-i18next';
import { HiOutlineSquares2X2 } from 'react-icons/hi2';

/**
 * Temporary empty-state for panel sections that don't have real content yet. Keeps the chrome
 * feeling complete and on-brand while the features are built. Swap for the real screen later.
 * Entrance/exit is owned by the panel's body transition (`.panel-screen` in PanelLayout).
 */
const PanelPlaceholder: React.FC<{ section: string }> = ({ section }) => {
  const { t } = useTranslation();

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="flex max-w-md flex-col items-center text-center">
        <span className="grid size-16 place-items-center rounded-2xl bg-gradient-to-br from-cream to-blossom shadow-sm">
          <HiOutlineSquares2X2 className="size-7 text-charcoal/70" />
        </span>
        <span className="mt-5 inline-flex items-center rounded-full bg-charcoal/[0.06] px-3 py-1 text-xs font-medium text-charcoal/60">
          {t('modules.panel.placeholder.badge')}
        </span>
        <h2 className="mt-4 text-2xl font-bold text-charcoal">
          {t('modules.panel.placeholder.title', { section })}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-charcoal/55">
          {t('modules.panel.placeholder.description')}
        </p>
      </div>
    </div>
  );
};

export default PanelPlaceholder;
