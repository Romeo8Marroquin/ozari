import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The query drives every state — mock it so we can pin loading / data / empty / error.
const { useOrders } = vi.hoisted(() => ({ useOrders: vi.fn() }));
vi.mock('./useOrders', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./useOrders')>()),
  useOrders,
}));

// The page reads the view from the URL and writes it back via navigate.
const routerState = vi.hoisted(() => ({ search: {} as Record<string, unknown> }));
const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock('@tanstack/react-router', () => ({
  useSearch: () => routerState.search,
  useNavigate: () => navigate,
}));

// The sentinel's own behaviour has its own suite; here we pin WHEN the page disarms it.
const { useInfiniteScrollSentinel } = vi.hoisted(() => ({
  useInfiniteScrollSentinel: vi.fn(() => vi.fn()),
}));
vi.mock('@hooks/useInfiniteScrollSentinel', () => ({ useInfiniteScrollSentinel }));

// The panel transition registration — the page's enter/exit pair is exercised directly.
const { usePanelPageMotion } = vi.hoisted(() => ({ usePanelPageMotion: vi.fn() }));
vi.mock('../PanelPageTransitionContext', () => ({ usePanelPageMotion }));

// Spy on the motion helpers: the append choreography's `.order-appended` tags are deliberately
// TRANSIENT (cleared in the same commit after the stagger fires), so tests assert the stagger
// calls, not the classes. Immediate resolution keeps the skeleton sweep flow synchronous-ish.
const { staggerIn, staggerOut } = vi.hoisted(() => ({
  staggerIn: vi.fn(() => Promise.resolve()),
  staggerOut: vi.fn(() => Promise.resolve()),
}));
vi.mock('../pageMotion', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../pageMotion')>()),
  staggerIn,
  staggerOut,
}));

import { PanelNavContext, type PanelNav } from '../PanelNavContext';
import type { OrderListItem } from './order.types';
import OrdersPage from './OrdersPage';

const localIso = (value: string): string => new Date(value).toISOString();

const todayAt = (hour: number): string => {
  const date = new Date();
  date.setHours(hour, 0, 0, 0);
  return date.toISOString();
};

const daysFromNow = (days: number, hour = 10): string => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(hour, 0, 0, 0);
  return date.toISOString();
};

const order = (id: number, deliveryAt: string, name = `Cliente ${id}`): OrderListItem => ({
  id,
  clientName: name,
  isRegistryClient: false,
  eventType: { id: 1, name: 'Evento familiar' },
  status: { id: 1, name: 'Pendiente' },
  paymentStatus: { id: 1, name: 'Pendiente' },
  deliveryAt,
  pickupAt: deliveryAt,
  itemCount: 2,
  totalAmount: 100,
  currency: { id: 1, iso4217Code: 'GTQ', name: 'Quetzal', symbol: 'Q' },
});

type State = {
  data?: { orders: OrderListItem[]; pagination?: { page: number; pageSize: number; total: number; totalPages: number } };
  isLoading?: boolean;
  isError?: boolean;
  isFetching?: boolean;
  refetch?: () => void;
  fetchNextPage?: () => void;
  hasNextPage?: boolean;
  isFetchingNextPage?: boolean;
};

const buildState = (state: State) => ({
  data: state.data,
  isLoading: state.isLoading ?? false,
  isError: state.isError ?? false,
  isFetching: state.isFetching ?? false,
  refetch: state.refetch ?? vi.fn(),
  fetchNextPage: state.fetchNextPage ?? vi.fn(),
  hasNextPage: state.hasNextPage ?? false,
  isFetchingNextPage: state.isFetchingNextPage ?? false,
});

const setOrders = (state: State) => {
  useOrders.mockReturnValue(buildState(state));
};

/** View-aware mock — the real hook is keyed per view (each has its own cache entry). */
const setOrdersByView = (states: Record<'agenda' | 'historial', State>) => {
  useOrders.mockImplementation((view: 'agenda' | 'historial') => buildState(states[view]));
};

