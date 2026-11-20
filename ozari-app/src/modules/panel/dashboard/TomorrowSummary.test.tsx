import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import TomorrowSummary from './TomorrowSummary';

const KEY = 'modules.panel.dashboard.tomorrow';
const period = { from: '2026-11-20T06:00:00.000Z', to: '2026-11-21T06:00:00.000Z' };

describe('TomorrowSummary', () => {
  it('shows ONE figure — the orders going out tomorrow — under the named day', () => {
    render(<TomorrowSummary tomorrow={{ period, deliveries: 2 }} />);
    expect(screen.getByRole('region', { name: `${KEY}.title` })).toBeInTheDocument();
    // The day the API counted, named — so "mañana" is never ambiguous near midnight.
    expect(screen.getByText(/viernes/)).toBeInTheDocument();
    expect(screen.getByText(`${KEY}.orders`)).toBeInTheDocument();
    expect(screen.queryByText(`${KEY}.none`)).not.toBeInTheDocument();
  });

  it('says a day with nothing to deliver in words rather than a zero', () => {
    render(<TomorrowSummary tomorrow={{ period, deliveries: 0 }} />);
    expect(screen.getByText(`${KEY}.none`)).toBeInTheDocument();
    expect(screen.queryByText(`${KEY}.orders`)).not.toBeInTheDocument();
  });
});
