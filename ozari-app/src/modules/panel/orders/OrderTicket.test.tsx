import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import useBreakpoint from '@hooks/useBreakpoint';
import type { OrderAction, OrderListItem } from './order.types';
import OrderTicket from './OrderTicket';

// The quick action's label is INTERPOLATED with the admin-configured status name, so this suite
// overrides the global key-only `t` with one that appends the interpolation values (`key|value`) —
// otherwise "the button renames itself when the admin renames the step" would be unobservable.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key}|${Object.values(options).join(',')}` : key,
    i18n: { changeLanguage: vi.fn(), language: 'es' },
  }),
}));

// The ticket renders ONE of two layouts by width. Default the hook to a portrait phone (the compact
// stack) for most assertions; the rail-layout test flips it to a wider breakpoint.
vi.mock('@hooks/useBreakpoint', () => ({
  default: vi.fn(() => ({ isMobile: true, breakpoint: 'base' })),
}));
const mockBreakpoint = vi.mocked(useBreakpoint);
beforeEach(() => mockBreakpoint.mockReturnValue({ isMobile: true, breakpoint: 'base' }));

const base = (overrides: Partial<OrderListItem> = {}): OrderListItem => ({
  id: 12,
  clientName: 'María López',
  isRegistryClient: false,
  eventType: { id: 1, name: 'Evento familiar' },
  status: { id: 1, name: 'Pendiente', colorKey: 'amber' },
  paymentStatus: { id: 1, name: 'Pendiente' },
  deliveryAt: new Date('2026-08-01T14:00:00').toISOString(),
  pickupAt: new Date('2026-08-01T18:00:00').toISOString(),
  isMine: false,
  actions: [],
  itemCount: 25,
  totalAmount: 450,
  currency: { id: 1, iso4217Code: 'GTQ', name: 'Quetzal', symbol: 'Q' },
  ...overrides,
});

/** The forward move the backend's lifecycle engine offers — the ONLY thing that makes the ticket's
 *  quick action appear (the frontend re-derives no transition rules). */
const forwardTo = (statusName: string): OrderAction => ({
  kind: 'forward',
  statusId: 5,
  statusName,
  requiresEvidence: false,
  minEvidence: 1,
  maxEvidence: 10,
  requiresReason: false,
});

const NEXT_STEP = 'modules.panel.orders.ticket.nextStep';

