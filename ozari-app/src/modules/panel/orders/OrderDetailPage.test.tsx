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

const { staggerIn, staggerOut, growCardIn, bringIntoPanelView } = vi.hoisted(() => ({
  staggerIn: vi.fn(),
  staggerOut: vi.fn(() => Promise.resolve()),
  growCardIn: vi.fn(),
  bringIntoPanelView: vi.fn(),
}));
vi.mock('../pageMotion', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../pageMotion')>()),
  staggerIn,
  staggerOut,
  growCardIn,
  bringIntoPanelView,
}));

// The damage report download (inside the real Depósito card) is the documents' own suite.
vi.mock('../documents/DamageReportButton', () => ({
  default: () => <span data-testid="damage-report" />,
}));

// The document action has its OWN suite (which is where "not on a cancelled order", the letterhead
// and the paid balance are pinned). Here it is a marker, like the dialogs below: the page's job is
// only to offer it to an admin. Standing in also keeps this suite free of the preferences query the
// real button reads.
vi.mock('../documents/OrderDocumentButton', () => ({
  default: ({ order }: { order: { id: number } }) => (
    <span data-testid="order-document">{order.id}</span>
  ),
}));

// The three dialogs have their own suites; here they stand in as markers so the PAGE's job —
// deciding which action opens which one — is what's asserted.
// The payment dialog has its own suite (and its own query client); the page only has to open it.
vi.mock('./OrderPaymentModal', () => ({
  default: ({ order, onClose }: { order?: { id: number }; onClose: () => void }) =>
    order ? (
      <div data-testid="payment-modal">
        {order.id}
        <button type="button" onClick={onClose}>
          cerrar-pago
        </button>
      </div>
    ) : null,
}));

// The undo dialog likewise: its own suite owns the copy and the 409; the page only has to offer it
// (and only to an admin, only once the money is in) and open it.
vi.mock('./OrderPaymentUndoModal', () => ({
  default: ({ order, onClose }: { order?: { id: number }; onClose: () => void }) =>
    order ? (
      <div data-testid="payment-undo-modal">
        {order.id}
        <button type="button" onClick={onClose}>
          cerrar-deshacer-pago
        </button>
      </div>
    ) : null,
}));

// The settlement undo likewise: its suite owns the copy ("moves no money") and the 409.
vi.mock('./OrderSettlementUndoModal', () => ({
  default: ({ order, onClose }: { order?: { id: number }; onClose: () => void }) =>
    order ? (
      <div data-testid="settlement-undo-modal">
        {order.id}
        <button type="button" onClick={onClose}>
          cerrar-deshacer-deposito
        </button>
      </div>
    ) : null,
}));

// The deposit's happy path ("Devolver depósito") likewise: its suite owns the copy and the call.
vi.mock('./OrderDepositRefundModal', () => ({
  default: ({ order, onClose }: { order?: { id: number }; onClose: () => void }) =>
    order ? (
      <div data-testid="deposit-refund-modal">
        {order.id}
        <button type="button" onClick={onClose}>
          cerrar-devolver-deposito
        </button>
      </div>
    ) : null,
}));

