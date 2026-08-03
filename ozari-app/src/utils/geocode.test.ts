import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildSearchUrl, searchPlaces, toPlaceResults } from './geocode';

const row = (overrides: Record<string, unknown> = {}) => ({
  place_id: 42,
  display_name: 'Salón El Roble, Zona 10, Ciudad de Guatemala',
  lat: '14.634915',
  lon: '-90.506883',
  ...overrides,
});

describe('buildSearchUrl', () => {
  it('pins the usage-policy parameters', () => {
    const url = new URL(buildSearchUrl('zona 10'));
    expect(url.origin + url.pathname).toBe('https://nominatim.openstreetmap.org/search');
    expect(url.searchParams.get('q')).toBe('zona 10');
    expect(url.searchParams.get('format')).toBe('jsonv2');
    // A bounded result count keeps both the response and the list readable on a phone.
    expect(url.searchParams.get('limit')).toBe('5');
    // Biased to where the business delivers — "zona 10" is otherwise a global query.
    expect(url.searchParams.get('countrycodes')).toBe('gt');
    expect(url.searchParams.get('accept-language')).toBe('es');
  });
});

describe('toPlaceResults', () => {
  it('maps a well-formed payload', () => {
    expect(toPlaceResults([row()])).toEqual([
      {
        id: '42',
        label: 'Salón El Roble, Zona 10, Ciudad de Guatemala',
        coords: { lat: 14.634915, lng: -90.506883 },
      },
    ]);
  });

  it('drops anything that would put a pin NOWHERE', () => {
    // A result we cannot place is worse than one fewer result: it looks like our bug.
    expect(toPlaceResults([row({ lat: 'north' })])).toEqual([]);
    expect(toPlaceResults([row({ lat: '99.9' })])).toEqual([]);
    expect(toPlaceResults([row({ display_name: 42 })])).toEqual([]);
    expect(toPlaceResults([null, 'nope'])).toEqual([]);
    expect(toPlaceResults({ results: [] })).toEqual([]);
  });

  it('falls back to the coordinates as an id when the payload has none', () => {
    const [result] = toPlaceResults([row({ place_id: undefined })]);
    expect(result?.id).toBe('14.634915,-90.506883');
  });
});

describe('searchPlaces', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('never calls the network for a query too short to mean anything', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    await expect(searchPlaces('zo')).resolves.toEqual([]);
    await expect(searchPlaces('   ')).resolves.toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns mapped results on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([row()]) }),
    );
    const results = await searchPlaces('zona 10');
    expect(results[0]?.coords).toEqual({ lat: 14.634915, lng: -90.506883 });
  });

  it('degrades to NO RESULTS on any failure — the dialog keeps working without search', async () => {
    // The map, the centre pin and the manual entry are all still usable; a thrown error here would
    // take the whole dialog down over an optional convenience.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    await expect(searchPlaces('zona 10')).resolves.toEqual([]);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    await expect(searchPlaces('zona 10')).resolves.toEqual([]);
  });

  it('forwards the abort signal so a superseded keystroke cancels its request', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([]) });
    vi.stubGlobal('fetch', fetchSpy);
    const controller = new AbortController();
    await searchPlaces('zona 10', controller.signal);
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('nominatim'),
      expect.objectContaining({ signal: controller.signal }),
    );
  });
});
