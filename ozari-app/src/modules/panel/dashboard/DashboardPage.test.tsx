import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PanelPageTransitionContext } from '../PanelPageTransitionContext';

const { useDashboard } = vi.hoisted(() => ({ useDashboard: vi.fn() }));
vi.mock('./useDashboard', () => ({ useDashboard }));

const { navigateTo } = vi.hoisted(() => ({ navigateTo: vi.fn() }));
vi.mock('../PanelNavContext', () => ({ usePanelNavigate: () => navigateTo }));

// The advance dialog has its own suite; here we only need to know it was OPENED with the right move.
const { advanceProps } = vi.hoisted(() => ({ advanceProps: vi.fn() }));
vi.mock('../orders/OrderAdvanceModal', () => ({
  default: (props: { order?: { id: number }; action?: { statusId: number } }) => {
    advanceProps(props);
    return props.order ? <div>stub-advance-{props.order.id}</div> : null;
  },
}));

// The payment dialog has its own suite (and its own query client); here we only need to know the
// page opened it with the right order.
const { paymentProps } = vi.hoisted(() => ({ paymentProps: vi.fn() }));
vi.mock('../orders/OrderPaymentModal', () => ({
  default: (props: { order?: { id: number } }) => {
    paymentProps(props);
    return props.order ? <div>stub-payment-{props.order.id}</div> : null;
  },
}));

// Maps + lifecycle stay REAL — the card's decisions about them are part of what is under test.
import DashboardPage from './DashboardPage';
import type { Dashboard } from './dashboard.types';

const KEY = 'modules.panel.dashboard';

const upNextItem = (overrides: Record<string, unknown> = {}) => ({
  id: 12,
  clientName: 'María López',
  isRegistryClient: true,
  eventType: { id: 1, name: 'Evento familiar' },
  status: { id: 1, name: 'Pendiente', colorKey: 'amber' },
  nextStatus: { id: 5, name: 'En ruta' },
  actions: [
    {
      kind: 'forward' as const,
      statusId: 5,
      statusName: 'En ruta',
      requiresEvidence: false,
      minEvidence: 1,
      maxEvidence: 10,
      requiresReason: false,
      inventoryEffect: 'none' as const,
      purgesEvidence: false,
    },
  ],
  holdsInventory: true,
  paymentStatus: { id: 1, name: 'Pendiente' },
  isPaid: false,
  deliveryAt: '2026-08-01T14:00:00.000Z',
  pickupAt: '2026-08-02T10:00:00.000Z',
  isMine: true,
  itemCount: 25,
  totalAmount: 450,
  currency: { id: 1, iso4217Code: 'GTQ', name: 'Quetzal', symbol: 'Q' },
  event: {
    kind: 'DELIVERY' as const,
    at: '2026-08-01T14:00:00.000Z',
    isOverdue: false,
    minutesUntil: 45,
  },
  deliveryAddress: 'Zona 10, 4a avenida 5-55',
  deliveryContact: '5555-1234',
  ...overrides,
});

const dashboard = (overrides: Partial<Dashboard> = {}): Dashboard =>
  ({
    generatedAt: new Date().toISOString(),
    upNext: [upNextItem()],
    today: { deliveries: 4, collections: 2, overdue: 1, active: 9 },
    month: {
      period: { from: '2026-08-01T06:00:00.000Z', to: '2026-09-01T06:00:00.000Z' },
      revenue: { current: 12400, previous: 9800, deltaPercent: 26.5 },
      orders: { current: 28, previous: 24, deltaPercent: 16.7 },
      averageOrder: { current: 442.86, previous: 408.33, deltaPercent: 8.5 },
      // Deliberately NOT the revenue total: cash in is scoped by payment date, revenue by delivery
      // date, and the gap between them is what "Por cobrar" tracks.
      collected: { current: 10500, previous: 8400, deltaPercent: 25 },
      cancelled: { current: 3, previous: 5, deltaPercent: -40 },
    },
    outstanding: { amount: 3150, orders: 7 },
    revenueTrend: [
      { month: '2026-07', revenue: 9800, orders: 24 },
      { month: '2026-08', revenue: 12400, orders: 28 },
    ],
    topProducts: [{ productId: 3, name: 'Silla Tiffany', quantity: 240, revenue: 4800 }],
    statusSplit: [{ statusId: 1, name: 'Pendiente', colorKey: 'amber', count: 6 }],
    currency: { id: 1, iso4217Code: 'GTQ', name: 'Quetzal', symbol: 'Q' },
    ...overrides,
  }) as Dashboard;

