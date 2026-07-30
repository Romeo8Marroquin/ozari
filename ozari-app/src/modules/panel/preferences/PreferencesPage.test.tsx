import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { usePreferences } = vi.hoisted(() => ({ usePreferences: vi.fn() }));
const { updateSettings, useUpdatePreferenceSettings } = vi.hoisted(() => ({
  updateSettings: vi.fn(),
  useUpdatePreferenceSettings: vi.fn(),
}));
const { createRow, updateRow, deleteRow, commitDeletion, useCatalogRowMutations } = vi.hoisted(
  () => ({
    createRow: vi.fn(),
    updateRow: vi.fn(),
    deleteRow: vi.fn(),
    commitDeletion: vi.fn(),
    useCatalogRowMutations: vi.fn(),
  }),
);
vi.mock('./usePreferences', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./usePreferences')>()),
  usePreferences,
  useUpdatePreferenceSettings,
  useCatalogRowMutations,
}));

const { notify } = vi.hoisted(() => ({
  notify: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));
vi.mock('@components/notifications/notify', () => ({ notify }));

const { toFormError } = vi.hoisted(() => ({ toFormError: vi.fn(() => ({})) }));
vi.mock('@utils/apiError', () => ({ toFormError, getStatus: vi.fn() }));

const { usePanelPageMotion } = vi.hoisted(() => ({ usePanelPageMotion: vi.fn() }));
vi.mock('../PanelPageTransitionContext', () => ({ usePanelPageMotion }));

// The page reads the open group from the URL and writes it back via navigate, so the tests drive the
// same round trip the router does.
const routerState = vi.hoisted(() => ({ search: {} as Record<string, unknown> }));
const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock('@tanstack/react-router', () => ({
  useSearch: () => routerState.search,
  useNavigate: () => navigate,
}));

// Only the row transitions are spied on — the rest of the vocabulary stays real so the page's own
// reveal, tab swap and editor cross-fade still run exactly as they do in the app.
const { editorSlotOut, revealInScroller } = vi.hoisted(() => ({
  editorSlotOut: vi.fn(() => Promise.resolve()),
  revealInScroller: vi.fn(),
}));
vi.mock('../pageMotion', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../pageMotion')>()),
  editorSlotOut,
  revealInScroller,
}));

import { PanelNavContext, type PanelNav } from '../PanelNavContext';
import PreferencesPage from './PreferencesPage';
import type { PreferenceTab } from './preferencesSearch';
import type { PreferencesResponse } from './preference.types';

const KEY = 'modules.panel.preferences';

const data = (over: Partial<PreferencesResponse> = {}): PreferencesResponse => ({
  settings: [
    { key: 'orders.logisticsSpacingMinutes', type: 'int', value: 60, min: 1, max: 1440, group: 'orders' },
    { key: 'orders.turnaroundMinutes', type: 'int', value: 120, min: 0, max: 1440, group: 'orders' },
    { key: 'orders.evidenceMinPhotos', type: 'int', value: 1, min: 1, max: 20, group: 'evidence' },
    { key: 'orders.evidenceMaxPhotos', type: 'int', value: 10, min: 1, max: 20, group: 'evidence' },
    { key: 'orders.evidenceRetentionMonths', type: 'int', value: 24, min: 1, max: 120, group: 'evidence' },
  ],
  catalogs: {
    eventTypes: [
      {
        id: 1,
        name: 'Evento familiar',
        description: 'Cumpleaños',
        isActive: true,
        minLeadHours: 24,
        isReferenced: true,
      },
      { id: 2, name: 'Retirado', isActive: false, minLeadHours: 48, isReferenced: false },
    ],
    contactTypes: [{ id: 1, name: 'WhatsApp', isActive: true, isReferenced: false }],
    zones: [
      // In use by an address, so its delete will HIDE it rather than remove it.
      { id: 6, name: 'Zona 10', isActive: true, deliveryFee: 50, municipalityId: 4, isReferenced: true },
      { id: 7, name: 'Hacienda Real', isActive: true, municipalityId: 4, isReferenced: false },
    ],
    paymentMethods: [{ id: 1, name: 'Efectivo', isActive: true, isReferenced: false }],
    productCategories: [{ id: 1, name: 'Mesas', isActive: true, isReferenced: false }],
    productDetailTypes: [],
  },
  municipalities: [{ id: 4, name: 'Mixco', isActive: true }],
  ...over,
});

const setState = (state: Record<string, unknown>) =>
  usePreferences.mockReturnValue({
    data: undefined,
    isLoading: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
    ...state,
  });

let rerenderPage: () => void = () => undefined;

const renderPage = () => {
  const navigateTo = vi.fn();
  const nav: PanelNav = { navigateTo, pending: null };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <PanelNavContext.Provider value={nav}>{children}</PanelNavContext.Provider>
  );
  const result = render(<PreferencesPage />, { wrapper });
  rerenderPage = () => result.rerender(<PreferencesPage />);
  return result;
};

/** Stand in for the router: apply whatever the page last asked `navigate` for, then re-render — so a
 *  tab only changes because the URL did, exactly as in the app. */
const applyNavigation = (): void => {
  const calls = navigate.mock.calls;
  const asked = calls[calls.length - 1]?.[0] as { search?: Record<string, unknown> } | undefined;
  routerState.search = asked?.search ?? {};
  rerenderPage();
};

