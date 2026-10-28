import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { settleOrder, pending } = vi.hoisted(() => ({
  settleOrder: vi.fn(),
  pending: { value: false },
}));
vi.mock('./useSettleOrder', () => ({
  useSettleOrder: () => ({ settleOrder, isPending: pending.value }),
}));

const { success, error } = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('@components/notifications/notify', () => ({ notify: { success, error } }));

// The damage report download is the documents' component (and suite); a marker records the UNSAVED
// settlement the form built from its current values.
const { reportProps } = vi.hoisted(() => ({ reportProps: vi.fn() }));
vi.mock('../documents/DamageReportButton', () => ({
  default: (props: { settlement: { claimsTotal: number } }) => {
    reportProps(props);
    return <span data-testid="damage-report">{props.settlement.claimsTotal}</span>;
  },
}));

// The collection dialog is its own component (and suite); a marker records what it was opened with
// and hands back its `onClose`.
const { collectionProps } = vi.hoisted(() => ({ collectionProps: vi.fn() }));
vi.mock('./OrderDepositCollectionModal', () => ({
  default: (props: { order?: { id: number }; mode?: string; onClose: () => void }) => {
    collectionProps(props);
    return props.mode ? (
      <button type="button" data-testid="collection-modal" onClick={props.onClose}>
        {props.mode}
      </button>
    ) : null;
  },
}));

import { QueryKeys } from '@constants/QueryKeys';
import { PanelNavContext, type PanelNav } from '../PanelNavContext';
import type { OrderDetail, OrderLine, OrderSecurityDeposit } from './order.types';
import OrderSettlementForm from './OrderSettlementForm';

const K = 'modules.panel.orders.settlement';

const line = (over: Partial<OrderLine> = {}): OrderLine => ({
  id: 31,
  productId: 3,
  productName: 'Mantel blanco',
  isRental: true,
  quantity: 10,
  unitaryPrice: 15,
  parcialPrice: 150,
  securityDeposit: 20,
  replacementPrice: 120,
  damagedQuantity: 0,
  ...over,
});

const deposit = (over: Partial<OrderSecurityDeposit> = {}): OrderSecurityDeposit => ({
  total: 200,
  held: 200,
  collection: { status: 'RECEIVED', canRecord: true },
  canSettle: true,
  ...over,
});

const order = (over: Partial<OrderDetail> = {}): OrderDetail =>
  ({
    id: 12,
    clientName: 'María López',
    currency: { id: 1, iso4217Code: 'GTQ', name: 'Quetzal', symbol: 'Q' },
    lines: [line(), line({ id: 32, productName: 'Vasos', isRental: false, replacementPrice: undefined })],
    securityDeposit: deposit(),
    ...over,
  }) as OrderDetail;

type Handlers = {
  onSuccess: (response: { data: { data?: { order: OrderDetail } } }) => void;
  onError: (e: unknown) => void;
};
const lastHandlers = (): Handlers =>
  settleOrder.mock.calls[settleOrder.mock.calls.length - 1]?.[1] as Handlers;

const renderForm = (subject: OrderDetail = order(), dep: OrderSecurityDeposit = deposit()) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const setData = vi.spyOn(client, 'setQueryData');
  const navigate = vi.fn();
  const nav: PanelNav = { navigateTo: navigate, pending: null };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <PanelNavContext.Provider value={nav}>{children}</PanelNavContext.Provider>
    </QueryClientProvider>
  );
  const utils = render(<OrderSettlementForm order={subject} deposit={dep} />, { wrapper });
  return { ...utils, navigate, setData };
};

const retained = () => screen.getByLabelText(new RegExp(`${K}.fields.retainedLabel`));
const reason = () => screen.getByLabelText(new RegExp(`${K}.fields.reasonLabel`));
const damaged = () => screen.getByLabelText(new RegExp(`${K}.fields.damagedAria`));
const submit = () => screen.getByRole('button', { name: `${K}.actions.submit` });

beforeEach(() => {
  vi.clearAllMocks();
  pending.value = false;
});

