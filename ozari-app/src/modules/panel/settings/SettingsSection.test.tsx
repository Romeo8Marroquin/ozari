import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import SettingsSection from './SettingsSection';

describe('SettingsSection', () => {
  it('renders the title, description, badge and content', () => {
    render(
      <SettingsSection title="Seguridad" description="Protege tu cuenta" badge="Próximamente">
        <p>contenido</p>
      </SettingsSection>,
    );
    expect(screen.getByRole('heading', { name: 'Seguridad' })).toBeInTheDocument();
    expect(screen.getByText('Protege tu cuenta')).toBeInTheDocument();
    expect(screen.getByText('Próximamente')).toBeInTheDocument();
    expect(screen.getByText('contenido')).toBeInTheDocument();
  });

  it('omits the badge when none is given', () => {
    render(
      <SettingsSection title="Cuenta" description="d">
        <p>c</p>
      </SettingsSection>,
    );
    expect(screen.queryByText('Próximamente')).not.toBeInTheDocument();
  });
});
