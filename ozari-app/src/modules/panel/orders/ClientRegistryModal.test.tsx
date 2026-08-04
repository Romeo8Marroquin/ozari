import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { createRegistry } = vi.hoisted(() => ({ createRegistry: vi.fn() }));
const { useCreateClientRegistry } = vi.hoisted(() => ({ useCreateClientRegistry: vi.fn() }));
vi.mock('./useCreateClientRegistry', () => ({ useCreateClientRegistry }));

const { updateRegistry } = vi.hoisted(() => ({ updateRegistry: vi.fn() }));
const { useUpdateClientRegistry } = vi.hoisted(() => ({ useUpdateClientRegistry: vi.fn() }));
vi.mock('./useUpdateClientRegistry', () => ({ useUpdateClientRegistry }));

const { success, error } = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('@components/notifications/notify', () => ({ notify: { success, error } }));

// The picker is a lazy chunk pulling in Leaflet (real layout, not jsdom). Its own suite covers it;
// here it is stubbed to the one thing this modal cares about — a confirmed pin reaching the body.
vi.mock('@components/LocationPicker', () => ({
  default: ({ onConfirm }: { onConfirm: (coords: { lat: number; lng: number }) => void }) => (
    <button type="button" onClick={() => onConfirm({ lat: 14.634915, lng: -90.506883 })}>
      confirm-stub
    </button>
  ),
}));

import ClientRegistryModal from './ClientRegistryModal';
import type { ClientRegistry } from './order.types';

const KEY = 'modules.panel.orders.registry';
const contactTypes = [{ id: 1, name: 'WhatsApp' }, { id: 2, name: 'Teléfono' }, { id: 3, name: 'Correo electrónico' }];
const zones = [{ id: 6, name: 'Zona 10' }];
const paymentMethods = [{ id: 1, name: 'Efectivo' }, { id: 2, name: 'Transferencia' }];

type Handlers = { onSuccess: (r: unknown) => void; onError: (e: unknown) => void };

const renderModal = (onCreated = vi.fn(), onClose = vi.fn()) => {
  render(
    <ClientRegistryModal
      open
      onClose={onClose}
      onCreated={onCreated}
      contactTypes={contactTypes}
      zones={zones}
      paymentMethods={paymentMethods}
    />,
  );
  return { onCreated, onClose };
};

const principalRadios = () => screen.getAllByRole('radio', { name: `${KEY}.fields.principalContact` });
// queryAll — addresses can be reduced to zero, leaving no favorite radios.
const favoriteRadios = () => screen.queryAllByRole('radio', { name: `${KEY}.fields.favoriteAddress` });
const removeContactButtons = () => screen.queryAllByRole('button', { name: `${KEY}.actions.removeContact` });
const removeAddressButtons = () => screen.queryAllByRole('button', { name: `${KEY}.actions.removeAddress` });

/** Fill the default (one contact + one address) into a submittable state and return the handlers. */
const fillValid = async (): Promise<Handlers> => {
  const user = userEvent.setup({ delay: null });
  await user.type(screen.getByPlaceholderText(`${KEY}.fields.namePlaceholder`), 'María López');
  const selects = screen.getAllByRole('combobox');
  await user.selectOptions(selects[0] as HTMLElement, '1'); // first contact type
  await user.type(screen.getByPlaceholderText(`${KEY}.fields.contactValuePlaceholder`), '5555-1234');
  await user.type(screen.getByPlaceholderText(`${KEY}.fields.addressPlaceholder`), 'Zona 10, 4a avenida 5-55');
  await user.click(screen.getByRole('button', { name: `${KEY}.submit` }));
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
  useUpdateClientRegistry.mockReturnValue({ updateRegistry, isPending: false });
});
afterEach(() => vi.restoreAllMocks());

