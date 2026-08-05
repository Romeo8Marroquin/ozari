import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HiOutlineBanknotes } from 'react-icons/hi2';
import StatCard from './StatCard';

const KEY = 'modules.panel.dashboard.stats';

describe('StatCard', () => {
  it('renders a bare figure when there is no comparison to make', () => {
    render(<StatCard label="Entregas de hoy" value="4" icon={HiOutlineBanknotes} />);
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.queryByText(`${KEY}.delta`)).not.toBeInTheDocument();
  });

  it.each([
    ['up', 26.5],
    ['down', -12],
    ['flat', 0],
  ])('badges a %s month against the previous one', (_tone, deltaPercent) => {
    render(
      <StatCard
        label="Ingresos"
        value="Q 12,400.00"
        icon={HiOutlineBanknotes}
        stat={{ current: 12400, previous: 9800, deltaPercent }}
      />,
    );
    expect(screen.getByText(`${KEY}.delta`)).toBeInTheDocument();
  });

  it('says "sin comparación" instead of inventing a % against a zero month', () => {
    render(
      <StatCard
        label="Ingresos"
        value="Q 500.00"
        icon={HiOutlineBanknotes}
        stat={{ current: 500, previous: 0 }}
      />,
    );
    expect(screen.getByText(`${KEY}.noComparison`)).toBeInTheDocument();
    expect(screen.queryByText(`${KEY}.delta`)).not.toBeInTheDocument();
  });

  it('renders the small-print hint when given one', () => {
    render(
      <StatCard label="Por cobrar" value="Q 3,150.00" icon={HiOutlineBanknotes} hint="7 pedidos" />,
    );
    expect(screen.getByText('7 pedidos')).toBeInTheDocument();
  });
});
