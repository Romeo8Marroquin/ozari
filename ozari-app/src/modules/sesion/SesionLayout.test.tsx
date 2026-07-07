import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@tanstack/react-router', () => ({ Outlet: () => <div data-testid="outlet" /> }));

import SesionLayout from './SesionLayout';

describe('SesionLayout', () => {
  it('renders the auth background around the routed content', () => {
    render(<SesionLayout />);
    expect(screen.getByTestId('outlet')).toBeInTheDocument();
  });
});
