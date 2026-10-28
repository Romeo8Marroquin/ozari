import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { undoSettlement } = vi.hoisted(() => ({ undoSettlement: vi.fn() }));
const { useUndoOrderSettlement } = vi.hoisted(() => ({ useUndoOrderSettlement: vi.fn() }));
vi.mock('./useUndoOrderSettlement', () => ({ useUndoOrderSettlement }));

const { success, error } = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('@components/notifications/notify', () => ({ notify: { success, error } }));

const { toFormError } = vi.hoisted(() => ({ toFormError: vi.fn(() => ({})) }));
vi.mock('@utils/apiError', () => ({ toFormError }));

import OrderSettlementUndoModal from './OrderSettlementUndoModal';
import type { OrderDetail } from './order.types';

const KEY = 'modules.panel.orders.settlementUndo';

const order = (overrides: Record<string, unknown> = {}): OrderDetail =>
  ({ id: 12, clientName: 'María López', ...overrides }) as OrderDetail;

type Handlers = { onSuccess: () => void; onError: (e: unknown) => void };

beforeEach(() => {
  vi.clearAllMocks();
  toFormError.mockReturnValue({});
  useUndoOrderSettlement.mockReturnValue({ undoSettlement, isPending: false });
});
afterEach(() => vi.restoreAllMocks());

describe('OrderSettlementUndoModal', () => {
  it('renders nothing when closed', () => {
    render(<OrderSettlementUndoModal onClose={vi.fn()} />);
    expect(screen.queryByText(`${KEY}.title`)).not.toBeInTheDocument();
  });

  it('says it only clears the record and moves no money', () => {
    render(<OrderSettlementUndoModal order={order()} onClose={vi.fn()} />);
    expect(screen.getByText(`${KEY}.note`)).toBeInTheDocument();
    expect(screen.getByText(`${KEY}.hint`)).toBeInTheDocument();
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });

  it('confirms FIRST: closes only once the server agreed', async () => {
    const onClose = vi.fn();
    render(<OrderSettlementUndoModal order={order()} onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: `${KEY}.confirm` }));

    expect(undoSettlement).toHaveBeenCalledWith(12, expect.any(Object));
    expect(onClose).not.toHaveBeenCalled();
    act(() => (undoSettlement.mock.calls[0][1] as Handlers).onSuccess());
    expect(success).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('shows the 409 INLINE — a stale screen belongs where the admin is looking', () => {
    toFormError.mockReturnValue({ inline: 'no hay nada registrado' });
    render(<OrderSettlementUndoModal order={order()} onClose={vi.fn()} />);
    screen.getByRole('button', { name: `${KEY}.confirm` }).click();

    act(() => (undoSettlement.mock.calls[0][1] as Handlers).onError({ response: { status: 409 } }));
    expect(screen.getByText('no hay nada registrado')).toBeInTheDocument();
    expect(error).not.toHaveBeenCalled();
  });

  it('sends an ambient failure to a toast instead', () => {
    toFormError.mockReturnValue({ toast: 'sin conexión' });
    render(<OrderSettlementUndoModal order={order()} onClose={vi.fn()} />);
    screen.getByRole('button', { name: `${KEY}.confirm` }).click();

    act(() => (undoSettlement.mock.calls[0][1] as Handlers).onError({}));
    expect(error).toHaveBeenCalledWith('sin conexión');
  });

  it('opens FRESH: a previous failure never greets the next order', () => {
    toFormError.mockReturnValue({ inline: 'falló' });
    const { rerender } = render(<OrderSettlementUndoModal order={order()} onClose={vi.fn()} />);
    screen.getByRole('button', { name: `${KEY}.confirm` }).click();
    act(() => (undoSettlement.mock.calls[0][1] as Handlers).onError({}));
    expect(screen.getByText('falló')).toBeInTheDocument();

    rerender(<OrderSettlementUndoModal onClose={vi.fn()} />);
    rerender(<OrderSettlementUndoModal order={order({ id: 13 })} onClose={vi.fn()} />);
    expect(screen.queryByText('falló')).not.toBeInTheDocument();
  });

  it('cannot be double-tapped while the request is in flight', async () => {
    useUndoOrderSettlement.mockReturnValue({ undoSettlement, isPending: true });
    render(<OrderSettlementUndoModal order={order()} onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: `${KEY}.confirm` }));
    expect(undoSettlement).not.toHaveBeenCalled();
  });
});
