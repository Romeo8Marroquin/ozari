import { describe, expect, it } from 'vitest';
import {
  activePreferenceTab,
  parsePreferencesSearch,
  preferenceTabSearch,
  PREFERENCE_TABS,
} from './preferencesSearch';

describe('parsePreferencesSearch', () => {
  it('keeps a known group marker', () => {
    expect(parsePreferencesSearch({ grupo: 'pedidos' })).toEqual({ grupo: 'pedidos' });
    expect(parsePreferencesSearch({ grupo: 'productos' })).toEqual({ grupo: 'productos' });
  });

  it('CLAMPS anything else to the default, as an empty search', () => {
    // Clamp-never-reject: a hand-typed URL must land on the screen, not error the route. Empty (not
    // `{ grupo: 'operacion' }`) so the default URL carries no query string at all.
    expect(parsePreferencesSearch({})).toEqual({});
    expect(parsePreferencesSearch({ grupo: 'operacion' })).toEqual({});
    expect(parsePreferencesSearch({ grupo: 'PEDIDOS' })).toEqual({});
    expect(parsePreferencesSearch({ grupo: 3 })).toEqual({});
    expect(parsePreferencesSearch({ other: 'x' })).toEqual({});
  });
});

describe('activePreferenceTab', () => {
  it('maps the url marker back to the internal token', () => {
    expect(activePreferenceTab({})).toBe('operation');
    expect(activePreferenceTab({ grupo: 'pedidos' })).toBe('orders');
    expect(activePreferenceTab({ grupo: 'productos' })).toBe('products');
  });
});

describe('preferenceTabSearch', () => {
  it('round-trips every tab, and the default writes nothing', () => {
    // The pairing is the contract: a tab the URL cannot express would silently reset on reload.
    for (const tab of PREFERENCE_TABS) {
      expect(activePreferenceTab(preferenceTabSearch(tab))).toBe(tab);
    }
    expect(preferenceTabSearch('operation')).toEqual({});
  });
});
