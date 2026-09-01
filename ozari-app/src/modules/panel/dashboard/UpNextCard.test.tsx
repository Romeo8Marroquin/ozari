import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import UpNextCard from './UpNextCard';
import type { OrderAction } from '../orders/order.types';
import type { UpNextItem } from './dashboard.types';

const KEY = 'modules.panel.dashboard.upNext';

const item = (overrides: Record<string, unknown> = {}): UpNextItem =>
  ({
    id: 12,
    clientName: 'María López',
    isRegistryClient: true,
    eventType: { id: 1, name: 'Evento familiar' },
    status: { id: 1, name: 'Pendiente', colorKey: 'amber' },
    actions: [
      {
        kind: 'forward',
        statusId: 5,
        statusName: 'En ruta',
        requiresEvidence: false,
        minEvidence: 1,
        maxEvidence: 10,
        requiresReason: false,
        inventoryEffect: 'none',
        purgesEvidence: false,
      },
    ],
    holdsInventory: true,
    paymentStatus: { id: 1, name: 'Pendiente' },
    isPaid: false,
    deliveryAt: '2026-08-01T14:00:00.000Z',
    pickupAt: '2026-08-02T10:00:00.000Z',
    isMine: true,
    itemCount: 25,
    totalAmount: 450,
    currency: { id: 1, iso4217Code: 'GTQ', name: 'Quetzal', symbol: 'Q' },
    event: {
      kind: 'DELIVERY',
      at: '2026-08-01T14:00:00.000Z',
      isOverdue: false,
      minutesUntil: 45,
    },
    deliveryAddress: 'Zona 10, 4a avenida 5-55',
    deliveryContact: '5555-1234',
    ...overrides,
  }) as UpNextItem;

/** A forward move somebody DRIVES to perform — `tracksEvent` is what the navigation button hangs
 *  off, exactly as the machine declares it (Entregado stamps DELIVERY, Recolectado COLLECTION;
 *  En ruta and Listo stamp nothing). */
const travellingTo = (statusName: string): OrderAction => ({
  kind: 'forward',
  statusId: 3,
  statusName,
  requiresEvidence: false,
  minEvidence: 1,
  maxEvidence: 10,
  requiresReason: false,
  inventoryEffect: 'none',
  purgesEvidence: false,
  tracksEvent: 'DELIVERY',
});

const renderCard = (overrides: Record<string, unknown> = {}, rank = 0) => {
  const onOpen = vi.fn();
  const onAdvance = vi.fn();
  const onPay = vi.fn();
  const view = render(
    <UpNextCard
      item={item(overrides)}
      rank={rank}
      onOpen={onOpen}
      onAdvance={onAdvance}
      onPay={onPay}
    />,
  );
  return { ...view, onOpen, onAdvance, onPay };
};

beforeEach(() => vi.clearAllMocks());

