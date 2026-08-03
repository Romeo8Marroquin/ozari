import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { useOrder } = vi.hoisted(() => ({ useOrder: vi.fn() }));
vi.mock('./useOrder', () => ({ useOrder }));

const { useOrdersCatalog } = vi.hoisted(() => ({ useOrdersCatalog: vi.fn() }));
vi.mock('./useOrdersCatalog', () => ({ useOrdersCatalog }));

const { useHasRole } = vi.hoisted(() => ({ useHasRole: vi.fn(() => true) }));
vi.mock('@hooks/useRole', () => ({ useHasRole }));

vi.mock('@tanstack/react-router', () => ({ useParams: () => ({ orderId: '12' }) }));

const { usePanelPageMotion } = vi.hoisted(() => ({ usePanelPageMotion: vi.fn() }));
vi.mock('../PanelPageTransitionContext', () => ({ usePanelPageMotion }));

const { staggerIn, staggerOut, growCardIn } = vi.hoisted(() => ({
  staggerIn: vi.fn(),
  staggerOut: vi.fn(() => Promise.resolve()),
  growCardIn: vi.fn(),
}));
vi.mock('../pageMotion', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../pageMotion')>()),
  staggerIn,
  staggerOut,
  growCardIn,
}));

// The three dialogs have their own suites; here they stand in as markers so the PAGE's job —
// deciding which action opens which one — is what's asserted.
vi.mock('./OrderAdvanceModal', () => ({
  default: ({ action, onClose }: { action?: { statusName: string }; onClose: () => void }) =>
    action ? (
      <div data-testid="advance-modal">
        {action.statusName}
        <button type="button" onClick={onClose}>
          cerrar-avance
        </button>
      </div>
    ) : null,
}));
vi.mock('./OrderStatusModal', () => ({
  default: ({ order, onClose }: { order?: { id: number }; onClose: () => void }) =>
    order ? (
      <div data-testid="status-modal">
        <button type="button" onClick={onClose}>
          cerrar-estado
        </button>
      </div>
    ) : null,
}));
vi.mock('./OrderDeleteModal', () => ({
  default: ({
    order,
    onClose,
    onDeleted,
  }: {
    order?: { id: number };
    onClose: () => void;
    onDeleted: () => void;
  }) =>
    order ? (
      <div data-testid="delete-modal">
        <button type="button" onClick={onDeleted}>
          borrado
        </button>
        <button type="button" onClick={onClose}>
          cerrar-borrado
        </button>
      </div>
    ) : null,
}));

// The full-size viewer has its own suite — a stub captures exactly which SET it was handed.
const lightbox = vi.hoisted(() => ({
  props: null as null | { images: { url: string }[]; initialIndex: number; label: string },
}));
vi.mock('@components/ImageLightbox', () => ({
  default: (props: {
    images: { url: string }[];
    initialIndex: number;
    label: string;
    onClose: () => void;
  }) => {
    lightbox.props = props;
    return (
      <button type="button" onClick={props.onClose}>
        lightbox-close
      </button>
    );
  },
}));

import { PanelNavContext, type PanelNav } from '../PanelNavContext';
import type { OrderAction, OrderDetail } from './order.types';
import OrderDetailPage from './OrderDetailPage';

const KEY = 'modules.panel.orders.detail';

const action = (over: Partial<OrderAction> & Pick<OrderAction, 'kind'>): OrderAction => ({
  statusId: 5,
  statusName: 'En ruta',
  requiresEvidence: false,
  minEvidence: 1,
  maxEvidence: 10,
  requiresReason: false,
  inventoryEffect: 'none',
  purgesEvidence: false,
  ...over,
});

