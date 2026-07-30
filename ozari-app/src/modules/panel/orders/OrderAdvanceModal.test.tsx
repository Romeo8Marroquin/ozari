import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

// Cancelling reads differently for the two roles who can do it (an admin can undo it; a driver
// cannot), so the role is a real input to this dialog's copy.
const { useHasRole } = vi.hoisted(() => ({ useHasRole: vi.fn(() => false) }));
vi.mock('@hooks/useRole', () => ({ useHasRole }));

import type { OrderAction, OrderListItem } from './order.types';
import OrderAdvanceModal from './OrderAdvanceModal';

const KEY = 'modules.panel.orders.advance';

// The copy names BOTH ends of the move, so the order's CURRENT status is part of the fixture.
const order = {
  id: 12,
  clientName: 'María López',
  status: { id: 1, name: 'Pendiente', colorKey: 'amber' },
} as OrderListItem;

const action = (overrides: Partial<OrderAction> = {}): OrderAction => ({
  kind: 'forward',
  statusId: 5,
  statusName: 'En ruta',
  requiresEvidence: false,
  minEvidence: 1,
  maxEvidence: 3,
  requiresReason: false,
  inventoryEffect: 'none',
  purgesEvidence: false,
  ...overrides,
});

const photo = (name: string): File => new File(['x'], name, { type: 'image/webp' });

/** The staged photos, read from the thumbnail strip (each tile previews the file it holds). */
const thumbNames = () => screen.queryAllByRole('img').map((image) => image.getAttribute('alt'));

/** The confirm button REPEATS the instruction, so its label key differs per kind of move. */
const confirmButton = (key: 'confirm' | 'confirmRewind' | 'confirmCancel' = 'confirm') =>
  screen.getByRole('button', { name: `${KEY}.${key}` });

beforeEach(() => {
  vi.clearAllMocks();
  uploadEvidence.mockResolvedValue([]);
  // jsdom has no object-URL support; the previews only need a stable handle to render.
  URL.createObjectURL = vi.fn((file: Blob) => `blob:${(file as File).name}`);
  URL.revokeObjectURL = vi.fn();
});

