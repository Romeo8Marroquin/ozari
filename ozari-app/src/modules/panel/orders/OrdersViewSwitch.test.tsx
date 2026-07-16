import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import OrdersViewSwitch from './OrdersViewSwitch';

const setup = (view: 'agenda' | 'historial' = 'agenda') => {
  const onChange = vi.fn();
  render(<OrdersViewSwitch view={view} onChange={onChange} />);
  const tabs = screen.getAllByRole('tab');
  return { onChange, tabs };
};

describe('OrdersViewSwitch', () => {
  it('renders proper tabs semantics with a roving tabindex', () => {
    const { tabs } = setup();
    expect(screen.getByRole('tablist')).toHaveAccessibleName(
      'modules.panel.orders.views.label',
    );
    expect(tabs).toHaveLength(2);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(tabs[0]).toHaveAttribute('tabindex', '0');
    expect(tabs[1]).toHaveAttribute('aria-selected', 'false');
    expect(tabs[1]).toHaveAttribute('tabindex', '-1');
    expect(tabs[1]).toHaveAttribute('aria-controls', 'orders-view-panel');
  });

  it('clicking the inactive tab changes the view; the active one is a no-op', async () => {
    const user = userEvent.setup();
    const { onChange, tabs } = setup();

    await user.click(tabs[1] as HTMLElement);
    expect(onChange).toHaveBeenCalledWith('historial');

    onChange.mockClear();
    await user.click(tabs[0] as HTMLElement);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('ArrowRight/ArrowLeft move AND select (automatic activation), wrapping at the ends', async () => {
    const user = userEvent.setup();
    const { onChange, tabs } = setup();

    (tabs[0] as HTMLElement).focus();
    await user.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenCalledWith('historial');
    expect(tabs[1]).toHaveFocus();

    onChange.mockClear();
    await user.keyboard('{ArrowLeft}');
    // From the still-`agenda`-selected control, ArrowLeft wraps to the other end.
    expect(onChange).toHaveBeenCalledWith('historial');
  });

  it('Home selects the first view, End the last; other keys pass through', async () => {
    const user = userEvent.setup();
    const { onChange, tabs } = setup('historial');

    (tabs[1] as HTMLElement).focus();
    await user.keyboard('{Home}');
    expect(onChange).toHaveBeenCalledWith('agenda');

    onChange.mockClear();
    await user.keyboard('{End}');
    expect(onChange).not.toHaveBeenCalled(); // End = historial, already selected

    await user.keyboard('{Enter}');
    expect(onChange).not.toHaveBeenCalled();
  });
});
