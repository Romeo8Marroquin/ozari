import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { payOrder } = vi.hoisted(() => ({ payOrder: vi.fn() }));
const { usePayOrder } = vi.hoisted(() => ({ usePayOrder: vi.fn() }));
vi.mock('./usePayOrder', () => ({ usePayOrder }));

const { useOrdersCatalog } = vi.hoisted(() => ({ useOrdersCatalog: vi.fn() }));
vi.mock('./useOrdersCatalog', () => ({ useOrdersCatalog }));

const { success, error } = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('@components/notifications/notify', () => ({ notify: { success, error } }));

import OrderPaymentModal from './OrderPaymentModal';
import type { OrderListItem } from './order.types';

const KEY = 'modules.panel.orders.payment';

const order = (overrides: Record<string, unknown> = {}): OrderListItem =>
  ({
    id: 12,
    clientName: 'María López',
    totalAmount: 450,
    currency: { id: 1, iso4217Code: 'GTQ', name: 'Quetzal', symbol: 'Q' },
    isPaid: false,
    ...overrides,
  }) as OrderListItem;

type Handlers = { onSuccess: () => void; onError: (e: unknown) => void };

const axiosError = (status: number, message?: string) => ({
  isAxiosError: true,
  response: { status, data: message ? { message } : {} },
});

beforeEach(() => {
  vi.clearAllMocks();
  usePayOrder.mockReturnValue({ payOrder, isPending: false });
  useOrdersCatalog.mockReturnValue({
    data: { paymentMethods: [{ id: 1, name: 'Efectivo' }, { id: 2, name: 'Transferencia' }] },
  });
});
afterEach(() => vi.restoreAllMocks());

describe('OrderPaymentModal', () => {
  it('renders nothing when closed', () => {
    render(<OrderPaymentModal onClose={vi.fn()} />);
    expect(screen.queryByText(`${KEY}.title`)).not.toBeInTheDocument();
  });

  it('states the amount in the ORDER’s own currency, and does not let it be edited', () => {
    render(<OrderPaymentModal order={order()} onClose={vi.fn()} />);
    expect(screen.getByText('Q 450.00')).toBeInTheDocument();
    // Partial payments are the deposit's job; an editable figure here would be a second source of
    // truth for what the order costs.
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
  });

  it('records the payment WITHOUT a method — cash at the door often has none', async () => {
    const onClose = vi.fn();
    render(<OrderPaymentModal order={order()} onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: `${KEY}.confirm` }));

    expect(payOrder).toHaveBeenCalledWith({ orderId: 12 }, expect.any(Object));
    const handlers = payOrder.mock.calls[0][1] as Handlers;
    act(() => handlers.onSuccess());
    expect(success).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('sends the chosen method when one is picked', async () => {
    render(<OrderPaymentModal order={order()} onClose={vi.fn()} />);
    await userEvent.selectOptions(screen.getByRole('combobox'), '2');
    await userEvent.click(screen.getByRole('button', { name: `${KEY}.confirm` }));
    expect(payOrder).toHaveBeenCalledWith(
      { orderId: 12, paymentMethodId: 2 },
      expect.any(Object),
    );
  });

  it('surfaces the "already paid" 409 INLINE — it means this screen is stale', async () => {
    render(<OrderPaymentModal order={order()} onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: `${KEY}.confirm` }));
    const handlers = payOrder.mock.calls[0][1] as Handlers;

    act(() => handlers.onError(axiosError(409, 'Ya tiene un pago registrado')));
    expect(await screen.findByText('Ya tiene un pago registrado')).toBeInTheDocument();
    expect(error).not.toHaveBeenCalled();
  });

  it('sends an ambient failure to a toast instead', async () => {
    render(<OrderPaymentModal order={order()} onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: `${KEY}.confirm` }));
    const handlers = payOrder.mock.calls[0][1] as Handlers;

    act(() => handlers.onError(axiosError(500)));
    expect(error).toHaveBeenCalled();
  });

  it('ignores a second confirm while the first is in flight', async () => {
    usePayOrder.mockReturnValue({ payOrder, isPending: true });
    render(<OrderPaymentModal order={order()} onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: `${KEY}.confirm` }));
    expect(payOrder).not.toHaveBeenCalled();
  });

  it('cancels without recording anything', async () => {
    const onClose = vi.fn();
    render(<OrderPaymentModal order={order()} onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: `${KEY}.cancel` }));
    expect(payOrder).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('forgets a previous dialog’s method and error when it closes', async () => {
    const { rerender } = render(<OrderPaymentModal order={order()} onClose={vi.fn()} />);
    await userEvent.selectOptions(screen.getByRole('combobox'), '2');

    rerender(<OrderPaymentModal onClose={vi.fn()} />);
    rerender(<OrderPaymentModal order={order({ id: 13 })} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('combobox')).toHaveValue(''));
  });

  it('clears the method back to "sin especificar"', async () => {
    render(<OrderPaymentModal order={order()} onClose={vi.fn()} />);
    const select = screen.getByRole('combobox');
    await userEvent.selectOptions(select, '2');
    expect(select).toHaveValue('2');

    // Back to the placeholder ⇒ no method travels with the request.
    await userEvent.selectOptions(select, '');
    await userEvent.click(screen.getByRole('button', { name: `${KEY}.confirm` }));
    expect(payOrder).toHaveBeenCalledWith({ orderId: 12 }, expect.any(Object));
  });

  it('tolerates a catalog that has not loaded yet', () => {
    useOrdersCatalog.mockReturnValue({ data: undefined });
    render(<OrderPaymentModal order={order()} onClose={vi.fn()} />);
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });
});
