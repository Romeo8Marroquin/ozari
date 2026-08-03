import { describe, expect, it } from 'vitest';
import { buildMapsUrl, orderDestination } from './mapLinks';

const COORDS = { lat: 14.634915, lng: -90.506883 };

describe('buildMapsUrl', () => {
  it('asks each app to NAVIGATE, not merely to display a point', () => {
    // Someone tapping this is about to drive; dropping the navigate flag would make them tap twice
    // more while holding a phone in a truck.
    expect(buildMapsUrl('google', { kind: 'coords', coords: COORDS })).toBe(
      'https://www.google.com/maps/dir/?api=1&destination=14.634915%2C-90.506883&travelmode=driving',
    );
    expect(buildMapsUrl('waze', { kind: 'coords', coords: COORDS })).toBe(
      'https://waze.com/ul?ll=14.634915%2C-90.506883&navigate=yes',
    );
    expect(buildMapsUrl('apple', { kind: 'coords', coords: COORDS })).toBe(
      'https://maps.apple.com/?daddr=14.634915%2C-90.506883&dirflg=d',
    );
  });

  it('falls back to a SEARCH when the order has only an address text', () => {
    const destination = { kind: 'query' as const, query: 'Zona 10, 4a avenida 5-55' };
    // Waze needs `q` here, not `ll`: handing a raw search string to `ll` silently lands elsewhere.
    expect(buildMapsUrl('waze', destination)).toBe(
      'https://waze.com/ul?q=Zona%2010%2C%204a%20avenida%205-55&navigate=yes',
    );
    expect(buildMapsUrl('google', destination)).toContain('destination=Zona%2010');
    expect(buildMapsUrl('apple', destination)).toContain('daddr=Zona%2010');
  });

  it('always builds https universal links — never a custom scheme', () => {
    // A `waze://` link fails SILENTLY when the app isn't installed, and does nothing at all on a
    // desktop. One https link serves the driver's phone and the admin's laptop alike.
    for (const app of ['google', 'waze', 'apple'] as const) {
      expect(buildMapsUrl(app, { kind: 'coords', coords: COORDS })).toMatch(/^https:\/\//u);
    }
  });
});

describe('orderDestination', () => {
  it('prefers the pin, because it is the unambiguous one', () => {
    expect(orderDestination('Zona 10, 4a avenida', COORDS)).toEqual({
      kind: 'coords',
      coords: COORDS,
      label: 'Zona 10, 4a avenida',
    });
  });

  it('uses the address text when there is no pin — the normal case', () => {
    expect(orderDestination('Zona 10, 4a avenida', undefined)).toEqual({
      kind: 'query',
      query: 'Zona 10, 4a avenida',
    });
  });

  it('returns nothing when there is neither, so no button is offered', () => {
    // Opening a maps app on an empty search is worse than not offering the action at all.
    expect(orderDestination(undefined, undefined)).toBeUndefined();
    expect(orderDestination('   ', undefined)).toBeUndefined();
  });
});
