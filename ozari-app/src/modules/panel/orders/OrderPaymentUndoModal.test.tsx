import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { undoPayment } = vi.hoisted(() => ({ undoPayment: vi.fn() }));
const { useUndoPayment } = vi.hoisted(() => ({ useUndoPayment: vi.fn() }));
vi.mock('./useUndoPayment', () => ({ useUndoPayment }));

const { success, error } = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('@components/notifications/notify', () => ({ notify: { success, error } }));

const { toFormError } = vi.hoisted(() => ({ toFormError: vi.fn(() => ({})) }));
vi.mock('@utils/apiError', () => ({ toFormError }));

import OrderPaymentUndoModal from './OrderPaymentUndoModal';
import type { OrderDetail } from './order.types';

const KEY = 'modules.panel.orders.paymentUndo';

const order = (overrides: Record<string, unknown> = {}): OrderDetail =>
  ({ id: 12, clientName: 'María López', isPaid: true, ...overrides }) as OrderDetail;

type Handlers = { onSuccess: () => void; onError: (e: unknown) => void };

beforeEach(() => {
  vi.clearAllMocks();
  toFormError.mockReturnValue({});
  useUndoPayment.mockReturnValue({ undoPayment, isPending: false });
});
afterEach(() => vi.restoreAllMocks());

describe('OrderPaymentUndoModal', () => {
  it('renders nothing when closed', () => {
    render(<OrderPaymentUndoModal onClose={vi.fn()} />);
    expect(screen.queryByText(`${KEY}.title`)).not.toBeInTheDocument();
  });

  it('states what the act DOES, and never why it is being done', () => {
    // "Are you sure?" tells an owner nothing, and copy that assumes a mistake ("esto corrige un
    // registro equivocado") tells them something about themselves instead of about the button — a
    // payment that fell through is the same operation. So: the record is deleted, the order returns
    // to pending, and the one reading it could plausibly get is ruled out — money does NOT move.
    render(<OrderPaymentUndoModal order={order()} onClose={vi.fn()} />);
    expect(screen.getByText(`${KEY}.note`)).toBeInTheDocument();
    // The delete being real is why re-recording stamps a new date — small print, but the thing that
    // actually matters if you change your mind.
    expect(screen.getByText(`${KEY}.hint`)).toBeInTheDocument();
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });

  it('undoes the payment and closes on success', async () => {
    const onClose = vi.fn();
    render(<OrderPaymentUndoModal order={order()} onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: `${KEY}.confirm` }));

    // The id alone: there is nothing else to record about a correction.
    expect(undoPayment).toHaveBeenCalledWith(12, expect.any(Object));
    const handlers = undoPayment.mock.calls[0][1] as Handlers;
    act(() => handlers.onSuccess());
    expect(success).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('shows the 409 INLINE — a stale screen belongs where the admin is looking', () => {
    toFormError.mockReturnValue({ inline: 'este pedido no tiene un pago' });
    render(<OrderPaymentUndoModal order={order()} onClose={vi.fn()} />);
    const confirm = screen.getByRole('button', { name: `${KEY}.confirm` });
    confirm.click();

    const handlers = undoPayment.mock.calls[0][1] as Handlers;
    act(() => handlers.onError({ response: { status: 409 } }));
    expect(screen.getByText('este pedido no tiene un pago')).toBeInTheDocument();
    expect(error).not.toHaveBeenCalled();
  });

  it('sends an ambient failure to a toast instead', () => {
    toFormError.mockReturnValue({ toast: 'sin conexión' });
    render(<OrderPaymentUndoModal order={order()} onClose={vi.fn()} />);
    screen.getByRole('button', { name: `${KEY}.confirm` }).click();

    const handlers = undoPayment.mock.calls[0][1] as Handlers;
    act(() => handlers.onError({}));
    expect(error).toHaveBeenCalledWith('sin conexión');
  });

  it('opens FRESH: a previous failure never greets the next order', () => {
    toFormError.mockReturnValue({ inline: 'falló' });
    const { rerender } = render(<OrderPaymentUndoModal order={order()} onClose={vi.fn()} />);
    screen.getByRole('button', { name: `${KEY}.confirm` }).click();
    act(() => (undoPayment.mock.calls[0][1] as Handlers).onError({}));
    expect(screen.getByText('falló')).toBeInTheDocument();

    rerender(<OrderPaymentUndoModal onClose={vi.fn()} />);
    rerender(<OrderPaymentUndoModal order={order({ id: 13 })} onClose={vi.fn()} />);
    expect(screen.queryByText('falló')).not.toBeInTheDocument();
  });

  it('cannot be double-tapped while the request is in flight', async () => {
    useUndoPayment.mockReturnValue({ undoPayment, isPending: true });
    render(<OrderPaymentUndoModal order={order()} onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: `${KEY}.confirm` }));
    expect(undoPayment).not.toHaveBeenCalled();
  });
});
