import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import useBreakpoint from '@hooks/useBreakpoint';
import type { OrderAction, OrderListItem } from './order.types';
import OrderTicket from './OrderTicket';

// The quick action's label is INTERPOLATED with the admin-configured status name, so this suite
// appends the interpolation values to the key (`key|value`) — otherwise "the button renames itself
// when the admin renames the step" would be unobservable.
//
// It COMPOSES the global contract rather than replacing it: a local `t` that just returns something
// would silently opt this file out of the missing-key / missing-value checks, and this is exactly
// the kind of file where those bugs live.
vi.mock('react-i18next', async () => {
  const { assertTranslationContract } = await import('../../../test/i18nContract');
  return {
    useTranslation: () => ({
      t: (key: string, options?: Record<string, unknown>) => {
        const checked = assertTranslationContract(key, options);
        return options ? `${checked}|${Object.values(options).join(',')}` : checked;
      },
      i18n: { changeLanguage: vi.fn(), language: 'es' },
    }),
  };
});

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
  holdsInventory: true,
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
  inventoryEffect: 'none',
  purgesEvidence: false,
});

const NEXT_STEP = 'modules.panel.orders.ticket.nextStep';

/** The status PILL — the label morphs inside it, so the tone classes live on its wrapper. */
const chipOf = (label: string): HTMLElement => {
  const pill = screen.getByText(label).closest('.rounded-full');
  if (!pill) throw new Error(`no status chip around "${label}"`);
  return pill as HTMLElement;
};

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

  it('emphasises NOTHING once every event is done (a finished or cancelled order)', () => {
    // Emphasis means "you still have to do this", not "this is a date": on a collected, finished or
    // cancelled order both events are in the past, so neither is bold.
    const done = {
      deliveredAt: new Date('2026-08-01T14:20:00').toISOString(),
      collectedAt: new Date('2026-08-01T18:10:00').toISOString(),
    };
    const { rerender } = render(<OrderTicket order={base(done)} />);
    expect(screen.getByText(/2:00/).className).not.toContain('font-bold');
    expect(screen.getByText(/6:00/).className).not.toContain('font-bold');

    // Finished (the "listo" press) and cancelled behave the same, even mid-flow.
    rerender(
      <OrderTicket order={base({ readyAt: new Date('2026-08-02T09:00:00').toISOString() })} />,
    );
    expect(screen.getByText(/2:00/).className).not.toContain('font-bold');

    rerender(
      <OrderTicket order={base({ cancelledAt: new Date('2026-07-31T09:00:00').toISOString() })} />,
    );
    expect(screen.getByText(/2:00/).className).not.toContain('font-bold');
    expect(screen.getByText(/6:00/).className).not.toContain('font-bold');
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

  it('tones the status chip from the ADMIN-configured colorKey, neutral when absent/unknown', async () => {
    const { rerender } = render(
      <OrderTicket order={base({ status: { id: 5, name: 'En ruta', colorKey: 'indigo' } })} />,
    );
    expect(chipOf('En ruta').className).toContain('text-indigo-600');

    // A brand-new admin-created status whose token this build doesn't know → neutral, never broken.
    rerender(
      <OrderTicket order={base({ status: { id: 99, name: 'Nuevo estado', colorKey: 'fucsia' } })} />,
    );
    await screen.findByText('Nuevo estado');
    expect(chipOf('Nuevo estado').className).toContain('text-charcoal/60');

    rerender(<OrderTicket order={base({ status: { id: 100, name: 'Sin color' } })} />);
    await screen.findByText('Sin color');
    expect(chipOf('Sin color').className).toContain('text-charcoal/60');
  });

  it('CROSS-FADES the status + action labels: old and new are painted together', async () => {
    // Advancing rewrites the chip AND the button, both changing word and width at once. They morph
    // (the box adapts while the labels cross through each other) — so for a moment BOTH are in the
    // DOM, the outgoing one hidden from assistive tech.
    const { rerender } = render(
      <OrderTicket
        order={base({
          isMine: true,
          status: { id: 1, name: 'Pendiente', colorKey: 'amber' },
          actions: [forwardTo('En ruta')],
        })}
      />,
    );
    expect(screen.getByText('Pendiente')).toBeInTheDocument();

    rerender(
      <OrderTicket
        order={base({
          isMine: true,
          status: { id: 5, name: 'En ruta', colorKey: 'indigo' },
          actions: [{ ...forwardTo('Entregado'), statusId: 3 }],
        })}
      />,
    );
    // The new label is live immediately; the old one lingers as the outgoing (aria-hidden) layer.
    expect(chipOf('En ruta')).toBeInTheDocument();
    const outgoing = screen.getByText('Pendiente');
    expect(outgoing.closest('[aria-hidden]')).not.toBeNull();

    // …and it is dropped once the morph completes, leaving exactly one label.
    await waitFor(() => expect(screen.queryByText('Pendiente')).not.toBeInTheDocument());
    expect(screen.getByRole('button')).toHaveTextContent('Entregado');
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

  it('lands on the FINAL step when several advances land back to back', async () => {
    // Advancing twice before the first swap finishes must resolve to the latest state — the earlier
    // swap is abandoned, never replayed on top (the panel's "latest intent wins" doctrine).
    const at = (name: string, id: number) => ({
      isMine: true,
      status: { id, name, colorKey: 'sky' },
      actions: [{ ...forwardTo(`${name}+1`), statusId: id + 1 }],
    });
    const { rerender } = render(<OrderTicket order={base(at('Pendiente', 1))} />);
    rerender(<OrderTicket order={base(at('En ruta', 5))} />);
    rerender(<OrderTicket order={base(at('Entregado', 3))} />);

    await waitFor(() => expect(screen.getByText('Entregado')).toBeInTheDocument());
    expect(screen.getByRole('button')).toHaveTextContent('Entregado+1');
    expect(screen.queryByText('En ruta')).not.toBeInTheDocument();
  });

  it('labels the quick action with the target status the ADMIN configured', async () => {
    // The label follows the machine: rename the step and the button renames itself.
    const { rerender } = render(
      <OrderTicket order={base({ isMine: true, actions: [forwardTo('En ruta')] })} />,
    );
    expect(screen.getByRole('button')).toHaveTextContent(NEXT_STEP);
    expect(screen.getByRole('button')).toHaveTextContent('En ruta');

    rerender(
      <OrderTicket
        order={base({
          isMine: true,
          actions: [{ ...forwardTo('Cargando camión'), statusId: 8 }],
        })}
      />,
    );
    await waitFor(() =>
      expect(screen.getByRole('button')).toHaveTextContent('Cargando camión'),
    );
  });

  it('opens the order — by click, and by keyboard (it behaves as a link)', async () => {
    const onOpen = vi.fn();
    const onAdvance = vi.fn();
    const item = base({ isMine: true, actions: [forwardTo('En ruta')] });
    render(<OrderTicket order={item} onOpen={onOpen} onAdvance={onAdvance} />);

    const card = screen.getByRole('link');
    await userEvent.click(card);
    expect(onOpen).toHaveBeenCalledWith(item);

    card.focus();
    await userEvent.keyboard('{Enter}');
    await userEvent.keyboard(' ');
    expect(onOpen).toHaveBeenCalledTimes(3);
    // A key that means nothing here does nothing.
    await userEvent.keyboard('{Escape}');
    expect(onOpen).toHaveBeenCalledTimes(3);

    // The quick action must NOT also open the detail — it stops the card's click.
    onOpen.mockClear();
    await userEvent.click(screen.getByRole('button'));
    expect(onAdvance).toHaveBeenCalled();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('is inert without handlers (a card rendered outside the page)', async () => {
    render(<OrderTicket order={base({ isMine: true, actions: [forwardTo('En ruta')] })} />);
    await userEvent.click(screen.getByRole('link'));
    await userEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('link')).toBeInTheDocument();
  });

  it("keeps the list clean: no quick action on another worker's order, even though the admin MAY act", () => {
    // An Admin is offered advance + rewind + cancel on EVERY order; the agenda still shows nothing
    // on rows that aren't theirs — those moves belong to the order detail.
    render(
      <OrderTicket
        order={base({
          isMine: false,
          assignee: { id: 4, name: 'Carlos Ruiz' },
          actions: [forwardTo('En ruta')],
        })}
      />,
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
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
              inventoryEffect: 'release',
              purgesEvidence: false,
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
