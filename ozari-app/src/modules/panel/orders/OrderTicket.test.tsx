import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { OrderListItem } from './order.types';
import OrderTicket from './OrderTicket';

const base = (overrides: Partial<OrderListItem> = {}): OrderListItem => ({
  id: 12,
  clientName: 'María López',
  isRegistryClient: false,
  eventType: { id: 1, name: 'Evento familiar' },
  status: { id: 1, name: 'Pendiente' },
  paymentStatus: { id: 1, name: 'Pendiente' },
  deliveryAt: new Date('2026-08-01T14:00:00').toISOString(),
  pickupAt: new Date('2026-08-01T18:00:00').toISOString(),
  itemCount: 25,
  totalAmount: 450,
  currency: { id: 1, iso4217Code: 'GTQ', name: 'Quetzal', symbol: 'Q' },
  ...overrides,
});

describe('OrderTicket', () => {
  it('renders the client, event type, item count key, status, and formatted total', () => {
    render(<OrderTicket order={base()} />);
    expect(screen.getByText('María López')).toBeInTheDocument();
    expect(screen.getByText(/Evento familiar/)).toBeInTheDocument();
    expect(screen.getByText(/modules\.panel\.orders\.ticket\.items/)).toBeInTheDocument();
    expect(screen.getByText('Pendiente')).toBeInTheDocument();
    expect(screen.getByText(/Q\s*450\.00/)).toBeInTheDocument();
  });

  it('shows delivery and pickup times; a same-day pickup carries no date marker', () => {
    render(<OrderTicket order={base()} />);
    expect(screen.getByText(/2:00/)).toBeInTheDocument();
    const pickup = screen.getByText(/→/);
    expect(pickup.textContent).toMatch(/6:00/);
    expect(pickup.textContent).not.toContain('·');
  });

  it('adds a compact date marker when the pickup lands on another day', () => {
    render(
      <OrderTicket
        order={base({ pickupAt: new Date('2026-08-02T10:00:00').toISOString() })}
      />,
    );
    expect(screen.getByText(/→/).textContent).toContain('·');
  });

  it('a purchase-only order (no pickup) says so instead of a pickup time', () => {
    const withoutPickup = { ...base() };
    delete withoutPickup.pickupAt;
    render(<OrderTicket order={withoutPickup} />);
    expect(screen.getByText('modules.panel.orders.ticket.purchaseOnly')).toBeInTheDocument();
    expect(screen.queryByText(/→/)).not.toBeInTheDocument();
  });

  it('tones the status chip by seeded id and falls back to neutral for unknown statuses', () => {
    const { rerender } = render(
      <OrderTicket order={base({ status: { id: 5, name: 'En ruta' } })} />,
    );
    expect(screen.getByText('En ruta').className).toContain('text-indigo-600');

    rerender(<OrderTicket order={base({ status: { id: 99, name: 'Nuevo estado' } })} />);
    expect(screen.getByText('Nuevo estado').className).toContain('text-charcoal/60');
  });
});
