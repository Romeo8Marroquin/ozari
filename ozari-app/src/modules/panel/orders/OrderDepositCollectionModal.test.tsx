import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { recordCollection, clearCollection, pending } = vi.hoisted(() => ({
  recordCollection: vi.fn(),
  clearCollection: vi.fn(),
  pending: { record: false, clear: false },
}));
vi.mock('./useDepositCollection', () => ({
  useRecordDepositCollection: () => ({ recordCollection, isPending: pending.record }),
  useClearDepositCollection: () => ({ clearCollection, isPending: pending.clear }),
}));

const { success, error } = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('@components/notifications/notify', () => ({ notify: { success, error } }));

const { toFormError } = vi.hoisted(() => ({ toFormError: vi.fn(() => ({})) }));
vi.mock('@utils/apiError', () => ({ toFormError }));

import { QueryKeys } from '@constants/QueryKeys';
import { SETTLEMENT_TEXT_MAX_LENGTH } from '@constants/Regex';
import OrderDepositCollectionModal, { type DepositCollectionMode } from './OrderDepositCollectionModal';
import type { OrderDetail } from './order.types';

const KEY = 'modules.panel.orders.depositCollection';

const order = (overrides: Record<string, unknown> = {}): OrderDetail =>
  ({
    id: 12,
    clientName: 'María López',
    currency: { id: 1, iso4217Code: 'GTQ', name: 'Quetzal', symbol: 'Q' },
    securityDeposit: {
      total: 500,
      held: 500,
      canSettle: false,
      collection: { status: 'PENDING', canRecord: true },
    },
    ...overrides,
  }) as OrderDetail;

type Handlers = {
  onSuccess: (response: { data: { data?: { order: OrderDetail } } }) => void;
  onError: (e: unknown) => void;
};

let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);
const renderModal = (subject?: OrderDetail, mode?: DepositCollectionMode, onClose = vi.fn()) =>
  render(<OrderDepositCollectionModal order={subject} mode={mode} onClose={onClose} />, { wrapper });

const reasonField = () => screen.getByLabelText(`${KEY}.reasonLabel`);
const submit = () => fireEvent.submit(document.getElementById('order-deposit-collection-form')!);

beforeEach(() => {
  vi.clearAllMocks();
  pending.record = false;
  pending.clear = false;
  toFormError.mockReturnValue({});
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
});
afterEach(() => vi.restoreAllMocks());