describe('OrderTicket', () => {
  it('renders the client, event type, item count key, status, and formatted total', () => {
    render(<OrderTicket order={base()} />);
    expect(screen.getByText('María López')).toBeInTheDocument();
    expect(screen.getByText(/Evento familiar/)).toBeInTheDocument();
    expect(screen.getByText(/modules\.panel\.orders\.ticket\.items/)).toBeInTheDocument();
    expect(screen.getByText('Pendiente')).toBeInTheDocument();
    expect(screen.getByText(/Q\s*450\.00/)).toBeInTheDocument();
  });

  it('labels delivery + pickup and shows a same-day pickup with no date marker', () => {
    render(<OrderTicket order={base()} />);
    // Both times are explicitly LABELLED — no guessing which is which.
    expect(screen.getByText('modules.panel.orders.ticket.deliveryLabel')).toBeInTheDocument();
    expect(screen.getByText('modules.panel.orders.ticket.pickupLabel')).toBeInTheDocument();
    expect(screen.getByText(/2:00/)).toBeInTheDocument(); // delivery time
    const pickup = screen.getByText(/6:00/); // pickup time (same day → no date)
    expect(pickup.textContent).not.toContain('·');
  });

  it('adds a compact date marker when the pickup lands on another day', () => {
    render(
      <OrderTicket order={base({ pickupAt: new Date('2026-08-02T10:00:00').toISOString() })} />,
    );
    expect(screen.getByText(/10:00/).textContent).toContain('·');
  });

  it('emphasises the NEXT event: delivery until delivered, then the pickup', () => {
    // Nothing tracked yet → the delivery time is the bold (primary) one, the pickup muted.
    const { rerender } = render(<OrderTicket order={base()} />);
    expect(screen.getByText(/2:00/).className).toContain('font-bold');
    expect(screen.getByText(/6:00/).className).not.toContain('font-bold');
    // Once the delivery ACTUAL is stamped the pickup becomes the emphasised one (the status name
    // is irrelevant — the admin may have renamed or inserted steps).
    rerender(
      <OrderTicket
        order={base({
          status: { id: 3, name: 'Ya en la fiesta', colorKey: 'emerald' },
          deliveredAt: new Date('2026-08-01T14:20:00').toISOString(),
        })}
      />,
    );
    expect(screen.getByText(/6:00/).className).toContain('font-bold');
    expect(screen.getByText(/2:00/).className).not.toContain('font-bold');
  });

  it('a purchase-only order (no pickup) says so instead of a pickup label', () => {
    const withoutPickup = { ...base() };
    delete withoutPickup.pickupAt;
    render(<OrderTicket order={withoutPickup} />);
    expect(screen.getByText('modules.panel.orders.ticket.purchaseOnly')).toBeInTheDocument();
    expect(
      screen.queryByText('modules.panel.orders.ticket.pickupLabel'),
    ).not.toBeInTheDocument();
  });

  it('tones the status chip from the ADMIN-configured colorKey, neutral when absent/unknown', () => {
    const { rerender } = render(
      <OrderTicket order={base({ status: { id: 5, name: 'En ruta', colorKey: 'indigo' } })} />,
    );
    expect(screen.getByText('En ruta').className).toContain('text-indigo-600');

    // A brand-new admin-created status whose token this build doesn't know → neutral, never broken.
    rerender(
      <OrderTicket order={base({ status: { id: 99, name: 'Nuevo estado', colorKey: 'fucsia' } })} />,
    );
    expect(screen.getByText('Nuevo estado').className).toContain('text-charcoal/60');

    rerender(<OrderTicket order={base({ status: { id: 100, name: 'Sin color' } })} />);
    expect(screen.getByText('Sin color').className).toContain('text-charcoal/60');
  });

  it("shows the assignee on another worker's order (or 'Sin asignar' when none)", () => {
    // Not mine, with an assignee → the driver's name is shown.
    const { rerender } = render(
      <OrderTicket order={base({ assignee: { id: 4, name: 'Carlos Ruiz' } })} />,
    );
    expect(screen.getByText(/Carlos Ruiz/)).toBeInTheDocument();
    // Not mine, unassigned → the "Sin asignar" hint.
    rerender(<OrderTicket order={base()} />);
    expect(screen.getByText(/modules\.panel\.orders\.ticket\.unassigned/)).toBeInTheDocument();
  });

  it('hides the assignee on MY order (ownership is conveyed by the section)', () => {
    render(<OrderTicket order={base({ isMine: true, assignee: { id: 1, name: 'Yo' } })} />);
    expect(screen.queryByText(/Yo/)).not.toBeInTheDocument();
    expect(screen.queryByText(/modules\.panel\.orders\.ticket\.unassigned/)).not.toBeInTheDocument();
  });

  it('labels the quick action with the target status the ADMIN configured', () => {
    // The label follows the machine: rename the step and the button renames itself.
    const { rerender } = render(
      <OrderTicket order={base({ isMine: true, actions: [forwardTo('En ruta')] })} />,
    );
    expect(screen.getByRole('button')).toHaveTextContent(NEXT_STEP);
    expect(screen.getByRole('button')).toHaveTextContent('En ruta');

    rerender(
      <OrderTicket order={base({ isMine: true, actions: [forwardTo('Cargando camión')] })} />,
    );
    expect(screen.getByRole('button')).toHaveTextContent('Cargando camión');
  });

  it('shows NO quick action when the backend offered no forward move', () => {
    // Another worker's order, a finished one, or a role without rights — all arrive the same way:
    // an empty `actions` array. The frontend never second-guesses that.
    render(<OrderTicket order={base({ isMine: false })} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();

    render(
      <OrderTicket
        order={base({ isMine: true, readyAt: new Date('2026-08-02T20:00:00').toISOString() })}
      />,
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('offers no forward button when only a cancel is available', () => {
    render(
      <OrderTicket
        order={base({
          isMine: true,
          actions: [
            {
              kind: 'disruptive',
              statusId: 2,
              statusName: 'Cancelado',
              requiresEvidence: false,
              minEvidence: 1,
              maxEvidence: 10,
              requiresReason: true,
            },
          ],
        })}
      />,
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('uses the roomy rail layout on wider screens (same content, different disposition)', () => {
    mockBreakpoint.mockReturnValue({ isMobile: false, breakpoint: 'lg' });
    render(<OrderTicket order={base({ isMine: true, actions: [forwardTo('En ruta')] })} />);
    expect(screen.getByText('María López')).toBeInTheDocument();
    expect(screen.getByText('modules.panel.orders.ticket.deliveryLabel')).toBeInTheDocument();
    expect(screen.getByText('modules.panel.orders.ticket.pickupLabel')).toBeInTheDocument();
    expect(screen.getByText('Pendiente')).toBeInTheDocument();
    expect(screen.getByText(/Q\s*450\.00/)).toBeInTheDocument();
    expect(screen.getByRole('button')).toHaveTextContent('En ruta');
  });
});
