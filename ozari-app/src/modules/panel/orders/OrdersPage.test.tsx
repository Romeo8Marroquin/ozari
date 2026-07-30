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

// Role gate for the "Nuevo pedido" affordance — Admin (true) by default; a driver test flips it off.
const { useHasRole } = vi.hoisted(() => ({ useHasRole: vi.fn(() => true) }));
vi.mock('@hooks/useRole', () => ({ useHasRole }));

// Spy on the motion helpers: the append choreography's `.order-appended` tags are deliberately
// TRANSIENT (cleared in the same commit after the stagger fires), so tests assert the stagger
// calls, not the classes. Immediate resolution keeps the skeleton sweep flow synchronous-ish.
const { staggerIn, staggerOut, growRowsIn, collapseRowsOut, fadeUpIn } = vi.hoisted(() => ({
  staggerIn: vi.fn(() => Promise.resolve()),
  staggerOut: vi.fn(() => Promise.resolve()),
  growRowsIn: vi.fn(),
  collapseRowsOut: vi.fn(() => Promise.resolve()),
  fadeUpIn: vi.fn(),
}));
vi.mock('../pageMotion', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../pageMotion')>()),
  staggerIn,
  staggerOut,
  growRowsIn,
  collapseRowsOut,
  fadeUpIn,
}));