/** The card following a section heading — sections share one list component, so tests scope by title. */
const cardFor = (title: string): HTMLElement => {
  const section = screen.getByText(title).closest('section');
  if (!section) throw new Error(`no section for ${title}`);
  return section as HTMLElement;
};

/** Switch groups the way a user does — click, the URL changes, the swap commits. */
const openTab = async (tab: PreferenceTab, firstSection: string): Promise<HTMLElement> => {
  await userEvent.click(screen.getByRole('tab', { name: `${KEY}.tabs.${tab}` }));
  applyNavigation();
  await screen.findByText(`${KEY}.${firstSection}.title`);
  return cardFor(`${KEY}.${firstSection}.title`);
};

const openOrders = () => openTab('orders', 'catalogs.eventTypes');
const openProducts = () => openTab('products', 'catalogs.productCategories');

beforeEach(() => {
  vi.clearAllMocks();
  routerState.search = {};
  useUpdatePreferenceSettings.mockReturnValue({ updateSettings, isPending: false });
  useCatalogRowMutations.mockReturnValue({
    createRow,
    updateRow,
    deleteRow,
    commitDeletion,
    isSaving: false,
    isDeleting: false,
  });
});

describe('PreferencesPage groups', () => {
  it('opens on the operation settings and shows only that group', () => {
    setState({ data: data() });
    renderPage();

    // Rendered FROM the API's list — a setting added server-side appears with no frontend change
    // beyond its two strings.
    expect(screen.getByLabelText(`${KEY}.settings.logisticsSpacingMinutes.label`)).toHaveValue(60);
    expect(screen.getByLabelText(`${KEY}.settings.evidenceRetentionMonths.label`)).toHaveValue(24);
    // Eight cards in one column meant eight simultaneous morphs and a cascade long enough to read as
    // lag — the catalogs live under their own tabs now.
    expect(screen.queryByText(`${KEY}.catalogs.eventTypes.title`)).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: `${KEY}.tabs.operation` })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('groups the order catalogs and the product catalogs separately', async () => {
    setState({ data: data() });
    renderPage();

    await openOrders();
    expect(screen.getByText(`${KEY}.catalogs.zones.title`)).toBeInTheDocument();
    expect(screen.getByText(`${KEY}.catalogs.contactTypes.title`)).toBeInTheDocument();
    expect(screen.queryByText(`${KEY}.catalogs.productCategories.title`)).not.toBeInTheDocument();
    // The settings left with their tab.
    expect(screen.queryByLabelText(`${KEY}.settings.turnaroundMinutes.label`)).not.toBeInTheDocument();

    await openProducts();
    expect(screen.getByText(`${KEY}.catalogs.productDetailTypes.title`)).toBeInTheDocument();
    expect(screen.queryByText(`${KEY}.catalogs.zones.title`)).not.toBeInTheDocument();
  });

  it('labels the panel by the tab that is actually rendered', async () => {
    setState({ data: data() });
    renderPage();
    expect(screen.getByRole('tabpanel')).toHaveAttribute(
      'aria-labelledby',
      'preferences-tab-operation',
    );
    await openOrders();
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'preferences-tab-orders');
  });

  it('lists a catalog with its unpublished rows and unset fees marked', async () => {
    setState({ data: data() });
    renderPage();
    await openOrders();

    expect(screen.getByText('Evento familiar')).toBeInTheDocument();
    // Unpublished rows ARE shown — this is the screen where the flag is edited.
    expect(screen.getByText('Retirado')).toBeInTheDocument();
    expect(screen.getByText(`${KEY}.badges.inactive`)).toBeInTheDocument();
    // A zone with no configured fee says so, rather than reading as free.
    expect(screen.getByText(`${KEY}.badges.noFee`)).toBeInTheDocument();
    expect(screen.getByText(`${KEY}.badges.fee`)).toBeInTheDocument();
    expect(screen.getAllByText(`${KEY}.badges.leadHours`)).toHaveLength(2);
  });

  it('hides the group switch when the load failed — there is nothing to switch between', async () => {
    const refetch = vi.fn();
    setState({ isError: true, refetch });
    renderPage();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(screen.getByText(`${KEY}.error.title`)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: `${KEY}.error.retry` }));
    expect(refetch).toHaveBeenCalled();
  });

  it('announces the cold load and shows the cards structure, not a spinner', () => {
    setState({ isLoading: true });
    renderPage();
    expect(screen.getByRole('status')).toHaveAttribute('aria-label', `${KEY}.loading`);
    // Every card's chrome is already real — only the bodies shimmer.
    expect(screen.getByText(`${KEY}.groups.orders.title`)).toBeInTheDocument();
  });

  it('RESOLVES the cold load in place — the chrome stays, only the bodies swap', async () => {
    setState({ isLoading: true });
    const { rerender } = renderPage();
    expect(screen.getByRole('status')).toBeInTheDocument();

    // The data lands: each card morphs its own body from shimmer to content (SectionReveal), rather
    // than the page replacing itself — so the titles never move and the busy marker just goes away.
    setState({ data: data() });
    rerender(<PreferencesPage />);

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByText(`${KEY}.groups.orders.title`)).toBeInTheDocument();
    expect(
      await screen.findByLabelText(`${KEY}.settings.turnaroundMinutes.label`),
    ).toBeInTheDocument();
  });

  it('registers its enter/exit pair with the panel transition controller', async () => {
    setState({ data: data() });
    renderPage();
    const motion = usePanelPageMotion.mock.calls[0]?.[0] as {
      enter: (options?: unknown) => void;
      exit: () => Promise<void>;
    };
    // A canonical arrival comes from the side (this screen's axis is lateral); RESUMING a cancelled
    // exit has no canonical side, so it settles from wherever the sections currently stand.
    motion.enter();
    motion.enter({ fromCurrent: true });
    await motion.exit();
  });
});

