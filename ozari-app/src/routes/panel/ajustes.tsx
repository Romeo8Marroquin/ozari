import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import PanelPlaceholder from '../../modules/panel/components/PanelPlaceholder';

export const Route = createFileRoute('/panel/ajustes')({
  component: RouteComponent,
});

function RouteComponent() {
  const { t } = useTranslation();
  return <PanelPlaceholder section={t('modules.panel.nav.settings')} />;
}
