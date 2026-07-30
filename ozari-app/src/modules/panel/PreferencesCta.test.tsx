import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PanelNavContext, type PanelNav } from './PanelNavContext';
import PreferencesCta from './PreferencesCta';

describe('PreferencesCta', () => {
  it('routes to the PREFERENCES screen through the panel transition', async () => {
    const navigateTo = vi.fn();
    const nav: PanelNav = { navigateTo, pending: null };
    render(
      <PanelNavContext.Provider value={nav}>
        <PreferencesCta />
      </PanelNavContext.Provider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'modules.panel.dataStatus.goToPreferences' }));
    // It pointed at Ajustes as a placeholder until the preferences screen existed (2026-07-29).
    expect(navigateTo).toHaveBeenCalledWith('/panel/preferencias');
  });
});