describe('PreferenceTabs', () => {
  it('moves and selects with the arrow keys, Home and End', async () => {
    setState({ data: data() });
    renderPage();
    const selected = () =>
      screen.getAllByRole('tab').find((tab) => tab.getAttribute('aria-selected') === 'true');
    const press = async (key: string): Promise<void> => {
      await userEvent.keyboard(key);
      applyNavigation();
    };
    // Roving tabindex: only the selected tab is reachable by Tab, and activation moves focus with it,
    // so every key below is pressed on whichever tab currently holds it.
    screen.getByRole('tab', { name: `${KEY}.tabs.operation` }).focus();

    await press('{ArrowRight}');
    expect(selected()).toHaveAttribute('id', 'preferences-tab-orders');
    await press('{End}');
    expect(selected()).toHaveAttribute('id', 'preferences-tab-products');
    // Wrapping: right from the last lands on the first.
    await press('{ArrowRight}');
    expect(selected()).toHaveAttribute('id', 'preferences-tab-operation');
    // And left from the first wraps to the last.
    await press('{ArrowLeft}');
    expect(selected()).toHaveAttribute('id', 'preferences-tab-products');
    await press('{Home}');
    expect(selected()).toHaveAttribute('id', 'preferences-tab-operation');

    // Any other key is left to the browser — nothing is asked of the URL.
    navigate.mockClear();
    await userEvent.keyboard('a');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('slides ONE pill to the active segment rather than restyling the buttons', async () => {
    setState({ data: data() });
    const { container } = renderPage();
    const pill = container.querySelector('[role="tablist"] > span[aria-hidden]');
    expect(pill).toHaveStyle({ translate: '0%' });
    await openProducts();
    expect(pill).toHaveStyle({ translate: '200%' });
  });

  it('abandons a sweep whose group was left behind', async () => {
    setState({ data: data() });
    const { unmount } = renderPage();
    // The URL changes and the screen tears down within the same tick: the sweep resolves afterwards,
    // and a stale one must not commit a group this screen is no longer showing.
    routerState.search = { grupo: 'pedidos' };
    rerenderPage();
    unmount();
    await Promise.resolve();
  });

  it('re-selecting the open tab asks nothing of the URL', async () => {
    setState({ data: data() });
    renderPage();
    await userEvent.click(screen.getByRole('tab', { name: `${KEY}.tabs.operation` }));
    expect(navigate).not.toHaveBeenCalled();
    expect(screen.getByLabelText(`${KEY}.settings.turnaroundMinutes.label`)).toBeInTheDocument();
  });

  it('OPENS on the group the URL names, so a reload comes back where the admin was', async () => {
    // The whole point of putting it in the URL: refreshing on the product catalogs must not drop the
    // admin back on the settings.
    routerState.search = { grupo: 'productos' };
    setState({ data: data() });
    renderPage();
    expect(screen.getByText(`${KEY}.catalogs.productCategories.title`)).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: `${KEY}.tabs.products` })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.queryByLabelText(`${KEY}.settings.turnaroundMinutes.label`)).not.toBeInTheDocument();
  });

  it('writes the group as a SPANISH url marker, and the default as no marker at all', async () => {
    setState({ data: data() });
    renderPage();
    await userEvent.click(screen.getByRole('tab', { name: `${KEY}.tabs.orders` }));
    expect(navigate).toHaveBeenCalledWith({ search: { grupo: 'pedidos' }, viewTransition: false });

    applyNavigation();
    await userEvent.click(screen.getByRole('tab', { name: `${KEY}.tabs.operation` }));
    // The default group leaves the URL clean.
    expect(navigate).toHaveBeenLastCalledWith({ search: {}, viewTransition: false });
  });
});