describe('UpNextCard', () => {
  it('leads with the EVENT this slot is about, not the order’s whole schedule', () => {
    renderCard();
    expect(screen.getByText(`${KEY}.kind.DELIVERY`)).toBeInTheDocument();
    expect(screen.getByText('María López')).toBeInTheDocument();
    expect(screen.getByText('Zona 10, 4a avenida 5-55')).toBeInTheDocument();
  });

  it('renders the collection when that is what the order still owes', () => {
    renderCard({
      event: {
        kind: 'COLLECTION',
        at: '2026-08-02T10:00:00.000Z',
        isOverdue: false,
        minutesUntil: 600,
      },
    });
    expect(screen.getByText(`${KEY}.kind.COLLECTION`)).toBeInTheDocument();
  });

  it.each([
    ['imminent', 5, `${KEY}.countdown.now`],
    ['minutes away', 45, `${KEY}.countdown.minutes`],
    ['hours away', 180, `${KEY}.countdown.hours`],
    ['days away', 2880, `${KEY}.countdown.days`],
    ['months away', 60 * 24 * 45, `${KEY}.countdown.months`],
    ['years away', 60 * 24 * 400, `${KEY}.countdown.years`],
    // The overdue side climbs the SAME ladder — never "Atrasado 16047 minutos".
    ['minutes late', -30, `${KEY}.overdue.minutes`],
    ['hours late', -180, `${KEY}.overdue.hours`],
    ['days late', -16_047, `${KEY}.overdue.days`],
    ['months late', -60 * 24 * 200, `${KEY}.overdue.months`],
    ['years late', -60 * 24 * 800, `${KEY}.overdue.years`],
  ])('words the countdown for a %s event from ONE key', (_name, minutesUntil, key) => {
    renderCard({
      event: {
        kind: 'DELIVERY',
        at: '2026-08-01T14:00:00.000Z',
        isOverdue: minutesUntil < 0,
        minutesUntil,
      },
    });
    expect(screen.getByText(key)).toBeInTheDocument();
  });

  it('opens the order by click and by keyboard, since the card is a link', async () => {
    const { onOpen } = renderCard();
    const card = screen.getByRole('link', { name: `${KEY}.openAria` });
    await userEvent.click(card);
    expect(onOpen).toHaveBeenCalledTimes(1);

    card.focus();
    await userEvent.keyboard('{Enter}');
    await userEvent.keyboard(' ');
    expect(onOpen).toHaveBeenCalledTimes(3);
    // An unrelated key must not navigate.
    await userEvent.keyboard('{Escape}');
    expect(onOpen).toHaveBeenCalledTimes(3);
  });

  it('hands the ENGINE’s forward move to the caller without opening the order behind it', async () => {
    const { onAdvance, onOpen } = renderCard();
    await userEvent.click(screen.getByRole('button', { name: `${KEY}.nextStepAria` }));
    expect(onAdvance).toHaveBeenCalledWith(
      expect.objectContaining({ id: 12 }),
      expect.objectContaining({ statusId: 5 }),
    );
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('offers no quick action when the engine offered none', () => {
    renderCard({ actions: [] });
    expect(screen.queryByRole('button', { name: `${KEY}.nextStepAria` })).not.toBeInTheDocument();
  });

  it('offers navigation ONLY when the order has a real pin', () => {
    // An address TEXT is not a destination: "Test dirección" is not geocodable, so a button built
    // on it opens a maps app somewhere unrelated while looking exactly as trustworthy as a pin.
    renderCard();
    expect(screen.queryByTestId('open-in-maps')).not.toBeInTheDocument();
  });

  it('shows it once the ORDER carries coordinates AND the next move is a trip', () => {
    const PIN = { lat: 14.634915, lng: -90.506883 };
    // The fixture's next move is "En ruta" — the loading, which nobody drives to. A pin alone is
    // not a reason to offer directions: this card would otherwise put a Waze button on every
    // pending order, including ones whose van has not been packed yet.
    const { unmount } = renderCard({ deliveryCoords: PIN });
    expect(screen.queryByTestId('open-in-maps')).not.toBeInTheDocument();
    unmount();

    // The order is now out for delivery: its next move CONFIRMS an arrival, so it is a trip.
    renderCard({ deliveryCoords: PIN, actions: [travellingTo('Entregado')] });
    expect(screen.getByTestId('open-in-maps')).toBeInTheDocument();
  });

  it('offers "registrar pago" while unpaid, and hands the order over', async () => {
    const { onPay, onOpen } = renderCard({ isPaid: false });
    await userEvent.click(screen.getByRole('button', { name: `${KEY}.payAria` }));
    expect(onPay).toHaveBeenCalledWith(expect.objectContaining({ id: 12 }));
    // It lives in the action row, so it must not also open the order behind it.
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('drops the payment action once the money is in', () => {
    renderCard({ isPaid: true });
    expect(screen.queryByRole('button', { name: `${KEY}.payAria` })).not.toBeInTheDocument();
  });

  it('keyboard events inside the action row never bubble up and open the order', async () => {
    const { onOpen } = renderCard();
    const action = screen.getByRole('button', { name: `${KEY}.nextStepAria` });
    action.focus();
    // Space/Enter on the action row must be the BUTTON's business, never the card-link's.
    await userEvent.keyboard('{Escape}');
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('renders a non-lead card (the ranking is visual, not just ordering)', () => {
    renderCard({}, 2);
    expect(screen.getByText('María López')).toBeInTheDocument();
  });

  it('shows the event’s DATE too when it falls on another day than the delivery', () => {
    renderCard({
      event: {
        kind: 'COLLECTION',
        at: '2026-08-05T10:00:00.000Z',
        isOverdue: false,
        minutesUntil: 6000,
      },
    });
    expect(screen.getByText(`${KEY}.kind.COLLECTION`)).toBeInTheDocument();
  });
});

