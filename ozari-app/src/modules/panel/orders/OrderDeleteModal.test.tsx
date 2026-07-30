import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { deleteOrder } = vi.hoisted(() => ({ deleteOrder: vi.fn() }));
vi.mock('./useDeleteOrder', () => ({
  useDeleteOrder: () => ({ deleteOrder, isPending: false }),
}));

const { notify } = vi.hoisted(() => ({ notify: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@components/notifications/notify', () => ({ notify }));

const { toFormError } = vi.hoisted(() => ({ toFormError: vi.fn(() => ({})) }));
vi.mock('@utils/apiError', () => ({ toFormError }));

import type { OrderDetail } from './order.types';
import OrderDeleteModal from './OrderDeleteModal';

const KEY = 'modules.panel.orders.detail.delete';
const order = { id: 12, clientName: 'María López', holdsInventory: true } as OrderDetail;

beforeEach(() => vi.clearAllMocks());

describe('OrderDeleteModal', () => {
  it('renders nothing until an order is chosen', () => {
    const { container } = render(<OrderDeleteModal onClose={vi.fn()} onDeleted={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('spells out what disappears and that it cannot be undone', () => {
    render(<OrderDeleteModal order={order} onClose={vi.fn()} onDeleted={vi.fn()} />);
    expect(screen.getByText(`${KEY}.bullets.record`)).toBeInTheDocument();
    expect(screen.getByText(`${KEY}.bullets.evidence`)).toBeInTheDocument();
    expect(screen.getByText(`${KEY}.bullets.stock`)).toBeInTheDocument();
    expect(screen.getByText(`${KEY}.warning`)).toBeInTheDocument();
    // It demands a response rather than being dismissible-by-accident wording.
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });

  it('does not promise units back for an order that no longer holds any', () => {
    // A finished or cancelled order released its goods at that moment; the backend refuses to
    // restore them a second time (that would invent stock), so the dialog must not imply it will.
    render(
      <OrderDeleteModal
        order={{ ...order, holdsInventory: false }}
        onClose={vi.fn()}
        onDeleted={vi.fn()}
      />,
    );
    expect(screen.getByText(`${KEY}.bullets.stockFree`)).toBeInTheDocument();
    expect(screen.queryByText(`${KEY}.bullets.stock`)).not.toBeInTheDocument();
  });

  it('deletes, toasts, closes and hands control back to the page', async () => {
    const onClose = vi.fn();
    const onDeleted = vi.fn();
    render(<OrderDeleteModal order={order} onClose={onClose} onDeleted={onDeleted} />);

    await userEvent.click(screen.getByRole('button', { name: `${KEY}.confirm` }));
    await waitFor(() => expect(deleteOrder).toHaveBeenCalledWith(12, expect.anything()));

    deleteOrder.mock.calls[0][1].onSuccess();
    expect(notify.success).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
    // The page leaves — there is no detail left to show.
    expect(onDeleted).toHaveBeenCalled();
  });

  it('shows a failure inline and stays open (nothing was deleted)', async () => {
    toFormError.mockReturnValue({ toast: 'sin conexión' });
    const onDeleted = vi.fn();
    render(<OrderDeleteModal order={order} onClose={vi.fn()} onDeleted={onDeleted} />);

    await userEvent.click(screen.getByRole('button', { name: `${KEY}.confirm` }));
    await waitFor(() => expect(deleteOrder).toHaveBeenCalled());
    deleteOrder.mock.calls[0][1].onError(new Error('500'));

    expect(await screen.findByText(`${KEY}.error`)).toBeInTheDocument();
    expect(notify.error).toHaveBeenCalledWith('sin conexión');
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it('starts clean for a DIFFERENT order (a stale error never greets the next one)', async () => {
    toFormError.mockReturnValue({ inline: 'no se pudo' });
    const { rerender } = render(
      <OrderDeleteModal order={order} onClose={vi.fn()} onDeleted={vi.fn()} />,
    );
    await userEvent.click(screen.getByRole('button', { name: `${KEY}.confirm` }));
    await waitFor(() => expect(deleteOrder).toHaveBeenCalled());
    deleteOrder.mock.calls[0][1].onError(new Error('500'));
    expect(await screen.findByText('no se pudo')).toBeInTheDocument();

    rerender(
      <OrderDeleteModal
        order={{ ...order, id: 13 } as OrderDetail}
        onClose={vi.fn()}
        onDeleted={vi.fn()}
      />,
    );
    // The banner collapses (FormError keeps its last words painted through that animation, so the
    // proof of the reset is behavioural): confirming now targets the NEW order, cleanly.
    vi.clearAllMocks();
    await userEvent.click(screen.getByRole('button', { name: `${KEY}.confirm` }));
    await waitFor(() => expect(deleteOrder).toHaveBeenCalledWith(13, expect.anything()));
  });

  it('keeps the dialog mounted while it closes, so its exit can play', async () => {
    const { rerender } = render(
      <OrderDeleteModal order={order} onClose={vi.fn()} onDeleted={vi.fn()} />,
    );
    // Let the primitive finish entering — only a dialog that actually opened has an exit to play.
    await act(
      async () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    );

    rerender(<OrderDeleteModal onClose={vi.fn()} onDeleted={vi.fn()} />);
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByText(`${KEY}.warning`)).toBeInTheDocument();
  });
});