describe('PreferenceSettingsCard', () => {
  it('keeps the save button inert until a setting actually changes', async () => {
    setState({ data: data() });
    renderPage();
    const save = screen.getAllByRole('button', { name: `${KEY}.settings.save` })[0]!;
    // A control that always looks ready to save trains people to stop reading it.
    expect(save).toBeDisabled();

    const field = screen.getByLabelText(`${KEY}.settings.turnaroundMinutes.label`);
    await userEvent.clear(field);
    await userEvent.type(field, '180');
    expect(save).toBeEnabled();
  });

  it('sends the whole group and reports success', async () => {
    setState({ data: data() });
    renderPage();
    const field = screen.getByLabelText(`${KEY}.settings.turnaroundMinutes.label`);
    await userEvent.clear(field);
    await userEvent.type(field, '180');
    await userEvent.click(screen.getAllByRole('button', { name: `${KEY}.settings.save` })[0]!);

    expect(updateSettings.mock.calls[0]?.[0]).toEqual([
      { key: 'orders.logisticsSpacingMinutes', value: 60 },
      { key: 'orders.turnaroundMinutes', value: 180 },
    ]);
    updateSettings.mock.calls[0]?.[1].onSuccess();
    expect(notify.success).toHaveBeenCalledWith(`${KEY}.toasts.settingsSaved`);
  });

  it('blocks an out-of-range value and an INVERTED evidence range before the request', async () => {
    setState({ data: data() });
    renderPage();

    const spacing = screen.getByLabelText(`${KEY}.settings.logisticsSpacingMinutes.label`);
    await userEvent.clear(spacing);
    await userEvent.type(spacing, '99999');
    await userEvent.click(screen.getAllByRole('button', { name: `${KEY}.settings.save` })[0]!);
    expect(await screen.findByText(`${KEY}.settings.rangeError`)).toBeInTheDocument();
    expect(updateSettings).not.toHaveBeenCalled();

    // An emptied field is not zero — it is "being retyped", and must not save as 0.
    await userEvent.clear(spacing);
    await userEvent.click(screen.getAllByRole('button', { name: `${KEY}.settings.save` })[0]!);
    expect(await screen.findByText(`${KEY}.settings.integerError`)).toBeInTheDocument();

    // The evidence pair: a status inheriting max < min could never be satisfied.
    const max = screen.getByLabelText(`${KEY}.settings.evidenceMaxPhotos.label`);
    await userEvent.clear(max);
    await userEvent.type(max, '0');
    await userEvent.click(screen.getAllByRole('button', { name: `${KEY}.settings.save` })[1]!);
    expect(await screen.findByText(`${KEY}.settings.rangeError`)).toBeInTheDocument();
  });

  it('surfaces a failed save as a toast — the card has no banner of its own', async () => {
    toFormError.mockReturnValue({ toast: 'sin conexión' });
    setState({ data: data() });
    renderPage();
    const field = screen.getByLabelText(`${KEY}.settings.turnaroundMinutes.label`);
    await userEvent.clear(field);
    await userEvent.type(field, '30');
    await userEvent.click(screen.getAllByRole('button', { name: `${KEY}.settings.save` })[0]!);
    updateSettings.mock.calls[0]?.[1].onError(new Error('boom'));
    expect(notify.error).toHaveBeenCalledWith('sin conexión');
  });

  it('falls back to a generic message when a failed save carries neither shape', async () => {
    toFormError.mockReturnValue({});
    setState({ data: data() });
    renderPage();
    const field = screen.getByLabelText(`${KEY}.settings.turnaroundMinutes.label`);
    await userEvent.clear(field);
    await userEvent.type(field, '30');
    await userEvent.click(screen.getAllByRole('button', { name: `${KEY}.settings.save` })[0]!);
    updateSettings.mock.calls[0]?.[1].onError(new Error('boom'));
    expect(notify.error).toHaveBeenCalledWith(`${KEY}.errors.saveFallback`);
  });

  it('follows the server after a save — the fields show what the system will actually read', async () => {
    setState({ data: data() });
    const { rerender } = renderPage();
    const field = screen.getByLabelText(`${KEY}.settings.turnaroundMinutes.label`);
    await userEvent.clear(field);
    await userEvent.type(field, '999');
    expect(screen.getAllByRole('button', { name: `${KEY}.settings.save` })[0]!).toBeEnabled();

    // The server clamped it: the reloaded value arrives through the query cache, and the edit in
    // progress must give way to it rather than keep showing a number nothing will honour.
    const clamped = data();
    clamped.settings[1]!.value = 240;
    setState({ data: clamped });
    rerender(<PreferencesPage />);

    expect(screen.getByLabelText(`${KEY}.settings.turnaroundMinutes.label`)).toHaveValue(240);
    expect(screen.getAllByRole('button', { name: `${KEY}.settings.save` })[0]!).toBeDisabled();
  });
});