const order = (over: Partial<OrderDetail> = {}): OrderDetail =>
  ({
    id: 12,
    clientName: 'María López',
    isRegistryClient: true,
    eventType: { id: 1, name: 'Evento familiar' },
    status: { id: 1, name: 'Pendiente', colorKey: 'amber' },
    nextStatus: { id: 5, name: 'En ruta' },
    actions: [],
    holdsInventory: true,
    paymentStatus: { id: 1, name: 'Pendiente' },
    deliveryAt: new Date('2026-08-01T14:00:00').toISOString(),
    pickupAt: new Date('2026-08-02T10:00:00').toISOString(),
    isMine: true,
    itemCount: 25,
    totalAmount: 450,
    currency: { id: 1, iso4217Code: 'GTQ', name: 'Quetzal', symbol: 'Q' },
    deliveryContact: 'WhatsApp 5555-1234',
    deliveryAddress: 'Zona 10',
    serviceStart: new Date('2026-08-01T14:00:00').toISOString(),
    serviceEnd: new Date('2026-08-02T10:00:00').toISOString(),
    lines: [
      {
        id: 31,
        productId: 3,
        productName: 'Silla plegable',
        isRental: true,
        quantity: 25,
        unitaryPrice: 6,
        parcialPrice: 150,
      },
    ],
    extras: [],
    statusHistory: [
      {
        id: 1,
        to: { id: 1, name: 'Pendiente' },
        byUserName: 'Romeo Marroquín',
        at: new Date('2026-07-16T12:00:00').toISOString(),
      },
    ],
    evidence: [],
    createdAt: new Date('2026-07-16T12:00:00').toISOString(),
    ...over,
  }) as OrderDetail;

const setOrder = (state: Record<string, unknown>) =>
  useOrder.mockReturnValue({
    data: undefined,
    isLoading: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
    ...state,
  });

const navigate = vi.fn();
// A FRESH element per call: React bails out of re-rendering a referentially identical element, so a
// shared constant would make `rerender` a no-op and hide the very transitions these tests assert.
const page = () => (
  <PanelNavContext.Provider value={{ navigateTo: navigate, pending: null } as unknown as PanelNav}>
    <OrderDetailPage />
  </PanelNavContext.Provider>
);
const renderPage = () => render(page());

beforeEach(() => {
  vi.clearAllMocks();
  lightbox.props = null;
  useHasRole.mockReturnValue(true);
  useOrdersCatalog.mockReturnValue({ data: { serviceStatuses: [{ id: 3, name: 'Entregado' }] } });
});

