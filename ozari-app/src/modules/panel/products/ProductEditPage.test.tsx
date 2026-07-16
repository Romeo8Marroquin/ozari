import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The query drives every state — mock it to pin loading / form / not-found / error.
const { useProduct } = vi.hoisted(() => ({ useProduct: vi.fn() }));
vi.mock('./useProduct', () => ({ useProduct }));

// The page reads its id from the route params.
const routeParams = vi.hoisted(() => ({ productId: '7' }));
vi.mock('@tanstack/react-router', () => ({ useParams: () => routeParams }));

// The form has its own suite — a stub captures what the page hands it.
const formProps = vi.hoisted(() => ({
  captured: null as null | { mode?: string; product?: { id: number } },
}));
vi.mock('./ProductForm', () => ({
  default: (props: { mode?: string; product?: { id: number } }) => {
    formProps.captured = props;
    return <div data-testid="product-form-stub" />;
  },
}));

import { PanelNavContext, type PanelNav } from '../PanelNavContext';
import { PanelPageTransitionContext, type PanelPageMotion } from '../PanelPageTransitionContext';
import ProductEditPage from './ProductEditPage';
import type { Product } from './product.types';

const K = 'modules.panel.products';
const E = `${K}.edit`;

const base: Product = {
  id: 7,
  name: 'Mesa redonda',
  businessType: 'Alquiler',
  businessTypeId: 1,
  category: 'Mesas',
  categoryId: 1,
  currency: { id: 1, iso4217Code: 'GTQ', name: 'Quetzal', symbol: 'Q' },
  rentPrice: 75,
  rentTimeUnit: 'Día',
  rentTimeUnitId: 2,
  images: [],
  details: [],
};

type State = {
  data?: Product | null;
  isLoading?: boolean;
  isError?: boolean;
  isFetching?: boolean;
  refetch?: () => void;
  error?: unknown;
};

const setProduct = (state: State) => {
  const refetch = state.refetch ?? vi.fn();
  useProduct.mockReturnValue({
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
  const utils = render(<ProductEditPage />, { wrapper });
  return { ...utils, navigate, registeredMotion: () => motion };
};

beforeEach(() => {
  vi.clearAllMocks();
  formProps.captured = null;
  routeParams.productId = '7';
});

describe('ProductEditPage', () => {
  it('shows the section skeletons on a cold load (no form yet — RHF captures defaults at mount)', () => {
    setProduct({ data: undefined, isLoading: true, isFetching: true });
    renderPage();
    expect(screen.getByRole('status', { name: `${E}.loading` })).toBeInTheDocument();
    expect(screen.queryByTestId('product-form-stub')).not.toBeInTheDocument();
  });

  it('mounts the form in edit mode with the loaded product', () => {
    setProduct({ data: base });
    renderPage();
    expect(screen.getByTestId('product-form-stub')).toBeInTheDocument();
    expect(formProps.captured).toMatchObject({ mode: 'edit', product: { id: 7 } });
    expect(screen.getByRole('heading', { name: `${E}.title` })).toBeInTheDocument();
  });

  it('the back affordance returns to the product detail (where Editar was pressed)', async () => {
    setProduct({ data: base });
    const { navigate } = renderPage();
    await userEvent.click(screen.getByRole('button', { name: new RegExp(`${E}.back`) }));
    expect(navigate).toHaveBeenCalledWith('/panel/productos/7');
  });

  it('maps a 404 to the honest not-found panel, backing out to the section root', async () => {
    setProduct({ data: undefined, isError: true, error: { response: { status: 404 } } });
    const { navigate } = renderPage();

    expect(screen.getByRole('heading', { name: `${K}.detail.notFound.title` })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: new RegExp(`${K}.detail.notFound.back`) }));
    expect(navigate).toHaveBeenCalledWith('/panel/productos');
  });

  it('maps a transient failure to the retry panel and refetches on demand', async () => {
    const refetch = setProduct({ data: undefined, isError: true, error: { response: { status: 500 } } });
    renderPage();

    expect(screen.getByRole('heading', { name: `${K}.detail.error.title` })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: new RegExp(`${K}.detail.error.retry`) }));
    expect(refetch).toHaveBeenCalled();
  });

  it('registers its page motion pair with the layout (exit resolves; enter resumes)', async () => {
    setProduct({ data: base });
    const { registeredMotion } = renderPage();
    const motion = registeredMotion();
    expect(motion).not.toBeNull();
    await motion?.exit();
    motion?.enter({ fromCurrent: true });
  });
});
