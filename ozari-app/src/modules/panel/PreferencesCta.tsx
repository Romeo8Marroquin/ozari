import { useTranslation } from 'react-i18next';
import { HiOutlineAdjustmentsHorizontal } from 'react-icons/hi2';
import Button from '@components/Button';
import { usePanelNavigate } from './PanelNavContext';

/**
 * The shared "configure preferences" action for a **config** status panel — shown when a form's
 * required reference/preference data is missing (e.g. no seeded event types). It is deliberately
 * NOT a retry: retrying a successful-but-empty request changes nothing; the fix lives in the admin's
 * preferences, which is exactly where this goes (`/panel/preferencias`, Admin-only — and only an
 * Admin can reach a form that shows this panel anyway).
 *
 * It pointed at Settings as a placeholder until the preferences screen existed (2026-07-29).
 */
const PreferencesCta: React.FC = () => {
  const { t } = useTranslation();
  const panelNavigate = usePanelNavigate();
  return (
    <Button
      color="#262626"
      size="sm"
      startIcon={<HiOutlineAdjustmentsHorizontal className="size-4" />}
      onClick={() => panelNavigate('/panel/preferencias')}
    >
      {t('modules.panel.dataStatus.goToPreferences')}
    </Button>
  );
};

export default PreferencesCta;
