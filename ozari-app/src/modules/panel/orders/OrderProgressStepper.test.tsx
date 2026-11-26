import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import OrderProgressStepper from './OrderProgressStepper';

const KEY = 'modules.panel.orders.detail.progress';
const RENTAL = ['Pendiente', 'En ruta', 'Entregado', 'Recolectado', 'Listo'];

const steps = () => screen.getAllByRole('listitem');
const filled = () => steps().filter((step) => step.dataset.filled === 'true');

describe('OrderProgressStepper', () => {
  it('is a real ordered list, NAMED from the catalog, with the current step marked', () => {
    render(
      <OrderProgressStepper progress={{ step: 3, total: 5 }} colorKey="emerald" stepNames={RENTAL} />,
    );
    expect(screen.getByRole('list', { name: `${KEY}.aria` })).toBeInTheDocument();
    expect(steps()).toHaveLength(5);
    expect(filled()).toHaveLength(3);
    expect(steps()[2]).toHaveAttribute('aria-current', 'step');
    expect(steps()[1]).not.toHaveAttribute('aria-current');
    expect(screen.getByText('Recolectado')).toBeInTheDocument();
    // The narrow box's caption speaks for the bar.
    expect(screen.getByText(`${KEY}.caption`)).toBeInTheDocument();
  });

  it('fills in the CURRENT status colour, travelling left to right', () => {
    render(
      <OrderProgressStepper progress={{ step: 2, total: 3 }} colorKey="indigo" stepNames={[]} />,
    );
    const bars = steps().map((step) => step.firstElementChild as HTMLElement);
    expect(bars[0].className).toContain('bg-indigo-400');
    expect(bars[2].className).toContain('bg-charcoal/[0.07]');
    expect(bars.map((bar) => bar.style.transitionDelay)).toEqual(['0ms', '60ms', '120ms']);
  });

  it('never puts a name on the wrong segment — a count mismatch labels them "Paso N"', () => {
    render(
      <OrderProgressStepper progress={{ step: 1, total: 3 }} stepNames={RENTAL} />,
    );
    expect(screen.queryByText('Pendiente')).not.toBeInTheDocument();
    expect(screen.getAllByText(`${KEY}.step`)).toHaveLength(3);
  });

  it('a cancelled order DRAINS the bar it had and says it left the process', () => {
    const { rerender } = render(
      <OrderProgressStepper progress={{ step: 3, total: 5 }} colorKey="emerald" stepNames={RENTAL} />,
    );
    rerender(<OrderProgressStepper colorKey="red" stepNames={RENTAL} />);
    expect(steps()).toHaveLength(5);
    expect(filled()).toHaveLength(0);
    expect(screen.getByText(`${KEY}.outside`)).toBeInTheDocument();
  });

  it('a cancelled order seen cold draws its pipeline from the catalog, empty', () => {
    render(<OrderProgressStepper stepNames={['Pendiente', 'En ruta', 'Entregado']} />);
    expect(steps()).toHaveLength(3);
    expect(filled()).toHaveLength(0);
  });

  it('renders nothing when there is neither a position nor a pipeline to draw', () => {
    const { container } = render(<OrderProgressStepper stepNames={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