vi.mock('./OrderDepositCollectionModal', () => ({
  default: ({
    order,
    mode,
    onClose,
  }: {
    order?: { id: number };
    mode?: string;
    onClose: () => void;
  }) =>
    order ? (
      <div data-testid="deposit-collection-modal">
        {`${order.id}:${mode}`}
        <button type="button" onClick={onClose}>
          cerrar-cobro-deposito
        </button>
      </div>
    ) : null,
}));

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
        damagedQuantity: 0,
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
    depositHistory: [],
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
    // The TOTAL, and — nothing paid yet — the cuadre's single answer under it, the same amount.
    expect(screen.getAllByText(/Q\s*450\.00/)).toHaveLength(2);
    expect(screen.getByText(`${KEY}.money.balance.collect`)).toBeInTheDocument();
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

  const PIN = { lat: 14.634915, lng: -90.506883 };

  it('offers navigation only when the next move is a TRIP, on the same rule as every other screen', async () => {
    // Out for delivery: the next move CONFIRMS an arrival (`tracksEvent`), so somebody is driving.
    setOrder({
      data: order({
        deliveryCoords: PIN,
        actions: [action({ kind: 'forward', statusName: 'Entregado', tracksEvent: 'DELIVERY' })],
      }),
    });
    const { unmount } = renderPage();
    expect(screen.getByTestId('open-in-maps')).toBeInTheDocument();
    unmount();

    // Delivered, with the collection still ahead ⇒ the return trip is next.
    setOrder({
      data: order({
        deliveryCoords: PIN,
        deliveredAt: '2026-08-01T14:10:00.000Z',
        actions: [action({ kind: 'forward', statusName: 'Recolectado', tracksEvent: 'COLLECTION' })],
      }),
    });
    const second = renderPage();
    expect(screen.getByTestId('open-in-maps')).toBeInTheDocument();
    second.unmount();

    // Still pending: the next move is "En ruta", which tracks nothing — it is the loading, and the
    // van has not left. Offering directions here is what put a Waze button on next week's orders.
    setOrder({
      data: order({ deliveryCoords: PIN, actions: [action({ kind: 'forward' })] }),
    });
    const third = renderPage();
    expect(screen.queryByTestId('open-in-maps')).not.toBeInTheDocument();
    third.unmount();

    // A rewind or a cancel is desk work — neither can qualify, so an order whose only offers are
    // disruptive gets nothing.
    setOrder({
      data: order({
        deliveryCoords: PIN,
        cancelledAt: '2026-08-01T09:00:00.000Z',
        actions: [action({ kind: 'disruptive' })],
      }),
    });
    renderPage();
    expect(screen.queryByTestId('open-in-maps')).not.toBeInTheDocument();
  });

  it('states whether the order has a PIN, so a saved one is never invisible', () => {
    setOrder({ data: order({ deliveryCoords: PIN }) });
    const { unmount } = renderPage();
    expect(screen.getByText('14.634915, -90.506883')).toBeInTheDocument();
    unmount();

    setOrder({ data: order() });
    renderPage();
    expect(screen.getByText(`${KEY}.client.noCoords`)).toBeInTheDocument();
  });

  it('offers navigation ONLY when the order has a real pin, never from address text alone', () => {
    // An address like "Zona 10, 4a avenida 5-55" is not reliably geocodable, so a button built on it
    // opens a maps app somewhere unrelated while looking exactly as trustworthy as a pin.
    setOrder({
      data: order({ actions: [action({ kind: 'forward', tracksEvent: 'DELIVERY' })] }),
    });
    renderPage();
    expect(screen.queryByTestId('open-in-maps')).not.toBeInTheDocument();
  });

  it('offers navigation to a DRIVER too — it is their button more than the admin’s', () => {
    useHasRole.mockReturnValue(false);
    setOrder({
      data: order({
        deliveryCoords: PIN,
        actions: [action({ kind: 'forward', tracksEvent: 'COLLECTION' })],
      }),
    });
    renderPage();
    expect(screen.getByTestId('open-in-maps')).toBeInTheDocument();
  });

  it('offers "registrar pago" to an admin while unpaid, and opens the shared dialog', async () => {
    setOrder({ data: order({ isPaid: false }) });
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: `${KEY}.actions.pay` }));
    expect(screen.getByTestId('payment-modal')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'cerrar-pago' }));
    expect(screen.queryByTestId('payment-modal')).not.toBeInTheDocument();
  });

  it('drops the payment action once the money is in, and never offers it to a non-admin', () => {
    setOrder({ data: order({ isPaid: true }) });
    const { unmount } = renderPage();
    expect(screen.queryByRole('button', { name: `${KEY}.actions.pay` })).not.toBeInTheDocument();
    unmount();

    useHasRole.mockReturnValue(false);
    setOrder({ data: order({ isPaid: false }) });
    renderPage();
    expect(screen.queryByRole('button', { name: `${KEY}.actions.pay` })).not.toBeInTheDocument();
  });

  it('offers the way BACK from a payment, and only where a considered tap belongs', async () => {
    // Recording payment is one irreversible-looking tap on three screens and the API answers 409 on
    // the second, so a mis-tap had no way back at all. The undo lives HERE and nowhere else: the
    // agenda and the dashboard are scanning surfaces where an undo beside "Registrar pago" is an
    // invitation to hit the wrong one at a glance.
    setOrder({ data: order({ isPaid: true }) });
    const { unmount } = renderPage();
    await userEvent.click(screen.getByRole('button', { name: `${KEY}.actions.undoPay` }));
    expect(screen.getByTestId('payment-undo-modal')).toBeInTheDocument();
    // Dismissing it leaves the order exactly where it was — the action is still there to take.
    await userEvent.click(screen.getByRole('button', { name: 'cerrar-deshacer-pago' }));
    expect(screen.queryByTestId('payment-undo-modal')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: `${KEY}.actions.undoPay` })).toBeInTheDocument();
    unmount();

    // Nothing to undo while the money is still out.
    setOrder({ data: order({ isPaid: false }) });
    const { unmount: second } = renderPage();
    expect(screen.queryByRole('button', { name: `${KEY}.actions.undoPay` })).not.toBeInTheDocument();
    second();

    // Money is the admin's — correcting it too.
    useHasRole.mockReturnValue(false);
    setOrder({ data: order({ isPaid: true }) });
    renderPage();
    expect(screen.queryByRole('button', { name: `${KEY}.actions.undoPay` })).not.toBeInTheDocument();
  });

  it('offers the DOCUMENT to an admin regardless of payment, and never to anyone else', () => {
    // Its own suite decides when it renders nothing (a cancelled order); the page's job is simply
    // to put it in an admin's hands — including once the order is paid, when the same document
    // becomes the client's proof rather than their bill.
    setOrder({ data: order({ isPaid: true }) });
    const { unmount } = renderPage();
    expect(screen.getByTestId('order-document')).toBeInTheDocument();
    unmount();

    useHasRole.mockReturnValue(false);
    setOrder({ data: order() });
    renderPage();
    expect(screen.queryByTestId('order-document')).not.toBeInTheDocument();
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

  it('has NO Depósito card when the API sent no deposit block (most orders)', () => {
    setOrder({ data: order() });
    renderPage();
    expect(screen.queryByRole('heading', { name: `${KEY}.deposit.title` })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: `${KEY}.actions.depositPending` }),
    ).not.toBeInTheDocument();
  });

  it('the Depósito card: "Devolver depósito" confirms, "Reportar daños" opens the PAGE', async () => {
    setOrder({ data: order({ securityDeposit: { total: 500, held: 500, canSettle: true } }) });
    renderPage();
    expect(screen.getByRole('heading', { name: `${KEY}.deposit.title` })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: `${KEY}.deposit.refundAction` }));
    expect(screen.getByTestId('deposit-refund-modal')).toHaveTextContent('12');
    await userEvent.click(screen.getByRole('button', { name: 'cerrar-devolver-deposito' }));
    expect(screen.queryByTestId('deposit-refund-modal')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: `${KEY}.deposit.report` }));
    expect(navigate).toHaveBeenCalledWith('/panel/pedidos/12/danos');
  });

  it('a pending deposit is surfaced in the state card and takes the admin TO the Depósito card', async () => {
    setOrder({
      data: order({
        depositSettlementPending: true,
        securityDeposit: { total: 500, held: 500, canSettle: true },
      }),
    });
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: `${KEY}.actions.depositPending` }));
    const card = screen.getByRole('region', { name: `${KEY}.deposit.title` });
    expect(bringIntoPanelView).toHaveBeenCalledWith(card, { smooth: true });
    expect(card).toHaveFocus();
  });

  it('a driver never sees the pending-deposit shortcut (recording it is the admin\'s call)', () => {
    useHasRole.mockReturnValue(false);
    setOrder({
      data: order({
        depositSettlementPending: true,
        securityDeposit: { total: 500, held: 500, canSettle: true },
      }),
    });
    renderPage();
    expect(
      screen.queryByRole('button', { name: `${KEY}.actions.depositPending` }),
    ).not.toBeInTheDocument();
  });

  it('weaves the deposit trail into the history, chronologically, each with its own label', () => {
    const at = (iso: string) => new Date(iso).toISOString();
    setOrder({
      data: order({
        statusHistory: [
          {
            id: 1,
            to: { id: 1, name: 'Pendiente' },
            byUserName: 'Romeo Marroquín',
            at: at('2026-07-16T12:00:00'),
          },
          {
            id: 2,
            from: { id: 1, name: 'Pendiente' },
            to: { id: 3, name: 'Entregado' },
            byUserName: 'Ana Díaz',
            at: at('2026-08-01T14:00:00'),
          },
        ],
        depositHistory: [
          // Deliberately out of order — the page sorts by `at`.
          { id: 5, kind: 'UNDONE', byUserName: 'Romeo', at: at('2026-08-05T09:00:00') },
          {
            id: 3,
            kind: 'RECORDED',
            depositTotal: 500,
            claimsTotal: 0,
            refundAmount: 500,
            balanceDue: 0,
            byUserName: 'Romeo',
            at: at('2026-08-03T10:00:00'),
          },
          {
            id: 4,
            kind: 'CORRECTED',
            depositTotal: 500,
            claimsTotal: 600,
            refundAmount: 0,
            balanceDue: 100,
            byUserName: 'Romeo',
            at: at('2026-08-04T10:00:00'),
          },
          {
            id: 6,
            kind: 'RECORDED',
            depositTotal: 500,
            claimsTotal: 120,
            refundAmount: 380,
            balanceDue: 0,
            byUserName: 'Romeo',
            at: at('2026-08-06T10:00:00'),
          },
          // A correction back to nothing claimed, with the money fields absent.
          { id: 7, kind: 'CORRECTED', byUserName: 'Romeo', at: at('2026-08-07T10:00:00') },
          // A first record with nothing HELD then (no figures — the deposit not received) gave
          // nothing back: it reads "Registrado sin daños", never "Depósito devuelto".
          { id: 8, kind: 'RECORDED', byUserName: 'Romeo', at: at('2026-08-08T10:00:00') },
          // Damages against a deposit NOT received (held 0): billed whole, no "se devuelve".
          {
            id: 13,
            kind: 'RECORDED',
            depositTotal: 0,
            claimsTotal: 90,
            refundAmount: 0,
            balanceDue: 90,
            byUserName: 'Romeo',
            at: at('2026-08-09T10:00:00'),
          },
          // A correction with a deposit held but no refund figure reads "se devuelve Q0.00".
          {
            id: 14,
            kind: 'CORRECTED',
            depositTotal: 500,
            claimsTotal: 500,
            byUserName: 'Romeo',
            at: at('2026-08-10T10:00:00'),
          },
        ],
      }),
    });
    renderPage();
    const labels = screen
      .getAllByRole('listitem')
      .map((item) => item.querySelector('p')?.textContent)
      .filter((text) => text?.startsWith(`${KEY}.history.`));
    expect(labels).toEqual([
      `${KEY}.history.created`,
      `${KEY}.history.moved`,
      `${KEY}.history.depositRefunded`,
      `${KEY}.history.depositCorrected`,
      `${KEY}.history.depositUndone`,
      `${KEY}.history.depositDamaged`,
      `${KEY}.history.depositCorrected`,
      `${KEY}.history.depositNoDamage`,
      `${KEY}.history.depositDamaged`,
      `${KEY}.history.depositCorrected`,
    ]);
    // Corrections and damages carry the money as it stood then; the balance only when one is owed.
    // With a deposit held then, "Daños · se devuelve"; with none held, only the damages.
    expect(screen.getAllByText(new RegExp(`${KEY}.history.depositSummary(?!NoDeposit)`))).toHaveLength(3);
    expect(screen.getAllByText(new RegExp(`${KEY}.history.depositSummaryNoDeposit`))).toHaveLength(2);
    expect(
      screen.getAllByText(new RegExp(`${KEY}.history.depositBalance`)),
    ).toHaveLength(2);
  });

  it('the deposit COLLECTION joins the trail: received (with its amount), waived (with its note), cleared', () => {
    const at = (iso: string) => new Date(iso).toISOString();
    setOrder({
      data: order({
        depositHistory: [
          { id: 9, kind: 'RECEIVED', depositTotal: 500, byUserName: 'Ana', at: at('2026-08-01T14:00:00') },
          { id: 10, kind: 'COLLECTION_CLEARED', byUserName: 'Romeo', at: at('2026-08-01T15:00:00') },
          { id: 11, kind: 'WAIVED', note: 'Familiar', byUserName: 'Romeo', at: at('2026-08-01T16:00:00') },
          { id: 12, kind: 'COLLECTION_CLEARED', byUserName: 'Romeo', at: at('2026-08-01T17:00:00') },
          // Older rows may carry neither figure nor note — the label alone still reads.
          { id: 13, kind: 'RECEIVED', byUserName: 'Ana', at: at('2026-08-01T18:00:00') },
          { id: 14, kind: 'WAIVED', byUserName: 'Romeo', at: at('2026-08-01T19:00:00') },
        ],
      }),
    });
    renderPage();
    const labels = screen
      .getAllByRole('listitem')
      .map((item) => item.querySelector('p')?.textContent)
      .filter((text) => text?.startsWith(`${KEY}.history.`));
    expect(labels).toEqual([
      `${KEY}.history.created`,
      `${KEY}.history.depositReceived`,
      `${KEY}.history.collectionCleared`,
      `${KEY}.history.depositWaived`,
      `${KEY}.history.collectionCleared`,
      `${KEY}.history.depositReceived`,
      `${KEY}.history.depositWaived`,
    ]);
    // The amount only where the row carries one; the internal note only where one was written.
    expect(screen.getAllByText(`${KEY}.history.internalNote`)).toHaveLength(1);
  });

  it('the "Cobro del depósito" row opens its dialog in the right mode, and closing it clears it', async () => {
    setOrder({
      data: order({
        securityDeposit: {
          total: 500,
          held: 500,
          canSettle: false,
          collection: { status: 'PENDING', canRecord: true },
        },
      }),
    });
    renderPage();
    await userEvent.click(
      screen.getByRole('button', { name: `${KEY}.deposit.collection.markReceived` }),
    );
    expect(screen.getByTestId('deposit-collection-modal')).toHaveTextContent('12:receive');
    await userEvent.click(screen.getByRole('button', { name: 'cerrar-cobro-deposito' }));
    expect(screen.queryByTestId('deposit-collection-modal')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: `${KEY}.deposit.collection.waive` }));
    expect(screen.getByTestId('deposit-collection-modal')).toHaveTextContent('12:waive');
  });

  it('a recorded damage report: the count on the LINE, and undo through a confirm', async () => {
    setOrder({
      data: order({
        lines: [
          {
            id: 31,
            productId: 3,
            productName: 'Silla plegable',
            isRental: true,
            quantity: 25,
            unitaryPrice: 6,
            parcialPrice: 150,
            securityDeposit: 20,
            replacementPrice: 90,
            damagedQuantity: 2,
          },
        ],
        securityDeposit: {
          total: 500,
          held: 500,
          canSettle: true,
          settlement: {
            settledAt: new Date('2026-08-03T10:00:00').toISOString(),
            retainedAmount: 0,
            damages: [
              { lineId: 31, productName: 'Silla plegable', quantity: 2, unitAmount: 90, amount: 180 },
            ],
            damagesTotal: 180,
            claimsTotal: 180,
            appliedFromDeposit: 180,
            refundAmount: 320,
            balanceDue: 0,
          },
        },
      }),
    });
    renderPage();
    // The lost/broken count is stated on the LINE too, not only in the breakdown.
    expect(screen.getByText(new RegExp(`${KEY}.lines.damaged`))).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: `${KEY}.deposit.undo` }));
    expect(screen.getByTestId('settlement-undo-modal')).toHaveTextContent('12');
    await userEvent.click(screen.getByRole('button', { name: 'cerrar-deshacer-deposito' }));
    expect(screen.queryByTestId('settlement-undo-modal')).not.toBeInTheDocument();
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
            variantId: 5,
            variantLabel: 'Azul',
            isRental: false,
            quantity: 10,
            unitaryPrice: 3.5,
            parcialPrice: 35,
            damagedQuantity: 0,
          },
        ],
      }),
    });
    renderPage();

    expect(screen.getByText('Cumpleaños en el jardín')).toBeInTheDocument();
    expect(screen.getByText('Llamar al llegar')).toBeInTheDocument();
    expect(screen.getByText('Carlos Ruiz')).toBeInTheDocument();
    expect(screen.getByText('Efectivo')).toBeInTheDocument();
    // A variation line is named by product AND variation (`lineDisplayName`).
    expect(screen.getByText('Vasos — Azul')).toBeInTheDocument();
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