describe('OrderDepositCollectionModal', () => {
  it('renders nothing until it is first opened', () => {
    renderModal(order());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('receive: a quick confirm that records { received: true } and closes once the server agreed', async () => {
    const onClose = vi.fn();
    const setData = vi.spyOn(client, 'setQueryData');
    renderModal(order(), 'receive', onClose);
    expect(screen.getByText(`${KEY}.receive.title`)).toBeInTheDocument();
    expect(screen.getByText(`${KEY}.receive.description`)).toBeInTheDocument();
    expect(screen.getByText(`${KEY}.receive.note`)).toBeInTheDocument();
    expect(screen.queryByLabelText(`${KEY}.reasonLabel`)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: `${KEY}.receive.confirm` }));
    expect(recordCollection).toHaveBeenCalledWith(
      { orderId: 12, body: { received: true } },
      expect.any(Object),
    );
    expect(onClose).not.toHaveBeenCalled();
    const saved = { id: 12 } as OrderDetail;
    const { onSuccess } = recordCollection.mock.calls[0][1] as Handlers;
    act(() => onSuccess({ data: { data: { order: saved } } }));
    expect(setData).toHaveBeenCalledWith([QueryKeys.ORDER, 12], saved);
    expect(success).toHaveBeenCalledWith(`${KEY}.receive.successToast`, {
      title: `${KEY}.receive.successTitle`,
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('waive: the reason is REQUIRED (an internal note) and travels trimmed', async () => {
    renderModal(order(), 'waive');
    expect(screen.getByText(`${KEY}.internalNote`)).toBeInTheDocument();
    const confirm = screen.getByRole('button', { name: `${KEY}.waive.confirm` });
    expect(confirm).toBeDisabled();
    // "Required" is said by the disabled button, not by red text on an untouched field.
    expect(screen.queryByText(`${KEY}.errors.reasonRequired`)).not.toBeInTheDocument();
    submit();
    expect(recordCollection).not.toHaveBeenCalled();

    await userEvent.type(reasonField(), '  Cliente de confianza ');
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);
    expect(recordCollection).toHaveBeenCalledWith(
      { orderId: 12, body: { received: false, reason: 'Cliente de confianza' } },
      expect.any(Object),
    );
  });

  it('waive: a reason over the ceiling speaks under the field and blocks the submit', () => {
    renderModal(order(), 'waive');
    fireEvent.change(reasonField(), { target: { value: 'a'.repeat(SETTLEMENT_TEXT_MAX_LENGTH + 1) } });
    expect(screen.getByText(`${KEY}.errors.reasonTooLong`)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: `${KEY}.waive.confirm` })).toBeDisabled();
    submit();
    expect(recordCollection).not.toHaveBeenCalled();
  });

  it('clear: an alertdialog confirm that DELETEs; a bare 2xx still closes', async () => {
    const onClose = vi.fn();
    const setData = vi.spyOn(client, 'setQueryData');
    renderModal(order(), 'clear', onClose);
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByText(`${KEY}.clear.note`)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: `${KEY}.clear.confirm` }));
    expect(clearCollection).toHaveBeenCalledWith(12, expect.any(Object));
    expect(recordCollection).not.toHaveBeenCalled();
    const { onSuccess } = clearCollection.mock.calls[0][1] as Handlers;
    act(() => onSuccess({ data: {} }));
    expect(setData).not.toHaveBeenCalled();
    expect(success).toHaveBeenCalledWith(`${KEY}.clear.successToast`, {
      title: `${KEY}.clear.successTitle`,
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('an order without a deposit block still words its amount (as zero)', () => {
    renderModal(order({ securityDeposit: undefined }), 'receive');
    expect(screen.getByText(`${KEY}.receive.title`)).toBeInTheDocument();
  });

  it('shows a 409 INLINE (a damage report exists) and an ambient failure as a toast', async () => {
    toFormError.mockReturnValue({ inline: 'ya hay un reporte' });
    renderModal(order(), 'receive');
    await userEvent.click(screen.getByRole('button', { name: `${KEY}.receive.confirm` }));
    const { onError } = recordCollection.mock.calls[0][1] as Handlers;
    act(() => onError({ response: { status: 409 } }));
    expect(screen.getByText('ya hay un reporte')).toBeInTheDocument();
    expect(error).not.toHaveBeenCalled();

    toFormError.mockReturnValue({ toast: 'sin conexión' });
    act(() => onError({}));
    expect(error).toHaveBeenCalledWith('sin conexión');
  });

  it('opens FRESH for another act: no stale reason, no stale failure', async () => {
    toFormError.mockReturnValue({ inline: 'falló' });
    const { rerender } = renderModal(order(), 'waive');
    await userEvent.type(reasonField(), 'Familiar');
    await userEvent.click(screen.getByRole('button', { name: `${KEY}.waive.confirm` }));
    const { onError } = recordCollection.mock.calls[0][1] as Handlers;
    act(() => onError({}));
    expect(screen.getByText('falló')).toBeInTheDocument();

    rerender(<OrderDepositCollectionModal onClose={vi.fn()} />);
    // Closing keeps the last act on screen for the exit — it never re-words itself.
    expect(screen.getByText(`${KEY}.waive.title`)).toBeInTheDocument();
    rerender(<OrderDepositCollectionModal order={order()} mode="waive" onClose={vi.fn()} />);
    // FormError keeps its last text painted while it collapses; collapsed = aria-hidden, no alert.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(reasonField()).toHaveValue('');
  });

  it('cannot be double-tapped while either request is in flight', () => {
    pending.clear = true;
    renderModal(order(), 'receive');
    submit();
    expect(recordCollection).not.toHaveBeenCalled();
  });
});
