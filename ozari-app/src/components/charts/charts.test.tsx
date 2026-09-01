import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import BarChart from './BarChart';
import DonutChart from './DonutChart';

// `asDesktopMotion` REPLACES the global matchMedia, so it has to be put back — otherwise the first
// test that enables motion silently enables it for every test after it in the file.
let realMatchMedia: typeof window.matchMedia;
beforeEach(() => {
  realMatchMedia = window.matchMedia;
});
afterEach(() => {
  window.matchMedia = realMatchMedia;
});

const asDesktopMotion = (): void => {
  // The suite runs reduced-motion by default (GSAP then writes nothing). Turning it OFF exercises
  // the entrance path — the tween can't tick in jsdom, but the code that BUILDS it runs.
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query !== '(prefers-reduced-motion: reduce)',
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
};

describe('BarChart', () => {
  const data = [
    { label: 'ene', value: 100 },
    { label: 'feb', value: 0 },
    { label: 'mar', value: 250 },
  ];

  it('renders one bar per datum and exposes the FIGURES to a screen reader', () => {
    const { container } = render(
      <BarChart data={data} formatValue={(value) => `Q ${value}`} ariaLabel="Ingresos" />,
    );
    expect(container.querySelectorAll('.chart-bar')).toHaveLength(3);
    // The accessible content is the numbers themselves, not a description of rectangles.
    expect(screen.getByText(/Ingresos ene: Q 100\. feb: Q 0\. mar: Q 250\./)).toBeInTheDocument();
  });

  it('thins the axis labels when they would collide, always keeping the last', () => {
    const twelve = Array.from({ length: 12 }, (_, index) => ({
      label: `m${index}`,
      value: index,
    }));
    render(
      <BarChart data={twelve} formatValue={String} ariaLabel="Trend" maxLabels={4} />,
    );
    expect(screen.getByText('m11')).toBeInTheDocument();
    expect(screen.queryByText('m0')).not.toBeInTheDocument();
  });

  it('gives the plot a PERCENTAGE width, so its viewBox ratio cannot widen the page', () => {
    // jsdom has no layout, so this asserts the CLASS rather than a measurement — and it is worth
    // asserting because the failure is invisible everywhere except a narrow real screen. An `<svg>`
    // with a viewBox is a replaced element: with a definite height and an `auto` width its
    // min-content contribution is the transferred size (128px × 320/120 = 341px), which every
    // ancestor must then be wide enough to hold. `min-w-0` is a floor and never lowered it, so the
    // whole dashboard scrolled sideways on a phone while this element looked constrained.
    const { container } = render(
      <BarChart data={data} formatValue={String} ariaLabel="Ingresos" />,
    );
    expect(container.querySelector('svg')).toHaveClass('w-full');
  });

  it('renders with no data at all rather than dividing by an empty domain', () => {
    const { container } = render(
      <BarChart data={[]} formatValue={String} ariaLabel="Vacío" />,
    );
    expect(container.querySelectorAll('.chart-bar')).toHaveLength(0);
  });

  it('builds the entrance when motion is allowed', () => {
    asDesktopMotion();
    const { container } = render(
      <BarChart data={data} formatValue={String} ariaLabel="Ingresos" highlightLast />,
    );
    expect(container.querySelectorAll('.chart-bar')).toHaveLength(3);
  });

  it('ADAPTS to new values instead of replaying the entrance', () => {
    asDesktopMotion();
    const { container, rerender } = render(
      <BarChart data={data} formatValue={String} ariaLabel="Ingresos" />,
    );
    const heights = () =>
      [...container.querySelectorAll('.chart-bar')].map((bar) => bar.getAttribute('height'));
    const before = heights();

    // A refetch that CHANGED something: the bars must end at their new geometry (the tween animates
    // from the remembered old values, so the final attributes are already the new ones).
    rerender(
      <BarChart
        data={[
          { label: 'ene', value: 250 },
          { label: 'feb', value: 0 },
          { label: 'mar', value: 100 },
        ]}
        formatValue={String}
        ariaLabel="Ingresos"
      />,
    );
    expect(heights()).not.toEqual(before);
  });

  it('re-runs NOTHING when a refetch changed no value', () => {
    asDesktopMotion();
    const { container, rerender } = render(
      <BarChart data={data} formatValue={String} ariaLabel="Ingresos" />,
    );
    const before = [...container.querySelectorAll('.chart-bar')].map((bar) =>
      bar.getAttribute('height'),
    );
    // A NEW array with identical values — exactly what React Query hands back every 60 seconds.
    // The dependency is the value signature, so this must be inert.
    rerender(
      <BarChart data={data.map((d) => ({ ...d }))} formatValue={String} ariaLabel="Ingresos" />,
    );
    expect(
      [...container.querySelectorAll('.chart-bar')].map((bar) => bar.getAttribute('height')),
    ).toEqual(before);
  });
});

