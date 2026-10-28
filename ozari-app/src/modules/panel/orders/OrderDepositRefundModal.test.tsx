import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { settleOrder, pending } = vi.hoisted(() => ({
  settleOrder: vi.fn(),
  pending: { value: false },
}));
vi.mock('./useSettleOrder', () => ({
  useSettleOrder: () => ({ settleOrder, isPending: pending.value }),
}));

const { success, error } = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('@components/notifications/notify', () => ({ notify: { success, error } }));

const { toFormError } = vi.hoisted(() => ({ toFormError: vi.fn(() => ({})) }));
vi.mock('@utils/apiError', () => ({ toFormError }));

import { QueryKeys } from '@constants/QueryKeys';
import OrderDepositRefundModal from './OrderDepositRefundModal';
import type { OrderDetail } from './order.types';

const KEY = 'modules.panel.orders.depositRefund';

const order = (overrides: Record<string, unknown> = {}): OrderDetail =>
  ({
    id: 12,
    clientName: 'María López',
    currency: { id: 1, iso4217Code: 'GTQ', name: 'Quetzal', symbol: 'Q' },
    securityDeposit: { total: 500, held: 500, canSettle: true },
    ...overrides,
  }) as OrderDetail;

type Handlers = {
  onSuccess: (response: { data: { data?: { order: OrderDetail } } }) => void;
  onError: (e: unknown) => void;
};
const handlers = (): Handlers => settleOrder.mock.calls[0][1] as Handlers;

let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);
const renderModal = (subject?: OrderDetail, onClose = vi.fn()) =>
  render(<OrderDepositRefundModal order={subject} onClose={onClose} />, { wrapper });

beforeEach(() => {
  vi.clearAllMocks();
  pending.value = false;
  toFormError.mockReturnValue({});
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
});
afterEach(() => vi.restoreAllMocks());

describe('OrderDepositRefundModal', () => {
  it('renders nothing when closed', () => {
    renderModal();
    expect(screen.queryByText(`${KEY}.title`)).not.toBeInTheDocument();
  });

  it('states the amount going back and whose order it is', () => {
    renderModal(order());
    expect(screen.getByText(`${KEY}.title`)).toBeInTheDocument();
    expect(screen.getByText(`${KEY}.description`)).toBeInTheDocument();
    expect(screen.getByText(`${KEY}.client`)).toBeInTheDocument();
    expect(screen.getByText(`${KEY}.hint`)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: `${KEY}.confirm` })).toBeInTheDocument();
  });

  it('with no deposit (replacement values only) it is the "Sin daños" confirmation', () => {
    renderModal(order({ securityDeposit: { total: 0, held: 0, canSettle: true } }));
    expect(screen.getByText(`${KEY}.titleNoDeposit`)).toBeInTheDocument();
    expect(screen.getByText(`${KEY}.descriptionNoDeposit`)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: `${KEY}.confirmNoDeposit` })).toBeInTheDocument();
  });

  it('a deposit handed over WITHOUT collecting it (held 0) is "Sin daños", never a refund', () => {
    renderModal(order({ securityDeposit: { total: 500, held: 0, canSettle: true } }));
    expect(screen.getByText(`${KEY}.titleNoDeposit`)).toBeInTheDocument();
    expect(screen.queryByText(`${KEY}.description`)).not.toBeInTheDocument();
  });
  it('an order without a deposit block reads as "Sin daños" too', () => {
    renderModal(order({ securityDeposit: undefined }));
    expect(screen.getByText(`${KEY}.titleNoDeposit`)).toBeInTheDocument();
  });

  it('confirms FIRST: records nothing claimed, closes only once the server agreed', async () => {
    const onClose = vi.fn();
    const setData = vi.spyOn(client, 'setQueryData');
    renderModal(order(), onClose);
    await userEvent.click(screen.getByRole('button', { name: `${KEY}.confirm` }));

    expect(settleOrder).toHaveBeenCalledWith(
      { orderId: 12, body: { retainedAmount: 0, damages: [] } },
      expect.any(Object),
    );
    expect(onClose).not.toHaveBeenCalled();
    const saved = { id: 12 } as OrderDetail;
    act(() => handlers().onSuccess({ data: { data: { order: saved } } }));
    // The re-projected order seeds the detail at once; the hook's invalidations re-read it.
    expect(setData).toHaveBeenCalledWith([QueryKeys.ORDER, 12], saved);
    expect(success).toHaveBeenCalledWith(`${KEY}.successToast`, { title: `${KEY}.successTitle` });
    expect(onClose).toHaveBeenCalled();
  });

  it('the "Sin daños" variant words its toast accordingly; a bare 2xx still closes', async () => {
    const onClose = vi.fn();
    const setData = vi.spyOn(client, 'setQueryData');
    renderModal(order({ securityDeposit: { total: 0, held: 0, canSettle: true } }), onClose);
    await userEvent.click(screen.getByRole('button', { name: `${KEY}.confirmNoDeposit` }));
    act(() => handlers().onSuccess({ data: {} }));
    expect(setData).not.toHaveBeenCalled();
    expect(success).toHaveBeenCalledWith(`${KEY}.successToastNoDeposit`, {
      title: `${KEY}.successTitleNoDeposit`,
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('shows a 409 INLINE (a stale screen) and sends an ambient failure to a toast', () => {
    toFormError.mockReturnValue({ inline: 'ya se registró' });
    renderModal(order());
    screen.getByRole('button', { name: `${KEY}.confirm` }).click();
    act(() => handlers().onError({ response: { status: 409 } }));
    expect(screen.getByText('ya se registró')).toBeInTheDocument();
    expect(error).not.toHaveBeenCalled();

    toFormError.mockReturnValue({ toast: 'sin conexión' });
    act(() => handlers().onError({}));
    expect(error).toHaveBeenCalledWith('sin conexión');
  });

  it('opens FRESH: a previous failure never greets the next order', () => {
    toFormError.mockReturnValue({ inline: 'falló' });
    const { rerender } = renderModal(order());
    screen.getByRole('button', { name: `${KEY}.confirm` }).click();
    act(() => handlers().onError({}));
    expect(screen.getByText('falló')).toBeInTheDocument();

    rerender(<OrderDepositRefundModal onClose={vi.fn()} />);
    rerender(<OrderDepositRefundModal order={order({ id: 13 })} onClose={vi.fn()} />);
    expect(screen.queryByText('falló')).not.toBeInTheDocument();
  });

  it('cannot be double-tapped while the request is in flight', async () => {
    pending.value = true;
    renderModal(order());
    await userEvent.click(screen.getByRole('button', { name: `${KEY}.confirm` }));
    expect(settleOrder).not.toHaveBeenCalled();
  });
});