const q = (overrides: Record<string, unknown> = {}) => ({
  data: dashboard(),
  isLoading: false,
  isError: false,
  refetch: vi.fn(),
  ...overrides,
});

// The desktop-breakpoint test REPLACES the global matchMedia; without putting it back, every later
// test loses the suite's reduced-motion mock and runs with GSAP live — which leaves elements
// `visibility: hidden` mid-tween and therefore missing from the a11y tree.
let realMatchMedia: typeof window.matchMedia;
beforeEach(() => {
  vi.clearAllMocks();
  realMatchMedia = window.matchMedia;
  useDashboard.mockReturnValue(q());
});
afterEach(() => {
  window.matchMedia = realMatchMedia;
  vi.restoreAllMocks();
});

describe('DashboardPage', () => {
  it('renders the three questions the screen answers, from ONE query', () => {
    render(<DashboardPage />);
    // Called, not called ONCE: a re-render (the breakpoint hook settles after mount) calls the hook
    // again without issuing a request — "one request for the whole screen" is the query key's
    // guarantee, asserted in `useDashboard.test`, not a render count.
    expect(useDashboard).toHaveBeenCalled();
    expect(screen.getByText(`${KEY}.upNext.title`)).toBeInTheDocument();
    expect(screen.getByText(`${KEY}.today.title`)).toBeInTheDocument();
    expect(screen.getByText(`${KEY}.month.title`)).toBeInTheDocument();
    expect(screen.getByText('María López')).toBeInTheDocument();
  });

  it('formats money with the payload’s OWN currency symbol, never a hardcoded one', () => {
    useDashboard.mockReturnValue(
      q({
        data: dashboard({
          currency: { id: 2, iso4217Code: 'USD', name: 'Dólar', symbol: '$' },
        }),
      }),
    );
    render(<DashboardPage />);
    expect(screen.getByText('$ 12,400.00')).toBeInTheDocument();
  });

  it('shows the section skeletons while the first read is in flight, not an empty page', () => {
    useDashboard.mockReturnValue(q({ data: undefined, isLoading: true }));
    const { container } = render(<DashboardPage />);
    // Real chrome, shimmering bodies — never a blank screen and never the error panel.
    expect(screen.getByText(`${KEY}.upNext.title`)).toBeInTheDocument();
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
    expect(screen.queryByText(`${KEY}.loadError.title`)).not.toBeInTheDocument();
  });

  it('offers a retry on a real failure', async () => {
    const refetch = vi.fn();
    useDashboard.mockReturnValue(q({ data: undefined, isError: true, refetch }));
    render(<DashboardPage />);
    await userEvent.click(screen.getByRole('button', { name: `${KEY}.loadError.retry` }));
    expect(refetch).toHaveBeenCalled();
  });

  it('nudges toward creating an order when there is nothing queued', async () => {
    useDashboard.mockReturnValue(q({ data: dashboard({ upNext: [] }) }));
    render(<DashboardPage />);
    expect(screen.getByText(`${KEY}.upNext.emptyTitle`)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: `${KEY}.upNext.emptyAction` }));
    expect(navigateTo).toHaveBeenCalledWith('/panel/pedidos/nuevo');
  });

  it('opens the order when a card is activated', async () => {
    render(<DashboardPage />);
    await userEvent.click(screen.getByRole('link', { name: `${KEY}.upNext.openAria` }));
    expect(navigateTo).toHaveBeenCalledWith('/panel/pedidos/12');
  });

  it('hands the quick action to the SAME advance dialog the agenda uses', async () => {
    render(<DashboardPage />);
    await userEvent.click(screen.getByRole('button', { name: `${KEY}.upNext.nextStepAria` }));
    await waitFor(() => expect(screen.getByText('stub-advance-12')).toBeInTheDocument());
    // The move handed over is the engine's own forward action, not a locally derived one.
    expect(advanceProps).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: expect.objectContaining({ statusId: 5 }) }),
    );
  });

  it('tapping the quick action does NOT also open the order behind it', async () => {
    render(<DashboardPage />);
    await userEvent.click(screen.getByRole('button', { name: `${KEY}.upNext.nextStepAria` }));
    expect(navigateTo).not.toHaveBeenCalled();
  });

  it('labels EVERY month on a wide card, and thins them only where there is no room', () => {
    // A chart that hides half its axis makes the reader count bars to find a month; a phone has no
    // room for twelve, so the thinning survives exactly where it earns its keep.
    const twelve = Array.from({ length: 12 }, (_, index) => ({
      month: `2026-${String(index + 1).padStart(2, '0')}`,
      revenue: index * 100,
      orders: index,
    }));
    useDashboard.mockReturnValue(q({ data: dashboard({ revenueTrend: twelve }) }));

    // Desktop: `matchMedia` reports every min-width query as matching.
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query.startsWith('(min-width'),
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as unknown as typeof window.matchMedia;

    const { container } = render(<DashboardPage />);
    const axis = container.querySelectorAll('.chart-bar');
    expect(axis).toHaveLength(12);
    // Every label rendered means none of the twelve slots is blank.
    const labels = [...container.querySelectorAll('span')].filter(
      (span) => span.className.includes('flex-1 truncate text-center'),
    );
    expect(labels.filter((span) => span.textContent !== '')).toHaveLength(12);
  });

  it('opens the shared payment dialog from a card', async () => {
    render(<DashboardPage />);
    await userEvent.click(
      screen.getByRole('button', { name: `${KEY}.upNext.payAria` }),
    );
    await waitFor(() => expect(screen.getByText('stub-payment-12')).toBeInTheDocument());
    expect(paymentProps).toHaveBeenLastCalledWith(
      expect.objectContaining({ order: expect.objectContaining({ id: 12 }) }),
    );
  });

  it('closes the payment dialog when it asks to close', async () => {
    render(<DashboardPage />);
    await userEvent.click(screen.getByRole('button', { name: `${KEY}.upNext.payAria` }));
    await waitFor(() => expect(screen.getByText('stub-payment-12')).toBeInTheDocument());

    const calls = paymentProps.mock.calls;
    const { onClose } = calls[calls.length - 1][0] as { onClose: () => void };
    act(() => onClose());
    await waitFor(() => expect(screen.queryByText('stub-payment-12')).not.toBeInTheDocument());
  });

  it('renders the charts and the ranking from the payload', () => {
    const { container } = render(<DashboardPage />);
    expect(container.querySelectorAll('.chart-bar')).toHaveLength(2);
    expect(container.querySelectorAll('.donut-segment')).toHaveLength(1);
    expect(screen.getByText('Silla Tiffany')).toBeInTheDocument();
  });

  it('says so plainly when a chart or a ranking has nothing to show', () => {
    useDashboard.mockReturnValue(
      q({ data: dashboard({ statusSplit: [], topProducts: [] }) }),
    );
    render(<DashboardPage />);
    expect(screen.getByText(`${KEY}.statusSplit.empty`)).toBeInTheDocument();
    expect(screen.getByText(`${KEY}.topProducts.empty`)).toBeInTheDocument();
  });

  it('registers its entrance/exit with the panel transition controller', async () => {
    const register = vi.fn();
    render(
      <PanelPageTransitionContext.Provider value={register}>
        <DashboardPage />
      </PanelPageTransitionContext.Provider>,
    );
    expect(register).toHaveBeenCalledTimes(1);
    const motion = register.mock.calls[0][0] as {
      enter: (options?: { fromCurrent?: boolean }) => void;
      exit: () => Promise<void>;
    };
    // Both directions must run without throwing — a cancelled exit resumes via `fromCurrent`.
    motion.enter();
    motion.enter({ fromCurrent: true });
    await motion.exit();
  });

  it('closes the advance dialog when it asks to close', async () => {
    render(<DashboardPage />);
    await userEvent.click(screen.getByRole('button', { name: `${KEY}.upNext.nextStepAria` }));
    await waitFor(() => expect(screen.getByText('stub-advance-12')).toBeInTheDocument());

    const calls = advanceProps.mock.calls;
    const { onClose } = calls[calls.length - 1][0] as { onClose: () => void };
    act(() => onClose());
    await waitFor(() => expect(screen.queryByText('stub-advance-12')).not.toBeInTheDocument());
  });

  it('keeps the freshness line ticking between fetches, in SECONDS', () => {
    vi.useFakeTimers();
    // 25 seconds old: a minute-resolution label would read "hace 0 minutos" for the data's entire
    // life, which is why this counts seconds.
    const generatedAt = new Date(Date.now() - 25_000).toISOString();
    useDashboard.mockReturnValue(q({ data: dashboard({ generatedAt }) }));
    render(<DashboardPage />);
    expect(screen.getByText(`${KEY}.updated.seconds`)).toBeInTheDocument();

    // The tick advances the label WITHOUT a refetch.
    act(() => vi.advanceTimersByTime(60_000));
    expect(screen.getByText(`${KEY}.updated.minutes`)).toBeInTheDocument();
    vi.useRealTimers();
  });
});
