import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The query drives every state — mock it to pin loading / form / not-found / error.
const { useOrder } = vi.hoisted(() => ({ useOrder: vi.fn() }));
vi.mock('./useOrder', () => ({ useOrder }));

// The page reads its id from the route params.
const routeParams = vi.hoisted(() => ({ orderId: '12' }));
vi.mock('@tanstack/react-router', () => ({ useParams: () => routeParams }));

// The form has its own suite — a stub captures what the page hands it.
const formProps = vi.hoisted(() => ({
  captured: null as null | { mode?: string; order?: { id: number } },
}));
vi.mock('./OrderForm', () => ({
  default: (props: { mode?: string; order?: { id: number } }) => {
    formProps.captured = props;
    return <div data-testid="order-form-stub" />;
  },
}));

import { PanelNavContext, type PanelNav } from '../PanelNavContext';
import { PanelPageTransitionContext, type PanelPageMotion } from '../PanelPageTransitionContext';
import OrderEditPage from './OrderEditPage';
import type { OrderDetail } from './order.types';

const K = 'modules.panel.orders.detail';
const E = 'modules.panel.orders.edit';

const base = { id: 12, clientName: 'María López' } as OrderDetail;

type State = {
  data?: OrderDetail | null;
  isLoading?: boolean;
  isError?: boolean;
  isFetching?: boolean;
  refetch?: () => void;
  error?: unknown;
};

const setOrder = (state: State) => {
  const refetch = state.refetch ?? vi.fn();
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
      <PanelPageTransitionContext.Provider value={register}>
        {children}
      </PanelPageTransitionContext.Provider>
    </PanelNavContext.Provider>
  );
  const utils = render(<OrderEditPage />, { wrapper });
  return { ...utils, navigate, registeredMotion: () => motion };
};

beforeEach(() => {
  vi.clearAllMocks();
  formProps.captured = null;
  routeParams.orderId = '12';
});

describe('OrderEditPage', () => {
  it('shows the form\'s own structure on a cold load — never a half-filled form', () => {
    // RHF captures its defaults at MOUNT, so handing the form a half-order would freeze the wrong
    // values in. The skeleton stands in until the real thing is known.
    setOrder({ data: undefined, isLoading: true, isFetching: true });
    renderPage();
    expect(screen.getByRole('status', { name: `${E}.loading` })).toBeInTheDocument();
    expect(screen.queryByTestId('order-form-stub')).not.toBeInTheDocument();
  });

  it('mounts the form in edit mode with the loaded order', () => {
    setOrder({ data: base });
    renderPage();
    expect(screen.getByTestId('order-form-stub')).toBeInTheDocument();
    expect(formProps.captured).toMatchObject({ mode: 'edit', order: { id: 12 } });
    expect(screen.getByRole('heading', { name: `${E}.title` })).toBeInTheDocument();
  });

  it('the back affordance returns to the order (where Editar was pressed)', async () => {
    setOrder({ data: base });
    const { navigate } = renderPage();
    await userEvent.click(screen.getByRole('button', { name: new RegExp(`${E}.back`) }));
    expect(navigate).toHaveBeenCalledWith('/panel/pedidos/12');
  });

  it('maps a 404 to the honest not-found panel — missing AND not-yours read the same', async () => {
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
    setOrder({ data: base });
    const { registeredMotion } = renderPage();
    const motion = registeredMotion();
    expect(motion).not.toBeNull();
    await motion?.exit();
    motion?.enter({ fromCurrent: true });
  });
});
