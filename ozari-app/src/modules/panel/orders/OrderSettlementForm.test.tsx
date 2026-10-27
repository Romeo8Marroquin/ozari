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
    const none = deposit({ total: 0 });
    renderForm(order({ lines: [line({ securityDeposit: undefined })], securityDeposit: none }), none);
    expect(screen.queryByLabelText(new RegExp(`${K}.fields.retainedLabel`))).not.toBeInTheDocument();
    expect(screen.queryByText(`${K}.preview.retained`)).not.toBeInTheDocument();
    expect(damaged()).toBeInTheDocument();
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