describe('PreferenceCatalogCard editing', () => {
  it('adds a catalog row through the inline editor', async () => {
    setState({ data: data() });
    renderPage();
    await openOrders();
    const card = cardFor(`${KEY}.catalogs.contactTypes.title`);

    await userEvent.click(within(card).getByRole('button', { name: `${KEY}.actions.add` }));
    await userEvent.type(within(card).getByLabelText(`${KEY}.rowForm.name`), 'Telegram');
    await userEvent.click(within(card).getByRole('button', { name: `${KEY}.rowForm.save` }));

    expect(createRow.mock.calls[0]?.[0]).toEqual({ name: 'Telegram', isActive: true });
    createRow.mock.calls[0]?.[1].onSuccess();
    // The editor leaves before the card closes around it, so the list is back once that settles.
    await waitFor(() =>
      expect(within(card).queryByLabelText(`${KEY}.rowForm.name`)).not.toBeInTheDocument(),
    );
    expect(notify.success).toHaveBeenCalledWith(`${KEY}.toasts.created`);
  });

  it('SAVES on Enter from a field, like any other form in the app', async () => {
    setState({ data: data() });
    renderPage();
    await openOrders();
    const card = cardFor(`${KEY}.catalogs.contactTypes.title`);

    await userEvent.click(within(card).getByRole('button', { name: `${KEY}.actions.add` }));
    // Typed straight into the field and committed with the keyboard — never touching the button.
    await userEvent.type(within(card).getByLabelText(`${KEY}.rowForm.name`), 'Telegram{Enter}');
    expect(createRow.mock.calls[0]?.[0]).toEqual({ name: 'Telegram', isActive: true });
  });

  it('shows OUR range message on Enter, not the browser bubble', async () => {
    setState({ data: data() });
    renderPage();

    // The inputs carry the API's bounds as `min`/`max`, so without `noValidate` the browser would
    // block submission with its own untranslated tooltip and this message would never appear.
    const spacing = screen.getByLabelText(`${KEY}.settings.logisticsSpacingMinutes.label`);
    await userEvent.clear(spacing);
    await userEvent.type(spacing, '99999{Enter}');
    expect(await screen.findByText(`${KEY}.settings.rangeError`)).toBeInTheDocument();
    expect(updateSettings).not.toHaveBeenCalled();

    // And a valid value saves from the keyboard alone.
    await userEvent.clear(spacing);
    await userEvent.type(spacing, '90{Enter}');
    expect(updateSettings.mock.calls[0]?.[0]).toContainEqual({
      key: 'orders.logisticsSpacingMinutes',
      value: 90,
    });
  });

  it('refuses to submit a row whose name is too short, explaining once', async () => {
    setState({ data: data() });
    renderPage();
    const card = await openProducts();

    await userEvent.click(within(card).getByRole('button', { name: `${KEY}.actions.add` }));
    await userEvent.type(within(card).getByLabelText(`${KEY}.rowForm.name`), 'x');
    await userEvent.click(within(card).getByRole('button', { name: `${KEY}.rowForm.save` }));
    expect(await screen.findByText(`${KEY}.rowForm.nameError`)).toBeInTheDocument();
    expect(createRow).not.toHaveBeenCalled();
  });

  it('shows an EVENT TYPE its lead time and a ZONE its municipality + nullable fee', async () => {
    setState({ data: data() });
    renderPage();
    const events = await openOrders();

    // Which fields appear is driven by the catalog, mirroring the backend registry.
    await userEvent.click(within(events).getByRole('button', { name: `${KEY}.actions.add` }));
    expect(within(events).getByLabelText(`${KEY}.rowForm.leadHours`)).toBeInTheDocument();
    expect(within(events).queryByLabelText(`${KEY}.rowForm.fee`)).not.toBeInTheDocument();

    const zones = cardFor(`${KEY}.catalogs.zones.title`);
    await userEvent.click(within(zones).getByRole('button', { name: `${KEY}.actions.add` }));
    expect(within(zones).getByLabelText(`${KEY}.rowForm.municipality`)).toBeInTheDocument();
    expect(within(zones).queryByLabelText(`${KEY}.rowForm.leadHours`)).not.toBeInTheDocument();
  });

  it('requires a zone its municipality, and keeps an empty fee as NULL', async () => {
    setState({ data: data() });
    renderPage();
    await openOrders();
    const zones = cardFor(`${KEY}.catalogs.zones.title`);

    await userEvent.click(within(zones).getByRole('button', { name: `${KEY}.actions.add` }));
    await userEvent.type(within(zones).getByLabelText(`${KEY}.rowForm.name`), 'Zona 26');
    await userEvent.click(within(zones).getByRole('button', { name: `${KEY}.rowForm.save` }));
    expect(await screen.findByText(`${KEY}.rowForm.municipalityError`)).toBeInTheDocument();

    await userEvent.selectOptions(within(zones).getByLabelText(`${KEY}.rowForm.municipality`), '4');
    await userEvent.click(within(zones).getByRole('button', { name: `${KEY}.rowForm.save` }));
    // Empty fee = "not configured", which is NOT free.
    expect(createRow.mock.calls[0]?.[0]).toEqual({
      name: 'Zona 26',
      isActive: true,
      municipalityId: 4,
      deliveryFee: null,
    });
  });

  it('rejects a malformed lead time and a malformed fee', async () => {
    setState({ data: data() });
    renderPage();
    const events = await openOrders();

    await userEvent.click(within(events).getByRole('button', { name: `${KEY}.actions.add` }));
    await userEvent.type(within(events).getByLabelText(`${KEY}.rowForm.name`), 'Boda');
    await userEvent.clear(within(events).getByLabelText(`${KEY}.rowForm.leadHours`));
    await userEvent.click(within(events).getByRole('button', { name: `${KEY}.rowForm.save` }));
    expect(await screen.findByText(`${KEY}.rowForm.leadError`)).toBeInTheDocument();

    const zones = cardFor(`${KEY}.catalogs.zones.title`);
    await userEvent.click(within(zones).getByRole('button', { name: `${KEY}.actions.add` }));
    await userEvent.type(within(zones).getByLabelText(`${KEY}.rowForm.name`), 'Zona 26');
    await userEvent.selectOptions(within(zones).getByLabelText(`${KEY}.rowForm.municipality`), '4');
    await userEvent.type(within(zones).getByLabelText(`${KEY}.rowForm.fee`), 'gratis');
    await userEvent.click(within(zones).getByRole('button', { name: `${KEY}.rowForm.save` }));
    expect(await screen.findByText(`${KEY}.rowForm.feeError`)).toBeInTheDocument();
  });

  it('edits an existing row, prefilled, and can be cancelled', async () => {
    setState({ data: data() });
    renderPage();
    const card = await openOrders();

    await userEvent.click(
      within(card).getAllByRole('button', { name: `${KEY}.actions.editRow` })[0]!,
    );
    expect(within(card).getByLabelText(`${KEY}.rowForm.name`)).toHaveValue('Evento familiar');
    expect(within(card).getByLabelText(`${KEY}.rowForm.leadHours`)).toHaveValue(24);
    expect(within(card).getByLabelText(`${KEY}.rowForm.description`)).toHaveValue('Cumpleaños');

    await userEvent.click(within(card).getByRole('button', { name: `${KEY}.rowForm.cancel` }));
    await waitFor(() =>
      expect(within(card).queryByLabelText(`${KEY}.rowForm.name`)).not.toBeInTheDocument(),
    );

    await userEvent.click(
      within(card).getAllByRole('button', { name: `${KEY}.actions.editRow` })[0]!,
    );
    await userEvent.click(within(card).getByRole('button', { name: `${KEY}.rowForm.save` }));
    expect(updateRow.mock.calls[0]?.[0]).toMatchObject({ id: 1 });
    updateRow.mock.calls[0]?.[1].onSuccess();
    expect(notify.success).toHaveBeenCalledWith(`${KEY}.toasts.updated`);
  });

  it('FOLLOWS the editor it just opened, so it can never open below the fold', async () => {
    setState({ data: data() });
    renderPage();
    await openOrders();
    const card = cardFor(`${KEY}.catalogs.contactTypes.title`);

    // Opening an editor IS a request to see it: clicking "Agregar" at the bottom of a long card must
    // not put the form somewhere the user then has to go looking for. The panel follows it down (by
    // the minimum needed) in step with the card's growth.
    expect(revealInScroller).not.toHaveBeenCalled();
    await userEvent.click(within(card).getByRole('button', { name: `${KEY}.actions.add` }));
    expect(revealInScroller).toHaveBeenCalledTimes(1);
    expect(revealInScroller.mock.calls[0]?.[0]).toContainElement(
      within(card).getByLabelText(`${KEY}.rowForm.name`),
    );

    // Closing does NOT scroll: the height eases shut and the browser's own clamp rides it down, so
    // moving the panel again would be a second, competing motion.
    await userEvent.click(within(card).getByRole('button', { name: `${KEY}.rowForm.cancel` }));
    await waitFor(() =>
      expect(within(card).queryByLabelText(`${KEY}.rowForm.name`)).not.toBeInTheDocument(),
    );
    expect(revealInScroller).toHaveBeenCalledTimes(1);
  });

  it('gives a slot a FRESH node when its editor leaves', async () => {
    setState({ data: data() });
    renderPage();
    await openOrders();
    const card = cardFor(`${KEY}.catalogs.contactTypes.title`);
    /** The wrapper holding the inline editor — the node whose identity matters here. */
    const editorSlot = (): Element | null | undefined =>
      within(card)
        .getByRole('button', { name: `${KEY}.rowForm.save` })
        .closest('div.flex.flex-col.gap-4')?.parentElement;

    // Both variants of a slot are `<div>`s in the same position, so React WOULD reconcile them as the
    // same DOM node and only swap the className — carrying over the `visibility:hidden` the editor's
    // exit animation left behind. That shipped once as an invisible "Agregar" button still occupying
    // its space. Distinct keys make it structurally impossible, which is what this pins.
    await userEvent.click(within(card).getByRole('button', { name: `${KEY}.actions.add` }));
    const whileAdding = editorSlot();
    await userEvent.click(within(card).getByRole('button', { name: `${KEY}.rowForm.cancel` }));
    await waitFor(() =>
      expect(within(card).queryByLabelText(`${KEY}.rowForm.name`)).not.toBeInTheDocument(),
    );
    const button = within(card).getByRole('button', { name: `${KEY}.actions.add` });
    expect(button.parentElement).not.toBe(whileAdding);
    expect(button).toBeVisible();

    // The same hazard on a ROW: its editor and its label share a position too.
    await userEvent.click(within(card).getByRole('button', { name: `${KEY}.actions.editRow` }));
    const whileEditing = editorSlot();
    await userEvent.click(within(card).getByRole('button', { name: `${KEY}.rowForm.cancel` }));
    const label = await within(card).findByText('WhatsApp');
    expect(label.closest('div')).not.toBe(whileEditing);
    expect(label).toBeVisible();
  });

  it('HANDS OVER between editors instead of cutting one off', async () => {
    setState({ data: data() });
    renderPage();
    const card = await openOrders();

    // Open the second row's editor while the first row's is still open: the open one leaves, then the
    // next takes the slot — one movement, not a hard swap.
    await userEvent.click(
      within(card).getAllByRole('button', { name: `${KEY}.actions.editRow` })[0]!,
    );
    expect(within(card).getByLabelText(`${KEY}.rowForm.name`)).toHaveValue('Evento familiar');

    await userEvent.click(
      within(card).getAllByRole('button', { name: `${KEY}.actions.editRow` })[0]!,
    );
    await waitFor(() =>
      expect(within(card).getByLabelText(`${KEY}.rowForm.name`)).toHaveValue('Retirado'),
    );
    // Still exactly ONE editor open.
    expect(within(card).getAllByLabelText(`${KEY}.rowForm.name`)).toHaveLength(1);

    // And the same hand-off from a row editor to the "new row" editor.
    await userEvent.click(within(card).getByRole('button', { name: `${KEY}.actions.add` }));
    await waitFor(() =>
      expect(within(card).getByLabelText(`${KEY}.rowForm.name`)).toHaveValue(''),
    );
  });

  it('unpublishes through the switch instead of deleting', async () => {
    setState({ data: data() });
    renderPage();
    const card = await openOrders();

    await userEvent.click(
      within(card).getAllByRole('button', { name: `${KEY}.actions.editRow` })[0]!,
    );
    await userEvent.click(within(card).getByRole('switch', { name: `${KEY}.rowForm.active` }));
    await userEvent.click(within(card).getByRole('button', { name: `${KEY}.rowForm.save` }));
    expect(updateRow.mock.calls[0]?.[0].body.isActive).toBe(false);
  });

  it('prefills a ZONE with its configured fee and municipality, and sends the fee as a number', async () => {
    setState({ data: data() });
    renderPage();
    await openOrders();
    const zones = cardFor(`${KEY}.catalogs.zones.title`);

    // "Zona 10" carries both extras — a configured fee must come back as a number, never as the
    // "not configured" null.
    await userEvent.click(within(zones).getAllByRole('button', { name: `${KEY}.actions.editRow` })[0]!);
    expect(within(zones).getByLabelText(`${KEY}.rowForm.fee`)).toHaveValue('50');
    expect(within(zones).getByLabelText(`${KEY}.rowForm.municipality`)).toHaveValue('4');

    await userEvent.clear(within(zones).getByLabelText(`${KEY}.rowForm.fee`));
    await userEvent.type(within(zones).getByLabelText(`${KEY}.rowForm.fee`), '75.50');
    await userEvent.click(within(zones).getByRole('button', { name: `${KEY}.rowForm.save` }));
    expect(updateRow.mock.calls[0]?.[0]).toEqual({
      id: 6,
      body: { name: 'Zona 10', isActive: true, municipalityId: 4, deliveryFee: 75.5 },
    });
  });

  it('rejects an over-long note, and the add editor can be dismissed', async () => {
    setState({ data: data() });
    renderPage();
    await openOrders();
    const card = cardFor(`${KEY}.catalogs.contactTypes.title`);

    await userEvent.click(within(card).getByRole('button', { name: `${KEY}.actions.add` }));
    await userEvent.type(within(card).getByLabelText(`${KEY}.rowForm.name`), 'Telegram');
    // `paste` rather than `type`: 501 keystrokes is a needlessly slow way to make the same point.
    await userEvent.click(within(card).getByLabelText(`${KEY}.rowForm.description`));
    await userEvent.paste('x'.repeat(501));
    await userEvent.click(within(card).getByRole('button', { name: `${KEY}.rowForm.save` }));
    expect(await screen.findByText(`${KEY}.rowForm.descriptionError`)).toBeInTheDocument();
    expect(createRow).not.toHaveBeenCalled();

    await userEvent.click(within(card).getByRole('button', { name: `${KEY}.rowForm.cancel` }));
    await waitFor(() =>
      expect(within(card).queryByLabelText(`${KEY}.rowForm.name`)).not.toBeInTheDocument(),
    );
  });

  it('falls back to a generic message when a failed save carries neither shape', async () => {
    toFormError.mockReturnValue({});
    setState({ data: data() });
    renderPage();
    await openOrders();
    const card = cardFor(`${KEY}.catalogs.contactTypes.title`);
    await userEvent.click(within(card).getByRole('button', { name: `${KEY}.actions.add` }));
    await userEvent.type(within(card).getByLabelText(`${KEY}.rowForm.name`), 'Telegram');
    await userEvent.click(within(card).getByRole('button', { name: `${KEY}.rowForm.save` }));
    createRow.mock.calls[0]?.[1].onError(new Error('boom'));
    expect(notify.error).toHaveBeenCalledWith(`${KEY}.errors.saveFallback`);
  });

  it('grows a newly-arrived row open instead of letting the list jump', async () => {
    setState({ data: data() });
    const { rerender } = renderPage();
    await openOrders();

    const grown = data();
    grown.catalogs.contactTypes = [
      ...grown.catalogs.contactTypes,
      { id: 9, name: 'Telegram', isActive: true, isReferenced: false },
    ];
    setState({ data: grown });
    rerender(<PreferencesPage />);

    // The list is a morph region: the card's height eases and the arrival fades up inside it, so the
    // rows around it never jump.
    expect(screen.getByText('Telegram')).toBeInTheDocument();
  });
});