describe('ClientRegistryModal', () => {
  it('renders nothing when closed', () => {
    render(
      <ClientRegistryModal open={false} onClose={vi.fn()} onCreated={vi.fn()} contactTypes={contactTypes} zones={zones} paymentMethods={paymentMethods} />,
    );
    expect(screen.queryByText(`${KEY}.title`)).not.toBeInTheDocument();
  });

  it('submits the default single contact/address as arrays and, on success, hands back the registry + closes', async () => {
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
    // Explicit timeout like its siblings: this modal types through a full form, and every address
    // row now carries a location field too — comfortably under the default alone, but not while
    // the whole suite runs in parallel.
  }, 20000);

  it('saves an address PIN on the client, so future orders start with it found', async () => {
    const user = userEvent.setup({ delay: null });
    renderModal();

    // Set the pin BEFORE submitting — `fillValid` ends by submitting.
    await user.type(screen.getByPlaceholderText(`${KEY}.fields.namePlaceholder`), 'María López');
    await user.selectOptions(screen.getAllByRole('combobox')[0] as HTMLElement, '1');
    await user.type(screen.getByPlaceholderText(`${KEY}.fields.contactValuePlaceholder`), '5555-1234');
    await user.type(
      screen.getByPlaceholderText(`${KEY}.fields.addressPlaceholder`),
      'Zona 10, 4a avenida 5-55',
    );
    await user.click(screen.getByTestId('registry-coords-0-open'));
    await user.click(await screen.findByRole('button', { name: 'confirm-stub' }));
    await user.click(screen.getByRole('button', { name: `${KEY}.submit` }));

    await waitFor(() => expect(createRegistry).toHaveBeenCalled());
    expect(createRegistry.mock.calls[0]?.[0].addresses[0]).toMatchObject({
      coords: { lat: 14.634915, lng: -90.506883 },
    });

    // Removing it sends nothing again — a saved address with a wrong pin is worse than one without.
    await user.click(screen.getByTestId('registry-coords-0-clear'));
    await user.click(screen.getByRole('button', { name: `${KEY}.submit` }));
    await waitFor(() => expect(createRegistry).toHaveBeenCalledTimes(2));
    expect(createRegistry.mock.calls[1]?.[0].addresses[0]).not.toHaveProperty('coords');
  }, 20000);

  it('captures multiple contacts/addresses with the chosen principal/favorite and a preferred method', async () => {
    const user = userEvent.setup({ delay: null });
    renderModal();
    await user.type(screen.getByPlaceholderText(`${KEY}.fields.namePlaceholder`), 'María López');

    // First contact.
    let selects = screen.getAllByRole('combobox');
    await user.selectOptions(selects[0] as HTMLElement, '1');
    const contactValues = screen.getAllByPlaceholderText(`${KEY}.fields.contactValuePlaceholder`);
    await user.type(contactValues[0] as HTMLElement, '5555-1234');
    // Add a second contact and mark it principal.
    await user.click(screen.getByRole('button', { name: `${KEY}.actions.addContact` }));
    selects = screen.getAllByRole('combobox');
    await user.selectOptions(selects[1] as HTMLElement, '2');
    const contactValues2 = screen.getAllByPlaceholderText(`${KEY}.fields.contactValuePlaceholder`);
    await user.type(contactValues2[1] as HTMLElement, '4444-5678');
    await user.click(principalRadios()[1]);

    // First address.
    const addr1 = screen.getAllByPlaceholderText(`${KEY}.fields.addressPlaceholder`)[0];
    await user.type(addr1 as HTMLElement, 'Zona 10, 4a avenida 5-55');
    // Add a second address and mark it favorite.
    await user.click(screen.getByRole('button', { name: `${KEY}.actions.addAddress` }));
    const addr2 = screen.getAllByPlaceholderText(`${KEY}.fields.addressPlaceholder`)[1];
    await user.type(addr2 as HTMLElement, 'Hacienda Real lote 5');
    await user.click(favoriteRadios()[1]);

    // Preferred payment method (the last combobox).
    const allSelects = screen.getAllByRole('combobox');
    await user.selectOptions(allSelects[allSelects.length - 1] as HTMLElement, '2');

    await user.click(screen.getByRole('button', { name: `${KEY}.submit` }));
    await waitFor(() => expect(createRegistry).toHaveBeenCalled());
    expect(createRegistry.mock.calls[0][0]).toEqual({
      name: 'María López',
      contacts: [
        { contactTypeId: 1, value: '5555-1234', isPrincipal: false },
        { contactTypeId: 2, value: '4444-5678', isPrincipal: true },
      ],
      addresses: [
        { address: 'Zona 10, 4a avenida 5-55', isFavorite: false },
        { address: 'Hacienda Real lote 5', isFavorite: true },
      ],
      preferredPaymentMethodId: 2,
    });
  }, 20000);

  it('keeps the principal valid when removing a later, the selected, or an earlier contact', async () => {
    const user = userEvent.setup({ delay: null });
    const addContact = () => user.click(screen.getByRole('button', { name: `${KEY}.actions.addContact` }));
    renderModal();
    await addContact();
    await addContact(); // 3 contacts, principal defaults to 0

    // (a) current < index: remove a LATER contact → the principal (0) is untouched.
    await user.click(removeContactButtons()[2]);
    await waitFor(() => expect(principalRadios()).toHaveLength(2));
    expect(principalRadios()[0]).toBeChecked();
    // (b) current === index: remove the selected contact (0) → falls back to 0.
    await user.click(removeContactButtons()[0]);
    await waitFor(() => expect(principalRadios()).toHaveLength(1));
    expect(principalRadios()[0]).toBeChecked();
    // (c) current > index: select index 1, remove the earlier index 0 → shifts down to 0.
    await addContact(); // back to 2 contacts
    await user.click(principalRadios()[1]);
    await user.click(removeContactButtons()[0]);
    await waitFor(() => expect(principalRadios()).toHaveLength(1));
    expect(principalRadios()[0]).toBeChecked();
  }, 20000);

  it('keeps the favorite valid across removals and shows the empty note when all addresses are gone', async () => {
    const user = userEvent.setup({ delay: null });
    const addAddress = () => user.click(screen.getByRole('button', { name: `${KEY}.actions.addAddress` }));
    renderModal(); // 1 address, favorite 0
    await addAddress(); // 2 addresses

    // (a) current < index: remove a LATER address → favorite (0) untouched.
    await user.click(removeAddressButtons()[1]);
    await waitFor(() => expect(favoriteRadios()).toHaveLength(1));
    expect(favoriteRadios()[0]).toBeChecked();
    // (b) current > index: add one, select index 1, remove the earlier index 0 → shifts to 0.
    await addAddress();
    await user.click(favoriteRadios()[1]);
    await user.click(removeAddressButtons()[0]);
    await waitFor(() => expect(favoriteRadios()).toHaveLength(1));
    expect(favoriteRadios()[0]).toBeChecked();
    // (c) current === index: remove the last (selected) address → the empty note appears.
    await user.click(removeAddressButtons()[0]);
    await waitFor(() => expect(screen.getByText(`${KEY}.fields.addressesEmpty`)).toBeInTheDocument());
    expect(favoriteRadios()).toHaveLength(0);
  }, 20000);

  it('adapts the contact keyboard + autofill hints to the email channel', async () => {
    const user = userEvent.setup({ delay: null });
    renderModal();
    await user.selectOptions(screen.getAllByRole('combobox')[0] as HTMLElement, '3'); // Correo
    const valueInput = screen.getByPlaceholderText(`${KEY}.fields.contactValuePlaceholder`);
    expect(valueInput).toHaveAttribute('inputmode', 'email');
    expect(valueInput).toHaveAttribute('autocapitalize', 'none');
    expect(valueInput).toHaveAttribute('autocorrect', 'off');
  });

  it('surfaces a 400 inline and a 500 as a toast', async () => {
    renderModal();
    const handlers = await fillValid();

    act(() => handlers.onError(axiosError(400, 'Datos inválidos')));
    expect(await screen.findByText('Datos inválidos')).toBeInTheDocument();

    act(() => handlers.onError(axiosError(500)));
    expect(error).toHaveBeenCalled();
    // Explicit timeout like every other test that runs `fillValid`: it types through the whole form,
    // which is slow under the parallel suite.
  }, 20000);

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
    // Explicit timeout like its siblings: typing through the whole form is slow under a parallel
    // suite, and every address row now carries a location field too.
  }, 20000);

  describe('edit mode', () => {
    const existing: ClientRegistry = {
      id: 7,
      name: 'María López',
      notes: 'Cliente frecuente',
      contacts: [
        { id: 11, contactType: { id: 1, name: 'WhatsApp' }, value: '5555-1234', isPrincipal: false },
        { id: 12, contactType: { id: 2, name: 'Teléfono' }, value: '4444-5678', isPrincipal: true },
      ],
      addresses: [
        {
          id: 21,
          zone: { id: 6, name: 'Zona 10' },
          address: 'Zona 10, 4a avenida 5-55',
          instructions: 'Portón negro',
          coords: { lat: 14.634915, lng: -90.506883 },
          isFavorite: true,
        },
      ],
      preferredPaymentMethod: { id: 2, name: 'Transferencia' },
      createdAt: 'x',
    };

    const renderEdit = (onCreated = vi.fn(), onClose = vi.fn(), registry = existing) => {
      render(
        <ClientRegistryModal
          open
          onClose={onClose}
          onCreated={onCreated}
          registry={registry}
          contactTypes={contactTypes}
          zones={zones}
          paymentMethods={paymentMethods}
        />,
      );
      return { onCreated, onClose };
    };

    it('prefills every field the body carries and saves the SAME shape through the update door', async () => {
      const { onCreated, onClose } = renderEdit();
      expect(screen.getByText(`${KEY}.editTitle`)).toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: `${KEY}.submitEdit` }));
      await waitFor(() => expect(updateRegistry).toHaveBeenCalled());
      expect(createRegistry).not.toHaveBeenCalled();

      // Saving an UNTOUCHED edit form must send back exactly what is stored — including the notes
      // and the arrival instructions, which a full-state save would otherwise erase.
      expect(updateRegistry.mock.calls[0][0]).toEqual({
        id: 7,
        body: {
          name: 'María López',
          notes: 'Cliente frecuente',
          contacts: [
            { contactTypeId: 1, value: '5555-1234', isPrincipal: false },
            { contactTypeId: 2, value: '4444-5678', isPrincipal: true },
          ],
          addresses: [
            {
              zoneId: 6,
              address: 'Zona 10, 4a avenida 5-55',
              coords: { lat: 14.634915, lng: -90.506883 },
              instructions: 'Portón negro',
              isFavorite: true,
            },
          ],
          preferredPaymentMethodId: 2,
        },
      });

      const handlers = updateRegistry.mock.calls[0][1] as Handlers;
      act(() => handlers.onSuccess({ data: { data: { registry: existing } } }));
      expect(success).toHaveBeenCalledWith(`${KEY}.updatedToast`, { title: `${KEY}.updatedTitle` });
      expect(onCreated).toHaveBeenCalledWith(existing);
      expect(onClose).toHaveBeenCalled();
    }, 20000);

    it('falls back to the first row when the API flagged no principal/favorite, and to empty optionals', async () => {
      renderEdit(vi.fn(), vi.fn(), {
        id: existing.id,
        name: existing.name,
        createdAt: existing.createdAt,
        contacts: [{ id: 11, contactType: { id: 1, name: 'WhatsApp' }, value: '5555-1234', isPrincipal: false }],
        addresses: [{ id: 21, address: 'Hacienda Real lote 5', isFavorite: false }],
      });

      await userEvent.click(screen.getByRole('button', { name: `${KEY}.submitEdit` }));
      await waitFor(() => expect(updateRegistry).toHaveBeenCalled());
      expect(updateRegistry.mock.calls[0][0].body).toEqual({
        name: 'María López',
        contacts: [{ contactTypeId: 1, value: '5555-1234', isPrincipal: true }],
        addresses: [{ address: 'Hacienda Real lote 5', isFavorite: true }],
      });
    }, 20000);

    it('surfaces an update failure the same way a create failure is surfaced', async () => {
      renderEdit();
      await userEvent.click(screen.getByRole('button', { name: `${KEY}.submitEdit` }));
      await waitFor(() => expect(updateRegistry).toHaveBeenCalled());
      const handlers = updateRegistry.mock.calls[0][1] as Handlers;

      act(() => handlers.onError(axiosError(400, 'Datos inválidos')));
      expect(await screen.findByText('Datos inválidos')).toBeInTheDocument();
    }, 20000);
  });
});
