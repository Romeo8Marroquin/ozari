/**
 * The three groups of the preferences screen, as URL state.
 *
 * The group lives in the URL for the same reason the orders view does: a reload, a bookmark or a
 * shared link must land on the group the admin was actually working in. The URL speaks Spanish
 * (`?grupo=pedidos`); the internal token stays English because it also keys the i18n leaves.
 */
export type PreferenceTab = 'operation' | 'orders' | 'products';

/** The segmented control's option order (also the tabs' arrow-key order). */
export const PREFERENCE_TABS: readonly PreferenceTab[] = ['operation', 'orders', 'products'];

/** The parsed `/panel/preferencias` search: only a non-default group is ever written to the URL. */
export interface PreferencesSearch {
  grupo?: 'pedidos' | 'productos';
}

/** URL value ↔ internal token, in one place so the two can't drift. */
const TAB_BY_PARAM: Record<string, PreferenceTab> = {
  pedidos: 'orders',
  productos: 'products',
};
const PARAM_BY_TAB: Partial<Record<PreferenceTab, PreferencesSearch['grupo']>> = {
  orders: 'pedidos',
  products: 'productos',
};

/**
 * Clamp-never-reject (the products filters' stance): anything that isn't one of the two markers —
 * absent, misspelled, the default spelled out — parses to the default group, as an EMPTY search
 * object so the default URL stays clean.
 */
export function parsePreferencesSearch(search: Record<string, unknown>): PreferencesSearch {
  const raw = search['grupo'];
  return typeof raw === 'string' && raw in TAB_BY_PARAM
    ? { grupo: raw as PreferencesSearch['grupo'] }
    : {};
}

/** The group a parsed search selects (absent ⇒ the operation settings). */
export function activePreferenceTab(search: PreferencesSearch): PreferenceTab {
  return (search.grupo !== undefined ? TAB_BY_PARAM[search.grupo] : undefined) ?? 'operation';
}

/** The search object that selects a group — empty for the default, so it leaves no query string. */
export function preferenceTabSearch(tab: PreferenceTab): PreferencesSearch {
  const grupo = PARAM_BY_TAB[tab];
  return grupo !== undefined ? { grupo } : {};
}
