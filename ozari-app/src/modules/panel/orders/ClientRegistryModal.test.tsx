import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { createRegistry } = vi.hoisted(() => ({ createRegistry: vi.fn() }));
const { useCreateClientRegistry } = vi.hoisted(() => ({ useCreateClientRegistry: vi.fn() }));
vi.mock('./useCreateClientRegistry', () => ({ useCreateClientRegistry }));

const { success, error } = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('@components/notifications/notify', () => ({ notify: { success, error } }));

import ClientRegistryModal from './ClientRegistryModal';

const KEY = 'modules.panel.orders.registry';
const contactTypes = [{ id: 1, name: 'WhatsApp' }, { id: 2, name: 'Teléfono' }];
const zones = [{ id: 6, name: 'Zona 10' }];

type Handlers = { onSuccess: (r: unknown) => void; onError: (e: unknown) => void };

const renderModal = (onCreated = vi.fn(), onClose = vi.fn()) => {
  render(
    <ClientRegistryModal
      open
      onClose={onClose}
      onCreated={onCreated}
      contactTypes={contactTypes}
      zones={zones}
    />,
  );
  return { onCreated, onClose };
};

const fillValid = async (): Promise<Handlers> => {
  await userEvent.type(screen.getByPlaceholderText(`${KEY}.fields.namePlaceholder`), 'María López');
  const selects = screen.getAllByRole('combobox');
  await userEvent.selectOptions(selects[0] as HTMLElement, '1'); // contact type
  await userEvent.type(screen.getByPlaceholderText(`${KEY}.fields.contactValuePlaceholder`), '5555-1234');
  await userEvent.type(screen.getByPlaceholderText(`${KEY}.fields.addressPlaceholder`), 'Zona 10, 4a avenida 5-55');
  await userEvent.click(screen.getByRole('button', { name: `${KEY}.submit` }));
  await waitFor(() => expect(createRegistry).toHaveBeenCalled());
  return createRegistry.mock.calls[0][1] as Handlers;
};

const axiosError = (status: number, message?: string) => ({
  isAxiosError: true,
  response: { status, data: message ? { message } : {} },
});

beforeEach(() => {
  vi.clearAllMocks();
  useCreateClientRegistry.mockReturnValue({ createRegistry, isPending: false });
});
afterEach(() => vi.restoreAllMocks());

describe('ClientRegistryModal', () => {
  it('renders nothing when closed', () => {
    render(
      <ClientRegistryModal open={false} onClose={vi.fn()} onCreated={vi.fn()} contactTypes={contactTypes} zones={zones} />,
    );
    expect(screen.queryByText(`${KEY}.title`)).not.toBeInTheDocument();
  });

  it('submits the single contact/address as arrays and, on success, hands back the registry + closes', async () => {
    const { onCreated, onClose } = renderModal();
    const handlers = await fillValid();

    expect(createRegistry).toHaveBeenCalledWith(
      {
        name: 'María López',
        contacts: [{ contactTypeId: 1, value: '5555-1234', isPrincipal: true }],
        addresses: [{ address: 'Zona 10, 4a avenida 5-55', isFavorite: true }],
      },
      expect.any(Object),
    );

    const registry = { id: 3, name: 'María López', contacts: [], addresses: [], createdAt: 'x' };
    act(() => handlers.onSuccess({ data: { data: { registry } } }));
    expect(success).toHaveBeenCalledWith(`${KEY}.successToast`, { title: `${KEY}.successTitle` });
    expect(onCreated).toHaveBeenCalledWith(registry);
    expect(onClose).toHaveBeenCalled();
  });

  it('surfaces a 400 inline and a 500 as a toast', async () => {
    renderModal();
    const handlers = await fillValid();

    act(() => handlers.onError(axiosError(400, 'Datos inválidos')));
    expect(await screen.findByText('Datos inválidos')).toBeInTheDocument();

    act(() => handlers.onError(axiosError(500)));
    expect(error).toHaveBeenCalled();
  });

  it('blocks submit until the required fields are valid', async () => {
    renderModal();
    await userEvent.click(screen.getByRole('button', { name: `${KEY}.submit` }));
    expect(createRegistry).not.toHaveBeenCalled();
    expect(await screen.findByText(`${KEY}.errors.requiredName`)).toBeInTheDocument();
  });

  it('ignores a submit while a request is already in flight', async () => {
    useCreateClientRegistry.mockReturnValue({ createRegistry, isPending: true });
    renderModal();
    await userEvent.type(screen.getByPlaceholderText(`${KEY}.fields.namePlaceholder`), 'María López');
    await userEvent.selectOptions(screen.getAllByRole('combobox')[0] as HTMLElement, '1');
    await userEvent.type(screen.getByPlaceholderText(`${KEY}.fields.contactValuePlaceholder`), '5555-1234');
    await userEvent.type(screen.getByPlaceholderText(`${KEY}.fields.addressPlaceholder`), 'Zona 10, 4a avenida 5-55');

    const form = document.getElementById('create-registry-form') as HTMLFormElement;
    await act(async () => form.requestSubmit());
    expect(createRegistry).not.toHaveBeenCalled();
  });
});
