import { useTranslation } from 'react-i18next';
import { HiOutlineAdjustmentsHorizontal } from 'react-icons/hi2';
import Button from '@components/Button';
import { usePanelNavigate } from './PanelNavContext';

/**
 * The shared "configure preferences" action for a **config** status panel — shown when a form's
 * required reference/preference data is missing (e.g. no seeded event types). It is deliberately
 * NOT a retry: retrying a successful-but-empty request changes nothing; the fix lives in the
 * admin's preferences. Routes through the panel transition to Settings — the future home of the
 * per-section preferences (products / orders / …), whether that lands as tabs or separate pages.
 * When that UI exists, this button already points at the right place; only its target may narrow.
 */
const PreferencesCta: React.FC = () => {
  const { t } = useTranslation();
  const panelNavigate = usePanelNavigate();
  return (
    <Button
      color="#262626"
      size="sm"
      startIcon={<HiOutlineAdjustmentsHorizontal className="size-4" />}
      onClick={() => panelNavigate('/panel/ajustes')}
    >
      {t('modules.panel.dataStatus.goToPreferences')}
    </Button>
  );
};

export default PreferencesCta;