const paginated = (orders: OrderListItem[], total = orders.length) => ({
  orders,
  pagination: { page: 1, pageSize: 20, total, totalPages: Math.max(1, Math.ceil(total / 20)) },
});

const lastSentinelCall = () => {
  const calls = (useInfiniteScrollSentinel as unknown as { mock: { calls: unknown[][] } }).mock
    .calls;
  return calls[calls.length - 1]?.[0] as { onReach: () => void; disabled: boolean };
};

beforeEach(() => {
  routerState.search = {};
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('OrdersPage', () => {
  it('cold load shows the skeleton agenda and disarms the sentinel', () => {
    setOrders({ isLoading: true });
    render(<OrdersPage />);

    expect(screen.getByRole('status')).toHaveAccessibleName('modules.panel.orders.loading');
    expect(lastSentinelCall().disabled).toBe(true);
    // The chrome is up even while loading — the view switch must stay reachable.
    expect(screen.getByRole('tablist')).toBeInTheDocument();
  });

  it('the "Nuevo pedido" button navigates to the create page through the panel transition', async () => {
    const user = userEvent.setup();
    const navigateTo = vi.fn();
    const nav: PanelNav = { navigateTo, pending: null };
    setOrders({ data: paginated([order(1, todayAt(10))]) });
    render(
      <PanelNavContext.Provider value={nav}>
        <OrdersPage />
      </PanelNavContext.Provider>,
    );
    await user.click(screen.getByRole('button', { name: 'modules.panel.orders.newOrder' }));
    expect(navigateTo).toHaveBeenCalledWith('/panel/pedidos/nuevo');
  });

  it('on mount the chrome rises (app-wide) while the body enters LATERALLY, even on first load/refresh', () => {
    setOrders({ isLoading: true });
    render(<OrdersPage />);

    // The page frame (lead + switch) rises with the app-wide language…
    expect(staggerIn).toHaveBeenCalledWith(expect.anything(), '.orders-chrome');
    // …while the body content (the skeleton here) slides in from the side — never bottom-up.
    expect(staggerIn).toHaveBeenCalledWith(expect.anything(), '.reveal-item', { from: 'right' });
  });

  it('resolves the cold skeleton into content (sweep out → body in) and re-arms on a re-entered load', async () => {
    setOrders({ isLoading: true });
    const { rerender } = render(<OrdersPage />);
    expect(screen.getByRole('status')).toBeInTheDocument();

    // The data lands: the skeleton sweeps out LATERALLY (a plain cold load uses the forward
    // direction — out to the left), then the tickets enter from the right.
    setOrders({ data: paginated([order(1, todayAt(10))]) });
    rerender(<OrdersPage />);
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    expect(staggerOut).toHaveBeenCalledWith(expect.anything(), '.orders-skel', { to: 'left' });
    expect(staggerIn).toHaveBeenCalledWith(expect.anything(), '.reveal-item', { from: 'right' });
    expect(screen.getByText('Cliente 1')).toBeInTheDocument();

    // A re-entered cold load (cache gone) re-arms the skeleton.
    setOrders({ isLoading: true });
    rerender(<OrdersPage />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('a resolved agenda renders day-grouped tickets with relative + dated headers and the count', async () => {
    setOrders({
      data: paginated([
        order(1, todayAt(10)),
        order(2, todayAt(15)),
        order(3, daysFromNow(1)),
        order(4, localIso('2026-12-25T10:00:00')),
      ]),
    });
    render(<OrdersPage />);

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    const headers = screen.getAllByRole('heading', { level: 2 });
    expect(headers[0]).toHaveTextContent('modules.panel.orders.day.today');
    expect(headers[1]).toHaveTextContent('modules.panel.orders.day.tomorrow');
    expect(headers[2]).toHaveTextContent(/25 de diciembre/);
    expect(screen.getByText('Cliente 1')).toBeInTheDocument();
    expect(screen.getByText('Cliente 4')).toBeInTheDocument();
    // All rows shown ⇒ the "all" count key.
    expect(screen.getByText('modules.panel.orders.count.all')).toBeInTheDocument();
    // Populated + no next page ⇒ the sentinel stays disarmed (nothing to fetch).
    expect(lastSentinelCall().disabled).toBe(true);
  });

  it('a partially-loaded list arms the sentinel and shows the partial count', async () => {
    const fetchNextPage = vi.fn();
    setOrders({
      data: paginated([order(1, todayAt(10))], 30),
      hasNextPage: true,
      fetchNextPage,
    });
    render(<OrdersPage />);

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    expect(screen.getByText('modules.panel.orders.count.partial')).toBeInTheDocument();
    const sentinel = lastSentinelCall();
    expect(sentinel.disabled).toBe(false);
    sentinel.onReach();
    expect(fetchNextPage).toHaveBeenCalled();
  });

  it('an appending page shows shimmer rows, then staggers the landed tickets in', async () => {
    setOrders({
      data: paginated([order(1, todayAt(10))], 3),
      hasNextPage: true,
      isFetchingNextPage: true,
    });
    const { container, rerender } = render(<OrdersPage />);

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    expect(container.querySelectorAll('.append-skel')).toHaveLength(4);
    expect(staggerIn).toHaveBeenCalledWith(expect.anything(), '.append-skel');
    expect(lastSentinelCall().disabled).toBe(true);

    // The page lands: the rows past the baseline stagger in as `.order-appended` (the tags are
    // transient — cleared right after the stagger captures the nodes — so assert the call).
    setOrders({
      data: paginated([order(1, todayAt(10)), order(2, todayAt(12)), order(3, daysFromNow(2))], 3),
    });
    rerender(<OrdersPage />);
    expect(container.querySelectorAll('.append-skel')).toHaveLength(0);
    expect(staggerIn).toHaveBeenCalledWith(expect.anything(), '.order-appended');
    expect(screen.getByText('Cliente 3')).toBeInTheDocument();
  });

  it('the empty agenda gets its own celebration panel; the chrome stays', async () => {
    setOrders({ data: paginated([]) });
    render(<OrdersPage />);

    await waitFor(() =>
      expect(screen.getByText('modules.panel.orders.empty.agenda.title')).toBeInTheDocument(),
    );
    expect(screen.getByRole('tablist')).toBeInTheDocument();
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'orders-tab-agenda');
  });

  it('the history view reads the URL, labels its panel, and gets its own empty copy', async () => {
    routerState.search = { view: 'historial' };
    setOrders({ data: paginated([]) });
    render(<OrdersPage />);

    await waitFor(() =>
      expect(screen.getByText('modules.panel.orders.empty.history.title')).toBeInTheDocument(),
    );
    expect(screen.getByRole('tabpanel')).toHaveAttribute(
      'aria-labelledby',
      'orders-tab-historial',
    );
    expect(useOrders).toHaveBeenLastCalledWith('historial');
  });

  it('switching views writes the URL (agenda = a clean search) without the panel transition', async () => {
    const user = userEvent.setup();
    setOrders({ data: paginated([order(1, todayAt(10))]) });
    const first = render(<OrdersPage />);
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());

    await user.click(screen.getAllByRole('tab')[1] as HTMLElement);
    expect(navigate).toHaveBeenCalledWith({ search: { view: 'historial' }, viewTransition: false });
    first.unmount();

    routerState.search = { view: 'historial' };
    setOrders({ data: paginated([order(1, todayAt(10))]) });
    render(<OrdersPage />);
    await user.click(screen.getAllByRole('tab')[0] as HTMLElement);
    expect(navigate).toHaveBeenLastCalledWith({ search: {}, viewTransition: false });
  });

  it('a view switch is a body page-transition: the old content exits, THEN the new view enters', async () => {
    setOrders({ data: paginated([order(1, todayAt(10))]) });
    const { rerender } = render(<OrdersPage />);
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    staggerIn.mockClear();
    staggerOut.mockClear();
    // Hold the exit open so the intermediate state is observable.
    let releaseExit = (): void => {};
    staggerOut.mockImplementationOnce(() => new Promise<void>((resolve) => { releaseExit = resolve; }));

    // The URL flips to historial (a cached view: data answers instantly after the swap).
    routerState.search = { view: 'historial' };
    setOrdersByView({
      agenda: { data: paginated([order(1, todayAt(10))]) },
      historial: { data: paginated([order(2, daysFromNow(-3))]) },
    });
    rerender(<OrdersPage />);

    // The exit plays over the current body first — LATERAL, toward the left (forward move) —
    // while the old view is still displayed…
    expect(staggerOut).toHaveBeenCalledWith(expect.anything(), '.reveal-item', { to: 'left' });
    expect(useOrders).toHaveBeenLastCalledWith('agenda');
    expect(screen.getByText('Cliente 1')).toBeInTheDocument();

    // …and only when it completes does the displayed view catch up + the new body enter from the
    // side the motion came from.
    await act(async () => releaseExit());
    expect(useOrders).toHaveBeenLastCalledWith('historial');
    expect(staggerIn).toHaveBeenCalledWith(expect.anything(), '.reveal-item', { from: 'right' });
    expect(screen.getByText('Cliente 2')).toBeInTheDocument();
    expect(screen.getByRole('tabpanel')).toHaveAttribute(
      'aria-labelledby',
      'orders-tab-historial',
    );

    // The return leg mirrors: out to the RIGHT, in from the LEFT.
    staggerIn.mockClear();
    staggerOut.mockClear();
    routerState.search = {};
    rerender(<OrdersPage />);
    expect(staggerOut).toHaveBeenCalledWith(expect.anything(), '.reveal-item', { to: 'right' });
    await waitFor(() =>
      expect(staggerIn).toHaveBeenCalledWith(expect.anything(), '.reveal-item', { from: 'left' }),
    );
    expect(screen.getByText('Cliente 1')).toBeInTheDocument();
  });

  it('a BACKWARD uncached swap mirrors the lateral resolve (skeleton out right, content in from left)', async () => {
    routerState.search = { view: 'historial' };
    setOrders({ data: paginated([order(1, todayAt(10))]) });
    const { rerender } = render(<OrdersPage />);
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());

    routerState.search = {};
    setOrdersByView({
      historial: { data: paginated([order(1, todayAt(10))]) },
      agenda: { isLoading: true },
    });
    rerender(<OrdersPage />);
    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument());

    staggerIn.mockClear();
    staggerOut.mockClear();
    setOrdersByView({
      historial: { data: paginated([order(1, todayAt(10))]) },
      agenda: { data: paginated([]) },
    });
    rerender(<OrdersPage />);
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    expect(staggerOut).toHaveBeenCalledWith(expect.anything(), '.orders-skel', { to: 'right' });
    expect(staggerIn).toHaveBeenCalledWith(expect.anything(), '.reveal-item', { from: 'left' });
  });

  it('flipping back mid-exit cancels the swap and settles the body from the current frame', async () => {
    setOrders({ data: paginated([order(1, todayAt(10))]) });
    const { rerender } = render(<OrdersPage />);
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    staggerIn.mockClear();
    let releaseExit = (): void => {};
    staggerOut.mockImplementationOnce(() => new Promise<void>((resolve) => { releaseExit = resolve; }));

    // Switch away… then flip straight back while the exit is still playing.
    routerState.search = { view: 'historial' };
    rerender(<OrdersPage />);
    routerState.search = {};
    rerender(<OrdersPage />);

    // The recovery entrance resumes from the half-faded frame; the pending flip must be dead.
    expect(staggerIn).toHaveBeenCalledWith(expect.anything(), '.reveal-item', {
      fromCurrent: true,
    });
    await act(async () => releaseExit());
    expect(useOrders).toHaveBeenLastCalledWith('agenda');
    expect(screen.getByText('Cliente 1')).toBeInTheDocument();
  });

  it('a switch to an UNCACHED view exits the old body, then the skeleton enters (never pops)', async () => {
    setOrders({ data: paginated([order(1, todayAt(10))]) });
    const { rerender } = render(<OrdersPage />);
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    staggerOut.mockClear();
    let releaseExit = (): void => {};
    staggerOut.mockImplementationOnce(() => new Promise<void>((resolve) => { releaseExit = resolve; }));

    // No cache for historial: after the swap the query is a cold load (the agenda cache lives on).
    routerState.search = { view: 'historial' };
    setOrdersByView({
      agenda: { data: paginated([order(1, todayAt(10))]) },
      historial: { isLoading: true },
    });
    rerender(<OrdersPage />);

    // While the old body exits (laterally), no skeleton yet — the swap hasn't landed.
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByText('Cliente 1')).toBeInTheDocument();
    expect(staggerOut).toHaveBeenCalledWith(expect.anything(), '.reveal-item', { to: 'left' });

    await act(async () => releaseExit());
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(lastSentinelCall().disabled).toBe(true);

    // The gesture keeps travelling: when the uncached view resolves, the skeleton sweeps out the
    // way we were heading and the content enters from the swap's side — never a vertical snap.
    staggerIn.mockClear();
    staggerOut.mockClear();
    setOrdersByView({
      agenda: { data: paginated([order(1, todayAt(10))]) },
      historial: { data: paginated([]) },
    });
    rerender(<OrdersPage />);
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    expect(staggerOut).toHaveBeenCalledWith(expect.anything(), '.orders-skel', { to: 'left' });
    expect(staggerIn).toHaveBeenCalledWith(expect.anything(), '.reveal-item', { from: 'right' });
    expect(screen.getByText('modules.panel.orders.empty.history.title')).toBeInTheDocument();
  });

  it('a cold error renders the error panel and retries through refetch', async () => {
    const user = userEvent.setup();
    const refetch = vi.fn();
    setOrders({ isError: true, refetch });
    render(<OrdersPage />);

    await waitFor(() =>
      expect(screen.getByText('modules.panel.orders.error.title')).toBeInTheDocument(),
    );
    await user.click(screen.getByText('modules.panel.orders.error.retry'));
    expect(refetch).toHaveBeenCalled();
  });

  it('a failed NEXT page keeps the list, offers an inline retry, and disarms the sentinel', async () => {
    const user = userEvent.setup();
    const fetchNextPage = vi.fn();
    setOrders({
      data: paginated([order(1, todayAt(10))], 30),
      isError: true,
      hasNextPage: true,
      fetchNextPage,
    });
    render(<OrdersPage />);

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    expect(screen.getByText('Cliente 1')).toBeInTheDocument();
    expect(screen.getByText('modules.panel.orders.nextPage.error')).toBeInTheDocument();
    expect(lastSentinelCall().disabled).toBe(true);

    await user.click(screen.getByText('modules.panel.orders.nextPage.retry'));
    expect(fetchNextPage).toHaveBeenCalled();
  });

  it('renders no count line without pagination meta', async () => {
    setOrders({ data: { orders: [order(1, todayAt(10))] } });
    render(<OrdersPage />);

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    expect(screen.queryByText(/modules\.panel\.orders\.count/)).not.toBeInTheDocument();
  });

  it('registers its enter/exit motion pair with the panel', async () => {
    setOrders({ data: paginated([order(1, todayAt(10))]) });
    render(<OrdersPage />);

    const motion = usePanelPageMotion.mock.calls[0]?.[0] as {
      enter: (options?: object) => Promise<void>;
      exit: () => Promise<void>;
    };
    expect(motion).toBeDefined();
    await motion.enter({ fromCurrent: true });
    await motion.exit();
  });
});
