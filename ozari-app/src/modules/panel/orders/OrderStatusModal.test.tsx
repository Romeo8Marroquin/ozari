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

const { notify } = vi.hoisted(() => ({ notify: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@components/notifications/notify', () => ({ notify }));

const { toFormError } = vi.hoisted(() => ({ toFormError: vi.fn(() => ({})) }));
vi.mock('@utils/apiError', () => ({ toFormError }));

import type { OrderDetail, OrderStatusCatalogOption } from './order.types';
import OrderStatusModal from './OrderStatusModal';

const KEY = 'modules.panel.orders.detail.changeStatus';

const status = (
  over: Partial<OrderStatusCatalogOption> & Pick<OrderStatusCatalogOption, 'id' | 'name'>,
): OrderStatusCatalogOption => ({
  isInitial: false,
  isDisruptive: false,
  inventoryHold: 'NONE',
  requiresEvidence: false,
  minEvidence: 1,
  maxEvidence: 10,
  appliesTo: 'ALL',
  ...over,
});

// The seeded holds: only Listo returns the units to the fleet (Recolectado still holds them — the
// washing period), so the dialog's inventory copy has something real to derive from.
const STATUSES: OrderStatusCatalogOption[] = [
  status({ id: 1, name: 'Pendiente', sortOrder: 1, isInitial: true, inventoryHold: 'WINDOW' }),
  status({ id: 5, name: 'En ruta', sortOrder: 2, inventoryHold: 'OUT' }),
  status({
    id: 3,
    name: 'Entregado',
    sortOrder: 3,
    requiresEvidence: true,
    inventoryHold: 'OUT',
  }),
  status({
    id: 4,
    name: 'Recolectado',
    sortOrder: 4,
    requiresEvidence: true,
    appliesTo: 'RENTAL',
    inventoryHold: 'OUT',
  }),
  status({ id: 6, name: 'Listo', sortOrder: 5, appliesTo: 'RENTAL' }),
  status({ id: 2, name: 'Cancelado', isDisruptive: true }),
];

const order = (over: Partial<OrderDetail> = {}): OrderDetail =>
  ({
    id: 12,
    clientName: 'María López',
    status: { id: 1, name: 'Pendiente' },
    lines: [{ isRental: true }],
    ...over,
  }) as OrderDetail;

const photo = (name: string): File => new File(['x'], name, { type: 'image/webp' });
const pick = async (value: string) =>
  userEvent.selectOptions(screen.getByLabelText(`${KEY}.targetLabel`), value);
const confirm = () => screen.getByRole('button', { name: `${KEY}.confirm` });

beforeEach(() => {
  vi.clearAllMocks();
  uploadEvidence.mockResolvedValue([]);
  URL.createObjectURL = vi.fn((file: Blob) => `blob:${(file as File).name}`);
  URL.revokeObjectURL = vi.fn();
});

describe('OrderStatusModal', () => {
  it('renders nothing until an order is chosen', () => {
    const { container } = render(<OrderStatusModal statuses={STATUSES} onClose={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('offers only the steps this order can be placed on, never where it already is', () => {
    render(<OrderStatusModal order={order()} statuses={STATUSES} onClose={vi.fn()} />);
    const options = screen.getByLabelText(`${KEY}.targetLabel`).querySelectorAll('option');
    const labels = [...options].map((option) => option.textContent);
    expect(labels).toContain('En ruta');
    expect(labels).toContain('Listo');
    // Not the current step, and never a disruptive off-ramp (cancel is its own action).
    expect(labels).not.toContain('Pendiente');
    expect(labels).not.toContain('Cancelado');
    expect(confirm()).toBeDisabled();
  });

  it('a purchase-only order is never offered a rental-only step', () => {
    render(
      <OrderStatusModal
        order={order({ lines: [{ isRental: false }] } as Partial<OrderDetail>)}
        statuses={STATUSES}
        onClose={vi.fn()}
      />,
    );
    const labels = [...screen.getByLabelText(`${KEY}.targetLabel`).querySelectorAll('option')].map(
      (option) => option.textContent,
    );
    expect(labels).toContain('Entregado');
    expect(labels).not.toContain('Recolectado');
    expect(labels).not.toContain('Listo');
  });

  it('spells out the WALK and collects every demanding step\'s photos in one pass', async () => {
    uploadEvidence.mockImplementation(async (files: File[]) =>
      files.map((file) => `orders/evidence/${file.name}`),
    );
    render(<OrderStatusModal order={order()} statuses={STATUSES} onClose={vi.fn()} />);

    await pick('4'); // Pendiente → Recolectado: three steps, two of them documented
    expect(screen.getByText(`${KEY}.walk`)).toBeInTheDocument();
    // It refuses to submit until BOTH demanding steps have their minimum.
    expect(confirm()).toBeDisabled();

    const pickers = screen.getAllByLabelText(`${KEY}.stepPhotos`);
    expect(pickers).toHaveLength(2);
    await userEvent.upload(pickers[0], [photo('entregado.webp')]);
    expect(confirm()).toBeDisabled();
    await userEvent.upload(pickers[1], [photo('recolectado.webp')]);
    expect(confirm()).toBeEnabled();

    await userEvent.click(confirm());
    await waitFor(() => expect(advanceOrder).toHaveBeenCalled());
    // Photos are tagged with the STEP they document, not dumped on the target.
    expect(advanceOrder.mock.calls[0][0]).toEqual({
      orderId: 12,
      toStatusId: 4,
      evidence: [
        { statusId: 3, keys: ['orders/evidence/entregado.webp'] },
        { statusId: 4, keys: ['orders/evidence/recolectado.webp'] },
      ],
    });
  });

  it('warns which photos a REWIND will destroy, and asks for none', async () => {
    render(
      <OrderStatusModal
        order={order({ status: { id: 6, name: 'Listo' } })}
        statuses={STATUSES}
        onClose={vi.fn()}
      />,
    );
    await pick('5'); // Listo → En ruta undoes Recolectado + Entregado

    expect(screen.getByText(`${KEY}.purgeWarning`)).toBeInTheDocument();
    expect(screen.queryAllByLabelText(`${KEY}.stepPhotos`)).toHaveLength(0);
    expect(confirm()).toBeEnabled();
  });

  it('says what LANDING on the target does to the goods, and warns when it takes them back', async () => {
    const { unmount } = render(
      <OrderStatusModal
        order={order({ status: { id: 4, name: 'Recolectado' } })}
        statuses={STATUSES}
        onClose={vi.fn()}
      />,
    );
    // Forward onto Listo ends the washing period: the units go back to the fleet.
    await pick('6');
    expect(screen.getByText(`${KEY}.releaseNote`)).toBeInTheDocument();
    expect(screen.queryByText(`${KEY}.reclaimWarning`)).not.toBeInTheDocument();
    // Backwards inside the holding stretch changes no reservation, so it claims nothing.
    await pick('3');
    expect(screen.queryByText(`${KEY}.releaseNote`)).not.toBeInTheDocument();
    expect(screen.queryByText(`${KEY}.reclaimWarning`)).not.toBeInTheDocument();
    unmount();

    // From Listo, going back re-apartas the products — which may no longer be free. The admin is
    // told BEFORE submitting, instead of meeting the 409 afterwards.
    render(
      <OrderStatusModal
        order={order({ status: { id: 6, name: 'Listo' } })}
        statuses={STATUSES}
        onClose={vi.fn()}
      />,
    );
    await pick('4');
    expect(screen.getByText(`${KEY}.reclaimWarning`)).toBeInTheDocument();
  });

  it('reopens a cancelled order without asking for anything', async () => {
    const onClose = vi.fn();
    render(
      <OrderStatusModal
        order={order({
          status: { id: 2, name: 'Cancelado' },
          cancelledAt: '2026-07-20T10:00:00.000Z',
        })}
        statuses={STATUSES}
        onClose={onClose}
      />,
    );
    expect(screen.getByText(`${KEY}.reopenTitle`)).toBeInTheDocument();

    await pick('3'); // straight back onto Entregado — a reopen is not a walk
    expect(screen.queryAllByLabelText(`${KEY}.stepPhotos`)).toHaveLength(0);
    await userEvent.click(confirm());

    await waitFor(() => expect(advanceOrder).toHaveBeenCalled());
    expect(advanceOrder.mock.calls[0][0]).toEqual({ orderId: 12, toStatusId: 3 });
    advanceOrder.mock.calls[0][1].onSuccess();
    expect(notify.success).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('shows a reopen CONFLICT per product, with the real counts', async () => {
    render(
      <OrderStatusModal
        order={order({
          status: { id: 2, name: 'Cancelado' },
          cancelledAt: '2026-07-20T10:00:00.000Z',
        })}
        statuses={STATUSES}
        onClose={vi.fn()}
      />,
    );
    await pick('5');
    await userEvent.click(confirm());
    await waitFor(() => expect(advanceOrder).toHaveBeenCalled());

    advanceOrder.mock.calls[0][1].onError({
      response: {
        data: {
          data: {
            conflicts: [
              { productId: 3, productName: 'Sillas', requested: 25, available: 8 },
            ],
          },
        },
      },
    });

    // The decision needs the numbers, so the conflict is inline and per product — not a toast.
    expect(await screen.findByText(`${KEY}.conflictLine`)).toBeInTheDocument();
    expect(screen.getByText(`${KEY}.errors.conflict`)).toBeInTheDocument();
    expect(notify.error).not.toHaveBeenCalled();
  });

  it('routes any other failure through the form doctrine, and never advances on a failed upload', async () => {
    toFormError.mockReturnValue({ toast: 'demasiadas solicitudes' });
    render(<OrderStatusModal order={order()} statuses={STATUSES} onClose={vi.fn()} />);
    await pick('5');
    await userEvent.click(confirm());
    await waitFor(() => expect(advanceOrder).toHaveBeenCalled());
    advanceOrder.mock.calls[0][1].onError(new Error('429'));
    expect(await screen.findByText(`${KEY}.errors.fallback`)).toBeInTheDocument();
    expect(notify.error).toHaveBeenCalledWith('demasiadas solicitudes');

    // A contextual failure lands inline ONLY — no toast over a dialog that already explains itself.
    vi.clearAllMocks();
    toFormError.mockReturnValue({ inline: 'ya cambió' });
    await userEvent.click(confirm());
    await waitFor(() => expect(advanceOrder).toHaveBeenCalled());
    advanceOrder.mock.calls[0][1].onError(new Error('409'));
    expect(await screen.findByText('ya cambió')).toBeInTheDocument();
    expect(notify.error).not.toHaveBeenCalled();

    // A failed photo upload leaves the order exactly where it was — inline, and (being ambient)
    // also toasted.
    vi.clearAllMocks();
    uploadEvidence.mockRejectedValue(new Error('network'));
    toFormError.mockReturnValue({ toast: 'sin conexión' });
    await pick('3');
    await userEvent.upload(screen.getByLabelText(`${KEY}.stepPhotos`), [photo('a.webp')]);
    await userEvent.click(confirm());
    expect(await screen.findByText(`${KEY}.errors.upload`)).toBeInTheDocument();
    expect(advanceOrder).not.toHaveBeenCalled();
    expect(notify.error).toHaveBeenCalledWith('sin conexión');

    // …while an OUTAGE stays silent: the app overlay owns that, not a toast over a dialog.
    vi.clearAllMocks();
    toFormError.mockReturnValue({});
    await userEvent.click(confirm());
    expect(await screen.findByText(`${KEY}.errors.upload`)).toBeInTheDocument();
    expect(notify.error).not.toHaveBeenCalled();
  });

  it('caps a step at its maximum and lets a staged photo be removed', async () => {
    render(
      <OrderStatusModal
        order={order()}
        statuses={STATUSES.map((step) =>
          step.id === 3 ? { ...step, maxEvidence: 2 } : step,
        )}
        onClose={vi.fn()}
      />,
    );
    await pick('3');
    const picker = screen.getByLabelText(`${KEY}.stepPhotos`);
    await userEvent.upload(picker, [photo('a.webp'), photo('b.webp'), photo('c.webp')]);
    expect(screen.getAllByRole('img').map((image) => image.getAttribute('alt'))).toEqual([
      'a.webp',
      'b.webp',
    ]);
    expect(screen.getByRole('button', { name: `${KEY}.addPhotos` })).toBeDisabled();

    await userEvent.click(screen.getAllByRole('button', { name: `${KEY}.removePhoto` })[0]);
    await waitFor(() =>
      expect(screen.getAllByRole('img').map((image) => image.getAttribute('alt'))).toEqual([
        'b.webp',
      ]),
    );
  });

  it('opens the picker from the visible button (the input itself is off-screen)', async () => {
    render(<OrderStatusModal order={order()} statuses={STATUSES} onClose={vi.fn()} />);
    await pick('3');
    const input = screen.getByLabelText(`${KEY}.stepPhotos`) as HTMLInputElement;
    const click = vi.spyOn(input, 'click');
    await userEvent.click(screen.getByRole('button', { name: `${KEY}.addPhotos` }));
    expect(click).toHaveBeenCalled();
  });

  it('starts clean for a DIFFERENT order (no staged photos carry over)', async () => {
    const { rerender } = render(
      <OrderStatusModal order={order()} statuses={STATUSES} onClose={vi.fn()} />,
    );
    await pick('3');
    await userEvent.upload(screen.getByLabelText(`${KEY}.stepPhotos`), [photo('a.webp')]);
    expect(screen.getAllByRole('img')).toHaveLength(1);

    rerender(
      <OrderStatusModal order={order({ id: 13 })} statuses={STATUSES} onClose={vi.fn()} />,
    );
    expect(screen.queryAllByRole('img')).toHaveLength(0);
    expect(confirm()).toBeDisabled();
  });

  it('clearing the pick resets the dialog to "choose a step"', async () => {
    render(<OrderStatusModal order={order()} statuses={STATUSES} onClose={vi.fn()} />);
    await pick('5');
    expect(confirm()).toBeEnabled();
    await pick('');
    expect(confirm()).toBeDisabled();
  });

  it('ignores a cancelled picker and re-picking the same target', async () => {
    render(<OrderStatusModal order={order()} statuses={STATUSES} onClose={vi.fn()} />);
    await pick('3');
    const picker = screen.getByLabelText(`${KEY}.stepPhotos`);
    // The user opened the picker and closed it without choosing — nothing is staged, no crash.
    fireEvent.change(picker, { target: { files: null } });
    expect(screen.queryAllByRole('img')).toHaveLength(0);

    // Changing the target clears whatever was staged for the previous walk.
    await userEvent.upload(picker, [photo('a.webp')]);
    await pick('5');
    await pick('3');
    expect(screen.queryAllByRole('img')).toHaveLength(0);
  });

  it('EXTENDS the walk instead of rebuilding it: a step the new target still crosses keeps its photos', async () => {
    render(<OrderStatusModal order={order()} statuses={STATUSES} onClose={vi.fn()} />);

    await pick('3'); // Pendiente → Entregado: one picker
    await userEvent.upload(screen.getByLabelText(`${KEY}.stepPhotos`), [photo('entregado.webp')]);
    expect(screen.getAllByRole('img')).toHaveLength(1);

    // Aiming further along ADDS the next step's picker. "Entregado" is still crossed, so the photo
    // already staged for it stays — reaching further is not a reason to make the admin start over.
    await pick('4');
    expect(screen.getAllByLabelText(`${KEY}.stepPhotos`)).toHaveLength(2);
    expect(screen.getAllByRole('img').map((image) => image.getAttribute('alt'))).toEqual([
      'entregado.webp',
    ]);
    expect(confirm()).toBeDisabled(); // …and the NEW step still owes its minimum.

    // Pulling the target back drops the step that left the walk, and releases its previews.
    await userEvent.upload(
      screen.getAllByLabelText(`${KEY}.stepPhotos`)[1],
      [photo('recolectado.webp')],
    );
    await pick('3');
    expect(screen.getAllByLabelText(`${KEY}.stepPhotos`)).toHaveLength(1);
    expect(screen.getAllByRole('img').map((image) => image.getAttribute('alt'))).toEqual([
      'entregado.webp',
    ]);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:recolectado.webp');
  });
});
