import { describe, expect, it } from 'vitest';
import { activeOrdersView, parseOrdersSearch, toApiView } from './ordersSearch';

describe('parseOrdersSearch', () => {
  it('keeps only the exact historial marker', () => {
    expect(parseOrdersSearch({ view: 'historial' })).toEqual({ view: 'historial' });
  });

  it('clamps everything else to the default agenda (an empty search)', () => {
    expect(parseOrdersSearch({})).toEqual({});
    expect(parseOrdersSearch({ view: 'agenda' })).toEqual({});
    expect(parseOrdersSearch({ view: 'HISTORIAL' })).toEqual({});
    expect(parseOrdersSearch({ view: 3 })).toEqual({});
    expect(parseOrdersSearch({ other: 'x' })).toEqual({});
  });
});

describe('activeOrdersView', () => {
  it('resolves the view with agenda as the default', () => {
    expect(activeOrdersView({})).toBe('agenda');
    expect(activeOrdersView({ view: 'historial' })).toBe('historial');
  });
});

describe('toApiView', () => {
  it('translates the Spanish URL views to the backend vocabulary', () => {
    expect(toApiView('agenda')).toBe('agenda');
    expect(toApiView('historial')).toBe('history');
  });
});