describe('OrderAdvanceModal', () => {
  it('renders nothing until a move is chosen', () => {
    const { container } = render(<OrderAdvanceModal onClose={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('keeps the dialog mounted while it closes, so the exit animation can play', async () => {
    // Tearing the Modal out of the tree the instant the page clears its pending move is what made
    // closing SNAP: the primitive owns a ~480ms exit and needs to stay mounted to play it.
    const { rerender } = render(
      <OrderAdvanceModal order={order} action={action()} onClose={vi.fn()} />,
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    // Let the primitive finish entering (it flips its own state on the next frame) — only a modal
    // that actually opened has an exit to play.
    await act(
      async () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    );

    rerender(<OrderAdvanceModal onClose={vi.fn()} />);
    const closing = screen.getByRole('dialog');
    // Still mounted, still showing WHICH move it was — and no longer interactive.
    expect(closing).toBeInTheDocument();
    expect(screen.getByText(`${KEY}.title`)).toBeInTheDocument();
    expect(closing.className).toContain('opacity-0');
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

    // Success → a toast naming the configured status AND the client ("El pedido de María López pasó
    // a En ruta"), then the dialog closes. That the toast supplies BOTH values is enforced by the
    // suite-wide i18n contract (`src/test/i18nContract.ts`): asking for the string without one
    // throws here, which is how the literal `{{client}}` this once shipped is now impossible.
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
      evidence: [{ statusId: 3, keys: ['orders/evidence/a.webp', 'orders/evidence/b.webp'] }],
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
    // Each staged photo shows as a PREVIEW thumbnail, not a filename row.
    expect(thumbNames()).toEqual(['a.webp', 'b.webp']);
    expect(screen.getAllByRole('img')[0]).toHaveAttribute('src', 'blob:a.webp');
    // At the cap the picker itself is disabled — the backend would reject an overflow.
    expect(screen.getByRole('button', { name: `${KEY}.addPhotos` })).toBeDisabled();

    // (Both remove buttons share a key-only label under the test `t`; the first is a.webp's.)
    await userEvent.click(screen.getAllByRole('button', { name: `${KEY}.removePhoto` })[0]);
    await waitFor(() => expect(thumbNames()).toEqual(['b.webp']));
    // The dropped photo's object URL is released with it — a preview holds the file's bytes.
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:a.webp');
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
    expect(thumbNames()).toEqual(['a.webp']);

    // Closing and reopening on ANOTHER order/step resets the dialog.
    rerender(<OrderAdvanceModal onClose={vi.fn()} />);
    rerender(
      <OrderAdvanceModal
        order={{ ...order, id: 13 }}
        action={action({ statusId: 3, requiresEvidence: true })}
        onClose={vi.fn()}
      />,
    );
    expect(thumbNames()).toEqual([]);
    // …and the abandoned preview is released rather than leaking for the tab's lifetime.
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:a.webp');
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
    // The dismiss button says "Volver", never "Cancelar" — beside a button that cancels the ORDER
    // that would be genuinely dangerous wording.
    expect(screen.getByRole('button', { name: `${KEY}.dismiss` })).toBeInTheDocument();
    expect(confirmButton('confirmCancel')).toBeDisabled();

    await userEvent.type(screen.getByLabelText(`${KEY}.reasonLabel`), '  Se canceló la fiesta  ');
    expect(confirmButton('confirmCancel')).toBeEnabled();
    await userEvent.click(confirmButton('confirmCancel'));

    await waitFor(() => expect(advanceOrder).toHaveBeenCalled());
    expect(advanceOrder.mock.calls[0][0]).toEqual({
      orderId: 12,
      toStatusId: 2,
      reason: 'Se canceló la fiesta',
    });
  });

  it('tells each role the TRUTH about cancelling: an admin can undo it, a driver cannot', () => {
    const cancel = action({
      kind: 'disruptive',
      statusId: 2,
      statusName: 'Cancelado',
      requiresReason: true,
      inventoryEffect: 'release',
    });
    // A driver: only an admin can bring it back, so for them it really is final.
    const { rerender } = render(
      <OrderAdvanceModal order={order} action={cancel} onClose={vi.fn()} />,
    );
    expect(screen.getByText(`${KEY}.cancelFinal`)).toBeInTheDocument();
    expect(screen.queryByText(`${KEY}.cancelReversible`)).not.toBeInTheDocument();

    // An admin: reversible — but only while the freed products are still free.
    useHasRole.mockReturnValue(true);
    rerender(<OrderAdvanceModal order={{ ...order, id: 13 }} action={cancel} onClose={vi.fn()} />);
    expect(screen.getByText(`${KEY}.cancelReversible`)).toBeInTheDocument();
    expect(screen.queryByText(`${KEY}.cancelFinal`)).not.toBeInTheDocument();
  });

  it('never promises that cancelling a SETTLED order frees anything', () => {
    // The order already walked to its last step (or its goods were delivered), so the lifecycle
    // engine reports `inventoryEffect: none` — the old blanket "sus productos volverán a estar
    // disponibles" was simply false there, and so was tying the undo to their availability.
    useHasRole.mockReturnValue(true);
    render(
      <OrderAdvanceModal
        order={order}
        action={action({
          kind: 'disruptive',
          statusId: 2,
          statusName: 'Cancelado',
          requiresReason: true,
          inventoryEffect: 'none',
        })}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText(`${KEY}.cancelDescriptionSettled`)).toBeInTheDocument();
    expect(screen.getByText(`${KEY}.cancelReversibleSettled`)).toBeInTheDocument();
    expect(screen.queryByText(`${KEY}.cancelDescription`)).not.toBeInTheDocument();
  });

  it('states what a move does to the goods — and warns when it TAKES them back', () => {
    // The forward step that ends the washing period: news, not a risk.
    const { rerender } = render(
      <OrderAdvanceModal
        order={order}
        action={action({ kind: 'forward', statusName: 'Listo', inventoryEffect: 'release' })}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText(`${KEY}.releaseNote`)).toBeInTheDocument();
    expect(screen.queryByText(`${KEY}.reclaimWarning`)).not.toBeInTheDocument();

    // Stepping BACK into a holding step reserves the units again — which someone else may already
    // have taken, so it can be refused. Said before the tap, not as a 409 afterwards.
    rerender(
      <OrderAdvanceModal
        order={{ ...order, id: 13 }}
        action={action({
          kind: 'backward',
          statusName: 'Recolectado',
          inventoryEffect: 'reclaim',
          purgesEvidence: true,
        })}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText(`${KEY}.reclaimWarning`)).toBeInTheDocument();
    expect(screen.queryByText(`${KEY}.releaseNote`)).not.toBeInTheDocument();
    // …and undoing a documented step destroys its photos, which is also said in advance.
    expect(screen.getByText(`${KEY}.purgeWarning`)).toBeInTheDocument();

    // A move that changes no reservation says nothing at all about inventory.
    rerender(
      <OrderAdvanceModal
        order={{ ...order, id: 14 }}
        action={action({ kind: 'forward', statusName: 'Entregado' })}
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByText(`${KEY}.releaseNote`)).not.toBeInTheDocument();
    expect(screen.queryByText(`${KEY}.reclaimWarning`)).not.toBeInTheDocument();
    expect(screen.queryByText(`${KEY}.purgeWarning`)).not.toBeInTheDocument();
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
    expect(confirmButton('confirmRewind')).toBeInTheDocument();
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

