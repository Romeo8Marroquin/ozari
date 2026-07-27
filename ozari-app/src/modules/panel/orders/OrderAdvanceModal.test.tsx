import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { advanceOrder, uploadEvidence } = vi.hoisted(() => ({
  advanceOrder: vi.fn(),
  uploadEvidence: vi.fn(),
}));
vi.mock('./useAdvanceOrder', () => ({
  useAdvanceOrder: () => ({ advanceOrder, isPending: false }),
}));
vi.mock('./useOrderEvidenceUploads', () => ({
  useOrderEvidenceUploads: () => ({ uploadEvidence, isUploading: false }),
}));

const { notify } = vi.hoisted(() => ({
  notify: { success: vi.fn(), error: vi.fn() },
}));
vi.mock('@components/notifications/notify', () => ({ notify }));

const { toFormError } = vi.hoisted(() => ({ toFormError: vi.fn(() => ({})) }));
vi.mock('@utils/apiError', () => ({ toFormError }));

import type { OrderAction, OrderListItem } from './order.types';
import OrderAdvanceModal from './OrderAdvanceModal';

const KEY = 'modules.panel.orders.advance';

const order = { id: 12, clientName: 'María López' } as OrderListItem;

const action = (overrides: Partial<OrderAction> = {}): OrderAction => ({
  kind: 'forward',
  statusId: 5,
  statusName: 'En ruta',
  requiresEvidence: false,
  minEvidence: 1,
  maxEvidence: 3,
  requiresReason: false,
  ...overrides,
});

const photo = (name: string): File => new File(['x'], name, { type: 'image/webp' });

const confirmButton = () => screen.getByRole('button', { name: `${KEY}.confirm` });

beforeEach(() => {
  vi.clearAllMocks();
  uploadEvidence.mockResolvedValue([]);
});

