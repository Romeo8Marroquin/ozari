import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { useOrder } = vi.hoisted(() => ({ useOrder: vi.fn() }));
vi.mock('./useOrder', () => ({ useOrder }));

const routeParams = vi.hoisted(() => ({ orderId: '12' }));
vi.mock('@tanstack/react-router', () => ({ useParams: () => routeParams }));

// The form has its own suite — a stub captures what the page hands it.
const formProps = vi.hoisted(() => ({
  captured: null as null | { order?: { id: number }; deposit?: { total: number } },
}));
vi.mock('./OrderSettlementForm', () => ({
  default: (props: { order?: { id: number }; deposit?: { total: number } }) => {
    formProps.captured = props;
    return <div data-testid="settlement-form-stub" />;
  },
}));

import { PanelNavContext, type PanelNav } from '../PanelNavContext';
import { PanelPageTransitionContext, type PanelPageMotion } from '../PanelPageTransitionContext';
import type { OrderDetail } from './order.types';
import OrderSettlementPage from './OrderSettlementPage';

const K = 'modules.panel.orders.detail';
const S = 'modules.panel.orders.settlement';

const settleable = {
  id: 12,
  clientName: 'María López',
  securityDeposit: { total: 200, canSettle: true },
} as OrderDetail;

type State = {
  data?: OrderDetail | null;
  isLoading?: boolean;
  isError?: boolean;
  isFetching?: boolean;
  error?: unknown;
};

const setOrder = (state: State) => {
  const refetch = vi.fn();
  useOrder.mockReturnValue({
    data: state.data,
    isLoading: state.isLoading ?? false,
    isError: state.isError ?? false,
    isFetching: state.isFetching ?? false,
    refetch,
    error: state.error,
  });
  return refetch;
};

const renderPage = () => {
  let motion: PanelPageMotion | null = null;
  const register = (value: PanelPageMotion | null): void => {
    if (value) motion = value;
  };
  const navigate = vi.fn();
  const nav: PanelNav = { navigateTo: navigate, pending: null };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <PanelNavContext.Provider value={nav}>
      <PanelPageTransitionContext.Provider value={register}>{children}</PanelPageTransitionContext.Provider>
    </PanelNavContext.Provider>
  );
  const utils = render(<OrderSettlementPage />, { wrapper });
  return { ...utils, navigate, registeredMotion: () => motion };
};

beforeEach(() => {
  vi.clearAllMocks();
  formProps.captured = null;
});

describe('OrderSettlementPage', () => {
  it('shows the form\'s own structure on a cold load — never a half-filled form', () => {
    setOrder({ data: undefined, isLoading: true, isFetching: true });
    renderPage();
    expect(screen.getByRole('status', { name: `${S}.loading` })).toBeInTheDocument();
    expect(screen.queryByTestId('settlement-form-stub')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: `${S}.title` })).toBeInTheDocument();
  });

  it('mounts the form with the order and its deposit block once settleable', () => {
    setOrder({ data: settleable });
    renderPage();
    expect(formProps.captured).toMatchObject({ order: { id: 12 }, deposit: { total: 200 } });
    expect(screen.getByText(`${S}.client`)).toBeInTheDocument();
  });

  it('titles itself as an EDIT when a settlement is already recorded', () => {
    setOrder({
      data: {
        ...settleable,
        securityDeposit: { total: 200, canSettle: true, settlement: { settledAt: 'x' } },
      } as OrderDetail,
    });
    renderPage();
    expect(screen.getByRole('heading', { name: `${S}.editTitle` })).toBeInTheDocument();
  });

  it.each([
    ['not deliverable yet / cancelled', { total: 200, canSettle: false }],
    ['nothing to settle at all', undefined],
  ])('an order that cannot be settled (%s) gets an honest way back, not a form', async (_label, block) => {
    setOrder({ data: { ...settleable, securityDeposit: block } as OrderDetail });
    const { navigate } = renderPage();
    expect(screen.queryByTestId('settlement-form-stub')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: `${S}.unavailable.title` })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: new RegExp(`${S}.unavailable.action`) }));
    expect(navigate).toHaveBeenCalledWith('/panel/pedidos/12');
  });

  it('the back affordance returns to the order', async () => {
    setOrder({ data: settleable });
    const { navigate } = renderPage();
    await userEvent.click(screen.getByRole('button', { name: new RegExp(`${S}.back`) }));
    expect(navigate).toHaveBeenCalledWith('/panel/pedidos/12');
  });

  it('maps a 404 to the honest not-found panel', async () => {
    setOrder({ data: undefined, isError: true, error: { response: { status: 404 } } });
    const { navigate } = renderPage();
    expect(screen.getByRole('heading', { name: `${K}.notFound.title` })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: new RegExp(`${K}.notFound.action`) }));
    expect(navigate).toHaveBeenCalledWith('/panel/pedidos');
  });

  it('maps a transient failure to the retry panel and refetches on demand', async () => {
    const refetch = setOrder({ data: undefined, isError: true, error: { response: { status: 500 } } });
    renderPage();
    expect(screen.getByRole('heading', { name: `${K}.error.title` })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: new RegExp(`${K}.error.retry`) }));
    expect(refetch).toHaveBeenCalled();
  });

  it('registers its page motion pair with the layout (exit resolves; enter resumes)', async () => {
    setOrder({ data: settleable });
    const { registeredMotion } = renderPage();
    const motion = registeredMotion();
    expect(motion).not.toBeNull();
    await motion?.exit();
    motion?.enter({ fromCurrent: true });
  });
});
