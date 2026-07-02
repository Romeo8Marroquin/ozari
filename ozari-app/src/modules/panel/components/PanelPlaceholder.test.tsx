import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import PanelPlaceholder from './PanelPlaceholder';

describe('PanelPlaceholder', () => {
  it('renders the coming-soon empty state', () => {
    render(<PanelPlaceholder section="Pedidos" />);
    // i18n mock returns keys.
    expect(screen.getByText('modules.panel.placeholder.badge')).toBeInTheDocument();
    expect(screen.getByRole('heading')).toHaveTextContent('modules.panel.placeholder.title');
    expect(screen.getByText('modules.panel.placeholder.description')).toBeInTheDocument();
  });
});
