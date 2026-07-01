import { createFileRoute } from '@tanstack/react-router';
import SettingsPage from '../../modules/panel/settings/SettingsPage';

export const Route = createFileRoute('/panel/ajustes')({
  component: SettingsPage,
});