describe('OrderDetailPage', () => {
  it('shows the whole order: client, logistics, lines, money and the trail', () => {
    setOrder({ data: order() });
    renderPage();

    expect(screen.getByText('María López')).toBeInTheDocument();
    expect(screen.getByText('WhatsApp 5555-1234')).toBeInTheDocument();
    expect(screen.getByText('Zona 10')).toBeInTheDocument();
    expect(screen.getByText('Silla plegable')).toBeInTheDocument();
    expect(screen.getByText(/Q\s*450\.00/)).toBeInTheDocument();
    expect(screen.getByText(`${KEY}.history.created`)).toBeInTheDocument();
    // The status line tells you what's next, without you having to read the chip.
    expect(screen.getByText(`${KEY}.state.next`)).toBeInTheDocument();
  });

  it('renders the actions the BACKEND offered, and nothing it did not', async () => {
    setOrder({
      data: order({
        actions: [
          action({ kind: 'forward' }),
          action({ kind: 'backward', statusId: 1, statusName: 'Pendiente' }),
          action({ kind: 'disruptive', statusId: 2, statusName: 'Cancelado', requiresReason: true }),
        ],
      }),
    });
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: `${KEY}.actions.advance` }));
    expect(screen.getByTestId('advance-modal')).toHaveTextContent('En ruta');

    // Each offered move opens the same dialog with ITS action.
    await userEvent.click(screen.getByRole('button', { name: `${KEY}.actions.rewind` }));
    expect(screen.getByTestId('advance-modal')).toHaveTextContent('Pendiente');
    await userEvent.click(screen.getByRole('button', { name: `${KEY}.actions.cancel` }));
    expect(screen.getByTestId('advance-modal')).toHaveTextContent('Cancelado');

    // …and dismissing it clears the pending move, leaving the order untouched.
    await userEvent.click(screen.getByRole('button', { name: 'cerrar-avance' }));
    expect(screen.queryByTestId('advance-modal')).not.toBeInTheDocument();
  });

  it('offers navigation only on a step somebody actually DRIVES to', async () => {
    // The condition is the machine's own `tracksEvent`, never a status id: on a travel step the
    // button appears beside the advance action; on paperwork steps it would be noise.
    setOrder({ data: order({ actions: [action({ kind: 'forward' })] }) });
    const { unmount } = renderPage();
    expect(screen.queryByTestId('open-in-maps')).not.toBeInTheDocument();
    unmount();

    setOrder({
      data: order({ actions: [action({ kind: 'forward', tracksEvent: 'DELIVERY' })] }),
    });
    renderPage();
    expect(screen.getByTestId('open-in-maps')).toBeInTheDocument();
  });

  it('offers navigation to a DRIVER too — it is their button more than the admin’s', () => {
    useHasRole.mockReturnValue(false);
    setOrder({
      data: order({ actions: [action({ kind: 'forward', tracksEvent: 'COLLECTION' })] }),
    });
    renderPage();
    expect(screen.getByTestId('open-in-maps')).toBeInTheDocument();
  });

  it('gives a NON-admin no admin powers: no status control, no delete', () => {
    useHasRole.mockReturnValue(false);
    setOrder({ data: order({ actions: [action({ kind: 'forward' })] }) });
    renderPage();

    // The everyday move it was offered stays…
    expect(screen.getByRole('button', { name: `${KEY}.actions.advance` })).toBeInTheDocument();
    // …but the two powers that have no representation in `actions` are gone.
    expect(
      screen.queryByRole('button', { name: `${KEY}.actions.changeStatus` }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: `${KEY}.danger.delete` })).not.toBeInTheDocument();
    expect(screen.queryByText(`${KEY}.danger.title`)).not.toBeInTheDocument();
  });

  it('an ADMIN can change the status freely, and reopen a cancelled order', async () => {
    setOrder({ data: order() });
    const { unmount } = renderPage();
    await userEvent.click(screen.getByRole('button', { name: `${KEY}.actions.changeStatus` }));
    expect(screen.getByTestId('status-modal')).toBeInTheDocument();
    unmount();

    // A cancelled order relabels the same control — reopening IS a status change.
    setOrder({
      data: order({
        status: { id: 2, name: 'Cancelado', colorKey: 'red' },
        cancelledAt: new Date('2026-07-20T10:00:00').toISOString(),
        // No reason recorded (an older cancel) — the line still reads, with a dash.
        actions: [],
      }),
    });
    renderPage();
    expect(screen.getByText(`${KEY}.state.cancelled`)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: `${KEY}.actions.reopen` })).toBeInTheDocument();
  });

  it('sends an ADMIN to the edit page — rewriting what was agreed, never where the order stands', async () => {
    setOrder({ data: order() });
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: `${KEY}.actions.edit` }));
    expect(navigate).toHaveBeenCalledWith('/panel/pedidos/12/editar');
  });

  it('deletes and then leaves — there is no detail left to show', async () => {
    setOrder({ data: order() });
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: `${KEY}.danger.delete` }));
    await userEvent.click(screen.getByRole('button', { name: 'borrado' }));
    expect(navigate).toHaveBeenCalledWith('/panel/pedidos');
  });

  it('dismissing a dialog leaves the order exactly where it was', async () => {
    setOrder({ data: order({ actions: [action({ kind: 'forward' })] }) });
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: `${KEY}.danger.delete` }));
    await userEvent.click(screen.getByRole('button', { name: 'cerrar-borrado' }));
    expect(screen.queryByTestId('delete-modal')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: `${KEY}.actions.changeStatus` }));
    await userEvent.click(screen.getByRole('button', { name: 'cerrar-estado' }));
    expect(screen.queryByTestId('status-modal')).not.toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('groups the evidence under the step it documents', () => {
    setOrder({
      data: order({
        evidence: [
          { id: 9, statusId: 3, url: 'https://cdn.test/a.webp', at: '2026-08-01T15:00:00.000Z' },
          { id: 10, statusId: 3, url: 'https://cdn.test/b.webp', at: '2026-08-01T15:01:00.000Z' },
        ],
      }),
    });
    renderPage();

    expect(screen.getByText('Entregado')).toBeInTheDocument();
    expect(screen.getAllByRole('img')).toHaveLength(2);
    // Already there on the FIRST paint ⇒ it rides the page's own reveal, not a grow-in.
    expect(growCardIn).not.toHaveBeenCalled();
  });

  it('opens the viewer on ONE step\'s photos — a delivery never pages into a collection', async () => {
    useOrdersCatalog.mockReturnValue({
      data: {
        serviceStatuses: [
          { id: 3, name: 'Entregado' },
          { id: 4, name: 'Recolectado' },
        ],
      },
    });
    setOrder({
      data: order({
        evidence: [
          { id: 9, statusId: 3, url: 'https://cdn.test/a.webp', at: '2026-08-01T15:00:00.000Z' },
          { id: 10, statusId: 3, url: 'https://cdn.test/b.webp', at: '2026-08-01T15:01:00.000Z' },
          { id: 11, statusId: 4, url: 'https://cdn.test/c.webp', at: '2026-08-02T11:00:00.000Z' },
        ],
      }),
    });
    renderPage();

    // The SECOND delivery photo opens its own set, positioned on itself.
    await userEvent.click(screen.getAllByRole('button', { name: `${KEY}.evidence.open` })[1]);
    expect(lightbox.props).toMatchObject({ initialIndex: 1, label: 'Entregado' });
    // …and that set is the delivery's alone: the collection's photo is not in it.
    expect(lightbox.props?.images.map((image) => image.url)).toEqual([
      'https://cdn.test/a.webp',
      'https://cdn.test/b.webp',
    ]);

    // The collection's single photo opens a set of exactly one.
    await userEvent.click(screen.getByText('lightbox-close'));
    await userEvent.click(screen.getAllByRole('button', { name: `${KEY}.evidence.open` })[2]);
    expect(lightbox.props).toMatchObject({ initialIndex: 0, label: 'Recolectado' });
    expect(lightbox.props?.images).toHaveLength(1);
  });

  it('grows the evidence card open when a move documents a step under a settled page', () => {
    setOrder({ data: order() });
    const { rerender } = renderPage();
    expect(screen.queryByText(`${KEY}.evidence.title`)).not.toBeInTheDocument();

    // The advance landed and the refetch brought photos: a whole card now joins the middle of the
    // column, so its space eases open instead of shoving everything below it down.
    setOrder({
      data: order({
        evidence: [
          { id: 9, statusId: 3, url: 'https://cdn.test/a.webp', at: '2026-08-01T15:00:00.000Z' },
        ],
      }),
    });
    rerender(page());
    expect(screen.getByText(`${KEY}.evidence.title`)).toBeInTheDocument();
    expect(growCardIn).toHaveBeenCalledTimes(1);
  });

  it('says so plainly for a finished order, and for one with nothing left to do', () => {
    setOrder({
      data: order({ readyAt: new Date('2026-08-03T09:00:00').toISOString(), nextStatus: undefined }),
    });
    const { unmount } = renderPage();
    expect(screen.getByText(`${KEY}.state.finished`)).toBeInTheDocument();
    unmount();

    setOrder({ data: order({ nextStatus: undefined }) });
    renderPage();
    expect(screen.getByText(`${KEY}.state.idle`)).toBeInTheDocument();
  });

  it('shows every optional fact when the order carries them', () => {
    setOrder({
      data: order({
        description: 'Cumpleaños en el jardín',
        comment: 'Llamar al llegar',
        assignee: { id: 4, name: 'Carlos Ruiz' },
        deliveredAt: new Date('2026-08-01T14:20:00').toISOString(),
        collectedAt: new Date('2026-08-02T10:20:00').toISOString(),
        readyAt: new Date('2026-08-03T09:00:00').toISOString(),
        deliveryAmount: 50,
        depositAmount: 100,
        discountAmount: 25,
        paymentMethod: { id: 1, name: 'Efectivo' },
        paidAt: new Date('2026-08-03T10:00:00').toISOString(),
        lines: [
          {
            id: 32,
            productId: 4,
            productName: 'Vasos',
            isRental: false,
            quantity: 10,
            unitaryPrice: 3.5,
            parcialPrice: 35,
          },
        ],
      }),
    });
    renderPage();

    expect(screen.getByText('Cumpleaños en el jardín')).toBeInTheDocument();
    expect(screen.getByText('Llamar al llegar')).toBeInTheDocument();
    expect(screen.getByText('Carlos Ruiz')).toBeInTheDocument();
    expect(screen.getByText('Efectivo')).toBeInTheDocument();
    expect(screen.getByText(`${KEY}.money.delivery`)).toBeInTheDocument();
    expect(screen.getByText(`${KEY}.money.discount`)).toBeInTheDocument();
    // A sale line reads as a sale, and the tracked actuals are all spelled out.
    expect(screen.getByText(new RegExp(`${KEY}.lines.sale`))).toBeInTheDocument();
    expect(screen.getByText(`${KEY}.logistics.delivered`)).toBeInTheDocument();
    expect(screen.getByText(`${KEY}.logistics.collected`)).toBeInTheDocument();
    expect(screen.getByText(`${KEY}.logistics.ready`)).toBeInTheDocument();
  });

  it('omits what an order does not have, and says so where it matters', () => {
    setOrder({
      data: order({
        pickupAt: undefined,
        assignee: undefined,
        deliveryAmount: undefined,
        discountAmount: undefined,
        depositAmount: undefined,
        paymentMethod: undefined,
        paidAt: undefined,
      }),
    });
    renderPage();

    // A purchase-only order SAYS it has no pickup rather than leaving a blank row…
    expect(screen.getByText(`${KEY}.logistics.noPickup`)).toBeInTheDocument();
    expect(screen.getByText(`${KEY}.logistics.unassigned`)).toBeInTheDocument();
    // …while money it doesn't have simply isn't shown (never an empty label).
    expect(screen.queryByText(`${KEY}.money.delivery`)).not.toBeInTheDocument();
    expect(screen.queryByText(`${KEY}.money.discount`)).not.toBeInTheDocument();
    expect(screen.queryByText(`${KEY}.money.deposit`)).not.toBeInTheDocument();
    expect(screen.queryByText(`${KEY}.money.paidAt`)).not.toBeInTheDocument();
    // No photos ⇒ no evidence section at all.
    expect(screen.queryByText(`${KEY}.evidence.title`)).not.toBeInTheDocument();
  });

  it('names an unknown evidence step by id rather than breaking', () => {
    useOrdersCatalog.mockReturnValue({ data: undefined });
    setOrder({
      data: order({
        evidence: [
          { id: 9, statusId: 77, url: 'https://cdn.test/a.webp', at: '2026-08-01T15:00:00.000Z' },
        ],
      }),
    });
    renderPage();
    expect(screen.getByText('#77')).toBeInTheDocument();
  });

  it('shows a moved-status trail entry, not only the creation row', () => {
    setOrder({
      data: order({
        statusHistory: [
          {
            id: 2,
            from: { id: 1, name: 'Pendiente' },
            to: { id: 5, name: 'En ruta' },
            byUserName: 'Ana Díaz',
            at: new Date('2026-08-01T13:00:00').toISOString(),
          },
        ],
      }),
    });
    renderPage();
    expect(screen.getByText(`${KEY}.history.moved`)).toBeInTheDocument();
  });

  it('shows a not-found panel for an order that is missing OR not yours', async () => {
    setOrder({ isError: true, error: { response: { status: 404 } } });
    renderPage();

    expect(screen.getByText(`${KEY}.notFound.title`)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: `${KEY}.notFound.action` }));
    expect(navigate).toHaveBeenCalledWith('/panel/pedidos');
  });

  it('offers a retry for a transient failure, and a skeleton on a cold load', async () => {
    const refetch = vi.fn();
    setOrder({ isError: true, error: { response: { status: 500 } }, refetch });
    const { unmount } = renderPage();
    expect(screen.getByText(`${KEY}.error.title`)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: `${KEY}.error.retry` }));
    expect(refetch).toHaveBeenCalled();
    unmount();

    setOrder({ isLoading: true });
    renderPage();
    expect(screen.queryByText(`${KEY}.error.title`)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: `${KEY}.back` })).toBeInTheDocument();
  });

  it('resolves the cold skeleton IN PLACE — never as a second page entrance', () => {
    setOrder({ isLoading: true });
    const { rerender } = renderPage();
    // The placeholder announces itself and is the page's own structure, not a spinner.
    expect(screen.getByRole('status')).toHaveAttribute('aria-label', `${KEY}.loading`);
    expect(staggerIn).toHaveBeenCalledTimes(1);

    setOrder({ data: order() });
    rerender(page());
    // The skeleton hands over to the real cards…
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByText('María López')).toBeInTheDocument();
    // …through `SectionReveal`'s in-place dissolve: replaying the page stagger here would blank the
    // whole column (back button included) and re-run the entrance — the "reload" jank.
    expect(staggerIn).toHaveBeenCalledTimes(1);
  });

  it('registers its enter/exit pair with the panel transition controller', async () => {
    setOrder({ data: order() });
    renderPage();
    // The page plays its own entrance on mount…
    expect(staggerIn).toHaveBeenCalled();
    // …and hands the controller a matching pair so leaving sweeps the cards out.
    const motion = usePanelPageMotion.mock.calls[0]?.[0] as {
      enter: (options?: unknown) => void;
      exit: () => Promise<void>;
    };
    motion.enter();
    await motion.exit();
    expect(staggerOut).toHaveBeenCalled();
  });

  it('goes back to the agenda through the panel transition', async () => {
    setOrder({ data: order() });
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: `${KEY}.back` }));
    expect(navigate).toHaveBeenCalledWith('/panel/pedidos');
  });
});