describe('OrderSettlementForm', () => {
  it('offers a retention and a lost/broken count for each RENTAL line with a replacement value', () => {
    renderForm();
    expect(retained()).toHaveAttribute('inputmode', 'decimal');
    expect(reason()).toBeInTheDocument();
    // Only the rental line can carry a damage; the sale line has nothing to bill a loss at.
    expect(screen.getAllByLabelText(new RegExp(`${K}.fields.damagedAria`))).toHaveLength(1);
    expect(damaged()).toHaveAttribute('inputmode', 'numeric');
    expect(screen.getByText('Mantel blanco')).toBeInTheDocument();
    expect(screen.queryByText('Vasos')).not.toBeInTheDocument();
    expect(screen.getByText(`${K}.inventoryNote`)).toBeInTheDocument();
    // The outcome is labelled as an estimate.
    expect(screen.getByText(`${K}.preview.note`)).toBeInTheDocument();
  });

  it('a whole refund is one tap: everything blank sends retainedAmount 0 and no damages', async () => {
    const { navigate, setData } = renderForm();
    await userEvent.click(submit());
    await waitFor(() => expect(settleOrder).toHaveBeenCalled());
    expect(settleOrder.mock.calls[0]?.[0]).toEqual({
      orderId: 12,
      body: { retainedAmount: 0, damages: [] },
    });

    const saved = { id: 12 } as OrderDetail;
    act(() => lastHandlers().onSuccess({ data: { data: { order: saved } } }));
    // The API's re-projected order seeds the detail, then the page returns to it.
    expect(setData).toHaveBeenCalledWith([QueryKeys.ORDER, 12], saved);
    expect(success).toHaveBeenCalledWith(`${K}.successToast`, { title: `${K}.successTitle` });
    expect(navigate).toHaveBeenCalledWith('/panel/pedidos/12');
  });

  it('a 2xx without a payload still returns (the hook\'s invalidation re-reads the order)', async () => {
    const { navigate, setData } = renderForm();
    await userEvent.click(submit());
    await waitFor(() => expect(settleOrder).toHaveBeenCalled());
    act(() => lastHandlers().onSuccess({ data: {} }));
    expect(setData).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith('/panel/pedidos/12');
  });

  it('requires the reason once something is retained, and previews the outcome live', async () => {
    renderForm();
    await userEvent.type(retained(), '50');
    await userEvent.click(submit());

    expect(await screen.findByText(`${K}.errors.reasonRequired`)).toBeInTheDocument();
    expect(settleOrder).not.toHaveBeenCalled();
    // Q200 deposit − Q50 retained ⇒ Q150 back (an estimate of the API's formula).
    expect(screen.getByText(/Q\s*150\.00/)).toBeInTheDocument();

    await userEvent.type(reason(), 'Mantel con mancha');
    await userEvent.click(submit());
    await waitFor(() => expect(settleOrder).toHaveBeenCalled());
    expect(settleOrder.mock.calls[0]?.[0]).toMatchObject({
      body: { retainedAmount: 50, retainedReason: 'Mantel con mancha', damages: [] },
    });
  });

  it('caps the retention at the deposit and the lost units at the line quantity', async () => {
    renderForm();
    await userEvent.type(retained(), '250');
    await userEvent.type(damaged(), '11');
    await userEvent.click(submit());

    expect(await screen.findByText(`${K}.errors.retainedAboveDeposit`)).toBeInTheDocument();
    expect(await screen.findByText(`${K}.errors.invalidDamaged`)).toBeInTheDocument();
    expect(settleOrder).not.toHaveBeenCalled();
  });

  it('reveals the balance owed when the losses exceed the deposit, and sends the damages', async () => {
    renderForm();
    const balance = screen.getByText(`${K}.preview.balanceDue`).closest('[aria-hidden]');
    expect(balance).toHaveAttribute('aria-hidden', 'true');

    // 2 × Q120 = Q240 of losses against a Q200 deposit ⇒ Q40 owed.
    await userEvent.type(damaged(), '2');
    await userEvent.type(screen.getByLabelText(new RegExp(`${K}.fields.noteAria`)), 'Se quemaron');
    expect(balance).toHaveAttribute('aria-hidden', 'false');
    expect(screen.getByText(/Q\s*40\.00/)).toBeInTheDocument();

    await userEvent.click(submit());
    await waitFor(() => expect(settleOrder).toHaveBeenCalled());
    expect(settleOrder.mock.calls[0]?.[0]).toMatchObject({
      body: { retainedAmount: 0, damages: [{ lineId: 31, quantity: 2, note: 'Se quemaron' }] },
    });
  });

  it('offers the damage report before saving only while something is claimed AND the form is valid', async () => {
    renderForm();
    const slot = screen.getByTestId('settlement-damage-report');
    // Nothing claimed yet — collapsed and inert, so a blank report can never be printed.
    expect(slot).toHaveAttribute('aria-hidden', 'true');
    expect(slot).toHaveAttribute('inert');

    // 2 × Q120 lost: a valid claim ⇒ the report opens, built from the CURRENT values.
    await userEvent.type(damaged(), '2');
    expect(slot).toHaveAttribute('aria-hidden', 'false');
    expect(slot).not.toHaveAttribute('inert');
    expect(reportProps).toHaveBeenLastCalledWith(
      expect.objectContaining({
        settlement: expect.objectContaining({ claimsTotal: 240, refundAmount: 0, balanceDue: 40 }),
      }),
    );
    // A REPORT, not a sketch: the documents' component is never told it is a draft.
    expect(reportProps.mock.lastCall?.[0]).not.toHaveProperty('draft');
    expect(screen.getByText(`${K}.reportNote`)).toBeInTheDocument();

    // A retention without its description makes the form invalid ⇒ the report closes again…
    await userEvent.type(retained(), '50');
    expect(slot).toHaveAttribute('aria-hidden', 'true');
    // …and comes back once the form is whole.
    await userEvent.type(reason(), 'Golpe en la esquina');
    expect(slot).toHaveAttribute('aria-hidden', 'false');
    expect(reportProps).toHaveBeenLastCalledWith(
      expect.objectContaining({
        settlement: expect.objectContaining({
          claimsTotal: 290,
          retainedReason: 'Golpe en la esquina',
        }),
      }),
    );
  });

  it('prefills the recorded settlement (editing corrects it)', () => {
    const recorded = deposit({
      settlement: {
        settledAt: '2026-08-03T10:00:00.000Z',
        retainedAmount: 30,
        retainedReason: 'Manchas',
        damages: [],
        damagesTotal: 120,
        claimsTotal: 150,
        appliedFromDeposit: 150,
        refundAmount: 50,
        balanceDue: 0,
      },
    });
    renderForm(order({ lines: [line({ damagedQuantity: 1, damageNote: 'Roto' })], securityDeposit: recorded }), recorded);
    expect(retained()).toHaveValue('30');
    expect(reason()).toHaveValue('Manchas');
    expect(damaged()).toHaveValue('1');
  });

  it('hides the retention when there is no deposit to retain from (replacement value only)', () => {
    const none = deposit({ total: 0, held: 0 });
    renderForm(order({ lines: [line({ securityDeposit: undefined })], securityDeposit: none }), none);
    expect(screen.queryByLabelText(new RegExp(`${K}.fields.retainedLabel`))).not.toBeInTheDocument();
    expect(screen.queryByText(`${K}.preview.retained`)).not.toBeInTheDocument();
    expect(damaged()).toBeInTheDocument();
  });

  it('says so when the order carries no deposit at all', () => {
    const none = deposit({ total: 0, held: 0 });
    renderForm(order({ securityDeposit: none }), none);
    expect(screen.getByText(`${K}.noDeposit`)).toBeInTheDocument();
    expect(screen.queryByText(`${K}.notReceived.text`)).not.toBeInTheDocument();
  });

  it.each([
    ['PENDING', { status: 'PENDING' as const, canRecord: true }],
    ['WAIVED', { status: 'WAIVED' as const, reason: 'Familiar', canRecord: true }],
  ])(
    'a deposit NOT received (%s): the retention up to the NOMINAL deposit, every claim billed whole',
    async (_label, collection) => {
      const notReceived = deposit({ held: 0, collection });
      renderForm(order({ securityDeposit: notReceived }), notReceived);
      expect(screen.getByRole('note')).toHaveTextContent(`${K}.notReceived.text`);
      expect(screen.queryByText(`${K}.noDeposit`)).not.toBeInTheDocument();
      // The retention is still offered — "that part of the deposit" — capped at the agreed Q200.
      expect(retained()).toBeInTheDocument();
      // Nothing in hand: no "se devuelve" row; the one result is what is owed.
      expect(screen.queryByText(`${K}.preview.refund`)).not.toBeInTheDocument();
      expect(screen.getByText(`${K}.preview.balanceDue`)).toBeInTheDocument();

      await userEvent.type(retained(), '150');
      await userEvent.type(reason(), 'Mantel manchado');
      await userEvent.type(damaged(), '1');
      // Q150 retained + 1 × Q120 lost = Q270, all of it owed (held 0 ⇒ nothing applied or back).
      expect(screen.getByText(/^Q\s*270\.00$/)).toBeInTheDocument();
      expect(reportProps).toHaveBeenLastCalledWith(
        expect.objectContaining({
          settlement: expect.objectContaining({
            claimsTotal: 270,
            appliedFromDeposit: 0,
            refundAmount: 0,
            balanceDue: 270,
          }),
        }),
      );
      await userEvent.click(submit());
      await waitFor(() => expect(settleOrder).toHaveBeenCalled());
      expect(settleOrder.mock.calls[0]?.[0]).toMatchObject({ body: { retainedAmount: 150 } });
    },
  );

  it('still refuses a retention above the NOMINAL deposit when it was not received', async () => {
    const notReceived = deposit({ held: 0, collection: { status: 'PENDING', canRecord: true } });
    renderForm(order({ securityDeposit: notReceived }), notReceived);
    await userEvent.type(retained(), '250');
    await userEvent.click(submit());
    expect(await screen.findByText(`${K}.errors.retainedAboveDeposit`)).toBeInTheDocument();
    expect(settleOrder).not.toHaveBeenCalled();
  });

  it('records the deposit as received IN PLACE: the collection dialog, outside the form', async () => {
    const notReceived = deposit({ held: 0, collection: { status: 'PENDING', canRecord: true } });
    const subject = order({ securityDeposit: notReceived });
    renderForm(subject, notReceived);
    expect(screen.queryByTestId('collection-modal')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: `${K}.notReceived.action` }));
    expect(collectionProps).toHaveBeenLastCalledWith(
      expect.objectContaining({ order: subject, mode: 'receive' }),
    );
    // Its confirm must never submit the report (the dialog is not nested in the form).
    await userEvent.click(screen.getByTestId('collection-modal'));
    expect(settleOrder).not.toHaveBeenCalled();
    expect(screen.queryByTestId('collection-modal')).not.toBeInTheDocument();
  });

  it('offers no in-place action when the collection cannot be recorded', () => {
    const locked = deposit({ held: 0, collection: { status: 'PENDING', canRecord: false } });
    renderForm(order({ securityDeposit: locked }), locked);
    expect(screen.getByRole('note')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: `${K}.notReceived.action` }),
    ).not.toBeInTheDocument();
  });

  it('a RECEIVED deposit shows no notice and is applied before anything is owed', () => {
    const received = deposit({ collection: { status: 'RECEIVED', canRecord: true } });
    renderForm(order({ securityDeposit: received }), received);
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
    expect(screen.getByText(`${K}.preview.refund`)).toBeInTheDocument();
  });

  it('hides the damages when no line has a replacement value (deposit only)', () => {
    renderForm(order({ lines: [line({ replacementPrice: undefined })] }));
    expect(screen.queryByLabelText(new RegExp(`${K}.fields.damagedAria`))).not.toBeInTheDocument();
    expect(screen.queryByText(`${K}.preview.damages`)).not.toBeInTheDocument();
    expect(screen.queryByText(`${K}.inventoryNote`)).not.toBeInTheDocument();
  });

  it('lands a 400/409 INLINE (the server\'s message), and an ambient failure in a toast', async () => {
    renderForm();
    await userEvent.click(submit());
    await waitFor(() => expect(settleOrder).toHaveBeenCalled());

    act(() =>
      lastHandlers().onError({
        isAxiosError: true,
        response: { status: 409, data: { message: 'El pedido aún no se entrega.' } },
      }),
    );
    expect(screen.getByText('El pedido aún no se entrega.')).toBeInTheDocument();
    expect(error).not.toHaveBeenCalled();

    act(() => lastHandlers().onError(new Error('boom')));
    expect(error).toHaveBeenCalledWith('errors.generic');
  });

  it('ignores a submit while the save is in flight', async () => {
    pending.value = true;
    renderForm();
    fireEvent.submit(document.getElementById('order-settlement-form') as HTMLFormElement);
    await act(async () => {});
    expect(settleOrder).not.toHaveBeenCalled();
  });

  it('cancel returns to the order', async () => {
    const { navigate } = renderForm();
    await userEvent.click(screen.getByRole('button', { name: `${K}.actions.cancel` }));
    expect(navigate).toHaveBeenCalledWith('/panel/pedidos/12');
  });
});