// The confirm dialog owns the mutation + upload hooks (its own suite covers them); here it stands in
// as a marker so the page's job — handing the TAPPED action to it — is what's asserted.
vi.mock('./OrderAdvanceModal', () => ({
  default: ({
    order,
    action,
    onClose,
  }: {
    order?: { id: number };
    action?: { statusName: string };
    onClose: () => void;
  }) =>
    order && action ? (
      <div data-testid="advance-modal">
        {`${order.id}:${action.statusName}`}
        <button type="button" onClick={onClose}>
          cerrar
        </button>
      </div>
    ) : null,
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

const order = (
  id: number,
  deliveryAt: string,
  name = `Cliente ${id}`,
  over: Partial<OrderListItem> = {},
): OrderListItem => ({
  id,
  clientName: name,
  isRegistryClient: false,
  eventType: { id: 1, name: 'Evento familiar' },
  status: { id: 1, name: 'Pendiente' },
  paymentStatus: { id: 1, name: 'Pendiente' },
  deliveryAt,
  pickupAt: deliveryAt,
  isMine: false,
  actions: [],
  holdsInventory: true,
  itemCount: 2,
  totalAmount: 100,
  currency: { id: 1, iso4217Code: 'GTQ', name: 'Quetzal', symbol: 'Q' },
  ...over,
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
  useHasRole.mockReturnValue(true); // Admin by default; the driver test opts out
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

  it('resolves the cold skeleton PER-ROW (crossfade in place, orphans out, headers in) and re-arms on a re-entered load', async () => {
    setOrders({ isLoading: true });
    const { rerender } = render(<OrdersPage />);
    expect(screen.getByRole('status')).toBeInTheDocument();

    // The data lands: each order slot's SkeletonFade crossfades its ticket IN PLACE (products
    // parity — NOT a whole-skeleton sweep). The page only sweeps the surplus rows + day/owner
    // headers IN (`.orders-enter`) and the leftover skeleton rows OUT (`.orders-skel-orphan`).
    setOrders({ data: paginated([order(1, todayAt(10))]) });
    rerender(<OrdersPage />);
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    // Leftover skeleton rows COLLAPSE out; the day/owner headers + count GROW in — both smoothly,
    // no jump. The per-slot ticket crossfade is owned by SkeletonFade.
    expect(collapseRowsOut).toHaveBeenCalledWith(expect.anything(), '.orders-skel-orphan');
    expect(growRowsIn).toHaveBeenCalledWith(expect.anything(), '.orders-enter');
    // The total is withheld until the skeleton fully clears, then FADES into its FINAL place (a gentle
    // fade + tiny rise, no wipe) — never flashing at a transient position under the departing orphans.
    expect(fadeUpIn).toHaveBeenCalledWith(expect.anything(), '.orders-settle-in');
    expect(screen.getByText('modules.panel.orders.count.all')).toBeInTheDocument();
    // The old whole-skeleton lateral sweep is gone.
    expect(staggerOut).not.toHaveBeenCalledWith(expect.anything(), '.orders-skel', expect.anything());
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

  it('splits the agenda into Mis pedidos / El resto bands when ownership is mixed, hides them when uniform', async () => {
    setOrders({
      data: paginated([
        order(1, todayAt(9), 'Cliente 1', { isMine: true }),
        order(2, todayAt(12), 'Cliente 2', { isMine: false }),
      ]),
    });
    const { rerender } = render(<OrdersPage />);
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    expect(screen.getByText('modules.panel.orders.owner.mine')).toBeInTheDocument();
    expect(screen.getByText('modules.panel.orders.owner.rest')).toBeInTheDocument();

    // A uniform list (nothing to tell apart) drops the owner headers. A refetch over the WARM list
    // is a two-phase diff now (rows out, then the new list commits), so it lands asynchronously.
    setOrders({ data: paginated([order(3, todayAt(9), 'Cliente 3', { isMine: false })]) });
    rerender(<OrdersPage />);
    await waitFor(() =>
      expect(screen.queryByText('modules.panel.orders.owner.mine')).not.toBeInTheDocument(),
    );
    expect(screen.queryByText('modules.panel.orders.owner.rest')).not.toBeInTheDocument();
  });

  it('hides the "Nuevo pedido" affordance for a non-admin (a Driver cannot create orders)', async () => {
    useHasRole.mockReturnValue(false);
    setOrders({ data: paginated([order(1, todayAt(9), 'Cliente 1', { isMine: true })]) });
    render(<OrdersPage />);
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    expect(
      screen.queryByRole('button', { name: 'modules.panel.orders.newOrder' }),
    ).not.toBeInTheDocument();
  });

  it('shows the forward quick action when the lifecycle engine offered one', async () => {
    // `actions` is the ONLY trigger — the page never re-derives who may advance what.
    setOrders({
      data: paginated([
        order(1, todayAt(9), 'Cliente 1', {
          isMine: true,
          actions: [
            {
              kind: 'forward',
              statusId: 5,
              statusName: 'En ruta',
              requiresEvidence: false,
              minEvidence: 1,
              maxEvidence: 10,
              requiresReason: false,
              inventoryEffect: 'none',
              purgesEvidence: false,
            },
          ],
        }),
      ]),
    });
    render(<OrdersPage />);
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    const advance = screen.getByRole('button', {
      name: /modules\.panel\.orders\.ticket\.nextStepAria/,
    });
    expect(advance).toBeInTheDocument();

    // Tapping it hands THAT order + THAT offered action to the confirm dialog.
    expect(screen.queryByTestId('advance-modal')).not.toBeInTheDocument();
    await userEvent.click(advance);
    expect(screen.getByTestId('advance-modal')).toHaveTextContent('1:En ruta');

    // …and dismissing it clears the pending move (the next tap starts clean).
    await userEvent.click(screen.getByRole('button', { name: 'cerrar' }));
    expect(screen.queryByTestId('advance-modal')).not.toBeInTheDocument();
  });

  it('opens an order through the PANEL transition, not a raw jump', async () => {
    const navigateTo = vi.fn();
    setOrders({ data: paginated([order(7, todayAt(9), 'Cliente 7')]) });
    render(
      <PanelNavContext.Provider value={{ navigateTo, pending: null } as PanelNav}>
        <OrdersPage />
      </PanelNavContext.Provider>,
    );
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());

    await userEvent.click(screen.getAllByRole('link')[0]);
    expect(navigateTo).toHaveBeenCalledWith('/panel/pedidos/7');
  });

  it('sweeps in the surplus rows when a cold load resolves to MORE than the skeleton count', async () => {
    setOrders({ isLoading: true });
    const { rerender } = render(<OrdersPage />);
    // Resolve with more orders than skeleton slots (SKELETON_ROWS = 6): the rows past the skeleton
    // count have no skeleton to become, so they sweep IN with the headers (`.orders-enter`).
    const many = Array.from({ length: 8 }, (_, i) => order(i + 1, todayAt(9)));
    setOrders({ data: paginated(many) });
    rerender(<OrdersPage />);
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    expect(growRowsIn).toHaveBeenCalledWith(expect.anything(), '.orders-enter');
    expect(screen.getByText('Cliente 8')).toBeInTheDocument();
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

  it('a BACKWARD uncached swap enters the skeleton from the left, then resolves per-slot', async () => {
    routerState.search = { view: 'historial' };
    setOrders({ data: paginated([order(1, todayAt(10))]) });
    const { rerender } = render(<OrdersPage />);
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());

    staggerIn.mockClear();
    staggerOut.mockClear();
    routerState.search = {};
    setOrdersByView({
      historial: { data: paginated([order(1, todayAt(10))]) },
      agenda: { isLoading: true },
    });
    rerender(<OrdersPage />);
    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument());
    // The uncached agenda's skeleton rows enter LATERALLY from the left (a backward move).
    expect(staggerIn).toHaveBeenCalledWith(expect.anything(), '.reveal-item', { from: 'left' });

    // Its data resolves PER-SLOT: leftover skeleton rows collapse out; no whole-skeleton lateral sweep.
    collapseRowsOut.mockClear();
    setOrdersByView({
      historial: { data: paginated([order(1, todayAt(10))]) },
      agenda: { data: paginated([]) },
    });
    rerender(<OrdersPage />);
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    expect(collapseRowsOut).toHaveBeenCalledWith(expect.anything(), '.orders-skel-orphan');
    expect(screen.getByText('modules.panel.orders.empty.agenda.title')).toBeInTheDocument();
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

    // When the uncached view resolves, its leftover skeleton rows sweep out PER-SLOT (no whole-
    // skeleton lateral sweep) and the empty panel settles in.
    staggerIn.mockClear();
    staggerOut.mockClear();
    setOrdersByView({
      agenda: { data: paginated([order(1, todayAt(10))]) },
      historial: { data: paginated([]) },
    });
    rerender(<OrdersPage />);
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    expect(collapseRowsOut).toHaveBeenCalledWith(expect.anything(), '.orders-skel-orphan');
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