describe('OrderAdvanceModal', () => {
  it('renders nothing until a move is chosen', () => {
    const { container } = render(<OrderAdvanceModal onClose={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('confirms a plain forward step with no photos and no reason asked for', async () => {
    const onClose = vi.fn();
    render(<OrderAdvanceModal order={order} action={action()} onClose={onClose} />);

    // A step that declares neither requirement asks for neither.
    expect(screen.queryByText(`${KEY}.evidenceLabel`)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(`${KEY}.reasonLabel`)).not.toBeInTheDocument();

    await userEvent.click(confirmButton());
    await waitFor(() => expect(advanceOrder).toHaveBeenCalled());
    expect(advanceOrder.mock.calls[0][0]).toEqual({ orderId: 12, toStatusId: 5 });

    // Success → a toast naming the configured status, and the dialog closes.
    advanceOrder.mock.calls[0][1].onSuccess();
    expect(notify.success).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('demands the step\'s minimum photos before it will submit, and sends their KEYS', async () => {
    uploadEvidence.mockResolvedValue(['orders/evidence/a.webp', 'orders/evidence/b.webp']);
    render(
      <OrderAdvanceModal
        order={order}
        action={action({ statusId: 3, statusName: 'Entregado', requiresEvidence: true, minEvidence: 2 })}
        onClose={vi.fn()}
      />,
    );

    // Below the minimum → the confirm is unavailable and nothing is sent.
    expect(confirmButton()).toBeDisabled();
    const input = screen.getByLabelText(`${KEY}.evidenceLabel`);
    await userEvent.upload(input, [photo('a.webp')]);
    expect(confirmButton()).toBeDisabled();

    await userEvent.upload(input, [photo('b.webp')]);
    expect(confirmButton()).toBeEnabled();

    await userEvent.click(confirmButton());
    await waitFor(() => expect(advanceOrder).toHaveBeenCalled());
    // Photos upload FIRST; only their keys travel with the move.
    expect(uploadEvidence).toHaveBeenCalledWith([expect.any(File), expect.any(File)]);
    expect(advanceOrder.mock.calls[0][0]).toEqual({
      orderId: 12,
      toStatusId: 3,
      evidenceKeys: ['orders/evidence/a.webp', 'orders/evidence/b.webp'],
    });
  });

  it("never accepts more photos than the step's maximum, and lets one be removed", async () => {
    render(
      <OrderAdvanceModal
        order={order}
        action={action({ requiresEvidence: true, minEvidence: 1, maxEvidence: 2 })}
        onClose={vi.fn()}
      />,
    );
    const input = screen.getByLabelText(`${KEY}.evidenceLabel`);
    await userEvent.upload(input, [photo('a.webp'), photo('b.webp'), photo('c.webp')]);
    expect(screen.getByText('a.webp')).toBeInTheDocument();
    expect(screen.getByText('b.webp')).toBeInTheDocument();
    expect(screen.queryByText('c.webp')).not.toBeInTheDocument();
    // At the cap the picker itself is disabled — the backend would reject an overflow.
    expect(screen.getByRole('button', { name: `${KEY}.addPhotos` })).toBeDisabled();

    // (Both remove buttons share a key-only label under the test `t`; the first is a.webp's.)
    await userEvent.click(screen.getAllByRole('button', { name: `${KEY}.removePhoto` })[0]);
    expect(screen.queryByText('a.webp')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: `${KEY}.addPhotos` })).toBeEnabled();
  });

  it('opens the picker from the visible button (the file input itself is off-screen)', async () => {
    render(
      <OrderAdvanceModal
        order={order}
        action={action({ requiresEvidence: true })}
        onClose={vi.fn()}
      />,
    );
    const input = screen.getByLabelText(`${KEY}.evidenceLabel`) as HTMLInputElement;
    const click = vi.spyOn(input, 'click');
    await userEvent.click(screen.getByRole('button', { name: `${KEY}.addPhotos` }));
    expect(click).toHaveBeenCalled();
  });

  it('survives a picker that returns no files (the user cancelled it)', () => {
    render(
      <OrderAdvanceModal
        order={order}
        action={action({ requiresEvidence: true })}
        onClose={vi.fn()}
      />,
    );
    const input = screen.getByLabelText(`${KEY}.evidenceLabel`);
    fireEvent.change(input, { target: { files: null } });
    expect(confirmButton()).toBeDisabled();
  });

  it('starts clean for the NEXT move — the previous photos never carry over', async () => {
    const { rerender } = render(
      <OrderAdvanceModal
        order={order}
        action={action({ requiresEvidence: true })}
        onClose={vi.fn()}
      />,
    );
    await userEvent.upload(screen.getByLabelText(`${KEY}.evidenceLabel`), [photo('a.webp')]);
    expect(screen.getByText('a.webp')).toBeInTheDocument();

    // Closing and reopening on ANOTHER order/step resets the dialog.
    rerender(<OrderAdvanceModal onClose={vi.fn()} />);
    rerender(
      <OrderAdvanceModal
        order={{ ...order, id: 13 }}
        action={action({ statusId: 3, requiresEvidence: true })}
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByText('a.webp')).not.toBeInTheDocument();
  });

  it('asks for a reason on a cancel and refuses to submit without one', async () => {
    render(
      <OrderAdvanceModal
        order={order}
        action={action({
          kind: 'disruptive',
          statusId: 2,
          statusName: 'Cancelado',
          requiresReason: true,
        })}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText(`${KEY}.cancelTitle`)).toBeInTheDocument();
    expect(confirmButton()).toBeDisabled();

    await userEvent.type(screen.getByLabelText(`${KEY}.reasonLabel`), '  Se canceló la fiesta  ');
    expect(confirmButton()).toBeEnabled();
    await userEvent.click(confirmButton());

    await waitFor(() => expect(advanceOrder).toHaveBeenCalled());
    expect(advanceOrder.mock.calls[0][0]).toEqual({
      orderId: 12,
      toStatusId: 2,
      reason: 'Se canceló la fiesta',
    });
  });

  it('titles a rewind as such (no photos demanded when undoing)', () => {
    render(
      <OrderAdvanceModal
        order={order}
        action={action({ kind: 'backward', statusName: 'Pendiente' })}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText(`${KEY}.rewindTitle`)).toBeInTheDocument();
    expect(screen.queryByText(`${KEY}.evidenceLabel`)).not.toBeInTheDocument();
  });

  it('routes a failed move inline vs to a toast, per the form doctrine', async () => {
    toFormError.mockReturnValue({ inline: 'ya cambió', toast: 'algo pasó' });
    render(<OrderAdvanceModal order={order} action={action()} onClose={vi.fn()} />);

    await userEvent.click(confirmButton());
    await waitFor(() => expect(advanceOrder).toHaveBeenCalled());
    advanceOrder.mock.calls[0][1].onError(new Error('409'));

    expect(await screen.findByText('ya cambió')).toBeInTheDocument();
    expect(notify.error).toHaveBeenCalledWith('algo pasó');
  });

  it('shows an inline-only failure without a toast, and an ambient one without a banner', async () => {
    // A 409/422 is contextual → inline only.
    toFormError.mockReturnValue({ inline: 'evidencia incompleta' });
    const { unmount } = render(
      <OrderAdvanceModal order={order} action={action()} onClose={vi.fn()} />,
    );
    await userEvent.click(confirmButton());
    await waitFor(() => expect(advanceOrder).toHaveBeenCalled());
    advanceOrder.mock.calls[0][1].onError(new Error('422'));
    expect(await screen.findByText('evidencia incompleta')).toBeInTheDocument();
    expect(notify.error).not.toHaveBeenCalled();
    unmount();

    // A 429/500 is ambient → toast only, no banner.
    vi.clearAllMocks();
    uploadEvidence.mockResolvedValue([]);
    toFormError.mockReturnValue({ toast: 'demasiadas solicitudes' });
    render(<OrderAdvanceModal order={order} action={action()} onClose={vi.fn()} />);
    await userEvent.click(confirmButton());
    await waitFor(() => expect(advanceOrder).toHaveBeenCalled());
    advanceOrder.mock.calls[0][1].onError(new Error('429'));
    expect(notify.error).toHaveBeenCalledWith('demasiadas solicitudes');
    expect(screen.queryByText('evidencia incompleta')).not.toBeInTheDocument();
  });

  it('keeps an outage silent when the photo upload dies (the overlay owns it)', async () => {
    uploadEvidence.mockRejectedValue(new Error('503'));
    toFormError.mockReturnValue({}); // outage → neither inline nor toast
    render(
      <OrderAdvanceModal
        order={order}
        action={action({ requiresEvidence: true, minEvidence: 1 })}
        onClose={vi.fn()}
      />,
    );
    await userEvent.upload(screen.getByLabelText(`${KEY}.evidenceLabel`), [photo('a.webp')]);
    await userEvent.click(confirmButton());

    // The dialog still explains itself inline, but nothing is toasted over the overlay.
    expect(await screen.findByText(`${KEY}.errors.upload`)).toBeInTheDocument();
    expect(notify.error).not.toHaveBeenCalled();
  });

  it('surfaces a failed photo upload without ever advancing the order', async () => {
    uploadEvidence.mockRejectedValue(new Error('network'));
    toFormError.mockReturnValue({ toast: 'sin conexión' });
    render(
      <OrderAdvanceModal
        order={order}
        action={action({ requiresEvidence: true, minEvidence: 1 })}
        onClose={vi.fn()}
      />,
    );
    await userEvent.upload(screen.getByLabelText(`${KEY}.evidenceLabel`), [photo('a.webp')]);
    await userEvent.click(confirmButton());

    expect(await screen.findByText(`${KEY}.errors.upload`)).toBeInTheDocument();
    expect(advanceOrder).not.toHaveBeenCalled();
    expect(notify.error).toHaveBeenCalledWith('sin conexión');
  });
});
