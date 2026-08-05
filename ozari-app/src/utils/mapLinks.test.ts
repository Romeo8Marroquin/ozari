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
  it('is the pin, carrying the address as its human LABEL', () => {
    expect(orderDestination('Zona 10, 4a avenida', COORDS)).toEqual({
      kind: 'coords',
      coords: COORDS,
      label: 'Zona 10, 4a avenida',
    });
  });

  it('still returns the pin when there is no address to label it with', () => {
    expect(orderDestination(undefined, COORDS)).toEqual({ kind: 'coords', coords: COORDS });
  });

  it('is NOTHING without a pin — an address text is not a destination (owner rule 2026-08-04)', () => {
    // A walk-in address ("Test dirección", "Salón del club, entrada norte") is not reliably
    // geocodable, so searching it opens a maps app somewhere unrelated while looking exactly as
    // trustworthy as a real pin. Offering the button only when we can actually navigate makes its
    // presence itself the information.
    expect(orderDestination('Zona 10, 4a avenida', undefined)).toBeUndefined();
    expect(orderDestination(undefined, undefined)).toBeUndefined();
    expect(orderDestination('   ', undefined)).toBeUndefined();
  });
});