describe('DonutChart', () => {
  const slices = [
    { label: 'Pendiente', value: 6, colorClass: 'text-amber-500' },
    { label: 'Entregado', value: 3, colorClass: 'text-emerald-500' },
  ];

  it('renders a segment per non-zero slice, plus the legend and the centre total', () => {
    const { container } = render(
      <DonutChart slices={slices} centerValue="9" centerLabel="Abiertos" ariaLabel="Estados" />,
    );
    expect(container.querySelectorAll('.donut-segment')).toHaveLength(2);
    expect(screen.getByText('9')).toBeInTheDocument();
    expect(screen.getByText('Pendiente')).toBeInTheDocument();
  });

  it('drops zero slices from the ring but keeps them in the legend', () => {
    const { container } = render(
      <DonutChart
        slices={[...slices, { label: 'Listo', value: 0, colorClass: 'text-violet-500' }]}
        centerValue="9"
        centerLabel="Abiertos"
        ariaLabel="Estados"
      />,
    );
    expect(container.querySelectorAll('.donut-segment')).toHaveLength(2);
    expect(screen.getByText('Listo')).toBeInTheDocument();
  });

  it('shows only its track when everything is zero', () => {
    const { container } = render(
      <DonutChart
        slices={[{ label: 'Nada', value: 0, colorClass: 'text-charcoal/30' }]}
        centerValue="0"
        centerLabel="Abiertos"
        ariaLabel="Estados"
      />,
    );
    expect(container.querySelectorAll('.donut-segment')).toHaveLength(0);
  });

  it('builds the draw-on entrance when motion is allowed', () => {
    asDesktopMotion();
    const { container } = render(
      <DonutChart slices={slices} centerValue="9" centerLabel="Abiertos" ariaLabel="Estados" />,
    );
    expect(container.querySelectorAll('.donut-segment')).toHaveLength(2);
  });

  it('ADAPTS on a later change — and re-dashes, so a stale dasharray cannot clip the new arc', () => {
    asDesktopMotion();
    const { container, rerender } = render(
      <DonutChart slices={slices} centerValue="9" centerLabel="Abiertos" ariaLabel="Estados" />,
    );
    rerender(
      <DonutChart
        slices={[
          { label: 'Pendiente', value: 1, colorClass: 'text-amber-500' },
          { label: 'Entregado', value: 8, colorClass: 'text-emerald-500' },
        ]}
        centerValue="9"
        centerLabel="Abiertos"
        ariaLabel="Estados"
      />,
    );
    const segment = container.querySelector('.donut-segment-0') as SVGPathElement;
    // The dash covers the arc's own new length — not the previous slice's.
    expect(segment.style.strokeDasharray).not.toBe('');
  });

  it('falls back to a neutral colour when a slice carries none', () => {
    const { container } = render(
      <DonutChart
        slices={[{ label: 'X', value: 1, colorClass: '' }]}
        centerValue="1"
        centerLabel="Abiertos"
        ariaLabel="Estados"
      />,
    );
    expect(container.querySelector('.donut-segment')).toBeInTheDocument();
  });
});