describe('PreferenceCatalogCard deletion', () => {
  it('DISABLES delete on the last active row of a catalog the forms need', async () => {
    setState({
      data: data({
        catalogs: {
          ...data().catalogs,
          // One active row left, and the order form cannot be filled without an event type.
          eventTypes: [{ id: 1, name: 'Solo uno', isActive: true, isReferenced: false }],
        },
      }),
    });
    renderPage();
    const card = await openOrders();
    // Explaining up front beats letting the click return a 409.
    expect(within(card).getByRole('button', { name: `${KEY}.actions.deleteRow` })).toBeDisabled();
    // An OPTIONAL catalog has no such floor — zero payment methods is a valid configuration.
    const methods = cardFor(`${KEY}.catalogs.paymentMethods.title`);
    expect(within(methods).getByRole('button', { name: `${KEY}.actions.deleteRow` })).toBeEnabled();
  });

  it('keeps the row on screen until the server CONFIRMS, then removes it', async () => {
    setState({ data: data() });
    renderPage();
    await openOrders();
    const card = cardFor(`${KEY}.catalogs.paymentMethods.title`);

    await userEvent.click(within(card).getByRole('button', { name: `${KEY}.actions.deleteRow` }));
    // Nothing uses it, so the dialog commits to removal instead of listing both possibilities.
    expect(screen.getByText(`${KEY}.deleteRow.remove.note`)).toBeInTheDocument();
    expect(screen.getByText(`${KEY}.deleteRow.remove.title`)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: `${KEY}.deleteRow.remove.confirm` }));
    await waitFor(() => expect(deleteRow).toHaveBeenCalledWith(1, expect.anything()));
    // NOTHING has happened to the row yet — the request can still fail, and a row shown as gone while
    // that is true is a guess dressed up as a result.
    expect(editorSlotOut).not.toHaveBeenCalled();
    expect(commitDeletion).not.toHaveBeenCalled();
    expect(within(card).getByText('Efectivo')).toBeInTheDocument();

    deleteRow.mock.calls[0]?.[1].onSuccess({ data: { data: { outcome: 'deleted' } } });
    expect(notify.success).toHaveBeenCalledWith(`${KEY}.toasts.deleted`);
    // Confirmed: the row fades where it stands, and only once it is gone does the list drop it.
    expect(editorSlotOut).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(commitDeletion).toHaveBeenCalledWith(1, 'deleted'));
  });

  it('never animates away a row that was only HIDDEN — it is still in the list', async () => {
    setState({ data: data() });
    renderPage();
    await openOrders();
    const zones = cardFor(`${KEY}.catalogs.zones.title`);

    // "Zona 10" is referenced, so the whole dialog talks about hiding — title, note and button.
    await userEvent.click(
      within(zones).getAllByRole('button', { name: `${KEY}.actions.deleteRow` })[0]!,
    );
    expect(screen.getByText(`${KEY}.deleteRow.hide.title`)).toBeInTheDocument();
    expect(screen.getByText(`${KEY}.deleteRow.hide.note`)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: `${KEY}.deleteRow.hide.confirm` }));
    await waitFor(() => expect(deleteRow).toHaveBeenCalledWith(6, expect.anything()));

    deleteRow.mock.calls[0]?.[1].onSuccess({ data: { data: { outcome: 'deactivated' } } });
    expect(notify.success).toHaveBeenCalledWith(`${KEY}.toasts.deactivated`);
    // It re-sorts to the bottom with its "inactive" badge instead of leaving.
    expect(editorSlotOut).not.toHaveBeenCalled();
    expect(commitDeletion).toHaveBeenCalledWith(6, 'deactivated');
  });

  it('follows the SERVER, not the preview, when the two disagree', async () => {
    setState({ data: data() });
    renderPage();
    await openOrders();
    const card = cardFor(`${KEY}.catalogs.paymentMethods.title`);

    // The dialog promised removal (nothing referenced it when the screen loaded), but by the time the
    // request landed something did. Because nothing was animated up front, there is no wrong state to
    // undo — the row simply stays, unpublished.
    await userEvent.click(within(card).getByRole('button', { name: `${KEY}.actions.deleteRow` }));
    await userEvent.click(screen.getByRole('button', { name: `${KEY}.deleteRow.remove.confirm` }));
    await waitFor(() => expect(deleteRow).toHaveBeenCalled());

    deleteRow.mock.calls[0]?.[1].onSuccess({ data: { data: { outcome: 'deactivated' } } });
    expect(editorSlotOut).not.toHaveBeenCalled();
    expect(commitDeletion).toHaveBeenCalledWith(1, 'deactivated');
    expect(notify.success).toHaveBeenCalledWith(`${KEY}.toasts.deactivated`);
  });

  it('dismissing the dialog changes nothing', async () => {
    setState({ data: data() });
    renderPage();
    await openOrders();
    const card = cardFor(`${KEY}.catalogs.paymentMethods.title`);

    await userEvent.click(within(card).getByRole('button', { name: `${KEY}.actions.deleteRow` }));
    await userEvent.click(screen.getByRole('button', { name: `${KEY}.deleteRow.dismiss` }));
    expect(deleteRow).not.toHaveBeenCalled();
    expect(editorSlotOut).not.toHaveBeenCalled();
  });

  it('leaves the list untouched when the delete FAILS — nothing had moved', async () => {
    toFormError.mockReturnValue({ inline: 'está en uso' });
    setState({ data: data() });
    renderPage();
    await openOrders();
    const card = cardFor(`${KEY}.catalogs.paymentMethods.title`);

    await userEvent.click(within(card).getByRole('button', { name: `${KEY}.actions.deleteRow` }));
    await userEvent.click(screen.getByRole('button', { name: `${KEY}.deleteRow.remove.confirm` }));
    await waitFor(() => expect(deleteRow).toHaveBeenCalled());
    deleteRow.mock.calls[0]?.[1].onError(new Error('boom'));

    expect(notify.error).toHaveBeenCalledWith('está en uso');
    // No restore step exists any more, because there is nothing to restore.
    expect(editorSlotOut).not.toHaveBeenCalled();
    expect(commitDeletion).not.toHaveBeenCalled();
    expect(within(card).getByText('Efectivo')).toBeInTheDocument();
  });
});
