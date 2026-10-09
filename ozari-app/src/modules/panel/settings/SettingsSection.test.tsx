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

  it('splits by the SECTION’s width, and makes the card a container of its own', () => {
    // Same reason `SettingRow` pins its classes: this is a layout decision jsdom cannot exercise,
    // and a viewport breakpoint here is what squeezed the card to ~300px at a 793px window — the
    // sidebar and the page padding live between the two, so `md:` was never asking about this box.
    const { container } = render(
      <SettingsSection title="Calendarios" description="d">
        <p>c</p>
      </SettingsSection>,
    );
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).toContain('@container');
    const grid = wrapper.firstElementChild as HTMLElement;
    expect(grid.className).toContain('@min-[48rem]:grid-cols-3');
    expect(grid.className).not.toMatch(/\b(sm|md|lg|xl):grid-cols/);
    // The card is itself a container, which is what lets its rows and field grids answer to the
    // CARD's width (`SettingRow`, `PreferenceSettingsCard`, `PreferenceRowForm`).
    expect(screen.getByText('c').parentElement?.className).toContain('@container');
  });

  it('omits the badge when none is given', () => {
    render(
      <SettingsSection title="Cuenta" description="d">
        <p>c</p>
      </SettingsSection>,
    );
    expect(screen.queryByText('Próximamente')).not.toBeInTheDocument();
  });

  it('is a DESTINATION only when anchored: findable by name, focusable from script, never a Tab stop', () => {
    const { container, rerender } = render(
      <SettingsSection anchor="security" title="Seguridad" description="d">
        <p>c</p>
      </SettingsSection>,
    );
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.dataset.settingsSection).toBe('security');
    expect(wrapper.tabIndex).toBe(-1);

    // Preferencias reuses this scaffold with no anchors — its sections must stay inert.
    rerender(
      <SettingsSection title="Seguridad" description="d">
        <p>c</p>
      </SettingsSection>,
    );
    expect(wrapper).not.toHaveAttribute('data-settings-section');
    expect(wrapper).not.toHaveAttribute('tabindex');
  });
});
