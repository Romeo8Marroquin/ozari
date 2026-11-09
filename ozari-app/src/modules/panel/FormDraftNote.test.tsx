import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import FormDraftNote from './FormDraftNote';
import { PanelNavContext } from './PanelNavContext';

const K = 'modules.panel.formDraft';

const renderNote = (props: Partial<React.ComponentProps<typeof FormDraftNote>> = {}) => {
  const navigateTo = vi.fn();
  const onDiscard = vi.fn();
  render(
    <PanelNavContext.Provider value={{ navigateTo, pending: null }}>
      <FormDraftNote visible onDiscard={onDiscard} {...props} />
    </PanelNavContext.Provider>,
  );
  return { navigateTo, onDiscard };
};

describe('FormDraftNote', () => {
  it('offers to discard the draft, or to switch drafts off in Preferencias', async () => {
    const { navigateTo, onDiscard } = renderNote();
    expect(screen.getByText(`${K}.restored`)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: `${K}.discard` }));
    expect(onDiscard).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: `${K}.disable` }));
    expect(navigateTo).toHaveBeenCalledWith('/panel/preferencias');
  });

  it('speaks in a form’s own words, and offers no switch where there is none', () => {
    renderNote({ restoredLabel: 'Retomamos tu pedido', discardLabel: 'Vaciar', canDisable: false });
    expect(screen.getByText('Retomamos tu pedido')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Vaciar' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: `${K}.disable` })).not.toBeInTheDocument();
  });

  it('folds away (and goes inert) while there is nothing restored', () => {
    const { container } = render(<FormDraftNote visible={false} onDiscard={vi.fn()} />);
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
    expect(container.firstElementChild).toHaveClass('grid-rows-[0fr]');
  });
});
