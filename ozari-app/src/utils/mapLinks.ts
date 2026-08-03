import type { Coords } from './geo';

/**
 * NAVIGATION IS ALWAYS SOMEBODY ELSE'S APP.
 *
 * We never build turn-by-turn: the driver already has a maps app they trust, with their own traffic
 * data, voice and offline tiles. Our job is to hand it the destination and get out of the way.
 *
 * Every link here is a plain `https://` universal link on purpose — no `geo:`/`waze://` schemes.
 * A universal link opens the installed app on Android and iOS AND degrades to the website on a
 * desktop, so ONE code path serves the driver on a phone and the admin checking an address from a
 * laptop. Custom schemes do neither when the app isn't installed: they fail silently, which is the
 * worst outcome for someone standing in a truck.
 */
export const MAPS_APPS = ['google', 'waze', 'apple'] as const;
export type MapsApp = (typeof MAPS_APPS)[number];

/** What the user picked in Settings. `ask` = no default yet; the button offers the choice. */
export type MapsAppPreference = MapsApp | 'ask';

/**
 * Where we're sending them. A pin when the order has one, otherwise the address TEXT — which is the
 * whole reason this takes a union: most walk-in orders will never have a pin, and "open in maps"
 * must still work for them by handing the app a search query.
 */
export type MapsDestination =
  | { kind: 'coords'; coords: Coords; label?: string | undefined }
  | { kind: 'query'; query: string };

const encode = (value: string): string => encodeURIComponent(value);

/** The raw `lat,lng` when this destination is a pin, else `undefined`. */
const coordsOf = (destination: MapsDestination): string | undefined =>
  destination.kind === 'coords'
    ? `${destination.coords.lat},${destination.coords.lng}`
    : undefined;

/** What each app is pointed at: the pin when there is one, otherwise the search text. The union is
 *  exhaustive, so there is no third state to defend against with an unreachable fallback. */
const targetOf = (destination: MapsDestination): string =>
  destination.kind === 'coords'
    ? `${destination.coords.lat},${destination.coords.lng}`
    : destination.query;

/**
 * The deep link for one app and one destination.
 *
 * Each is the vendor's DOCUMENTED navigation entry point, and each is asked to start navigating
 * rather than just to display a point — a driver tapping this is about to drive, not browse:
 * - Google: the Maps URLs API `dir/?api=1&destination=…&travelmode=driving`.
 * - Waze: `waze.com/ul?…&navigate=yes` (its universal link).
 * - Apple: `maps.apple.com/?daddr=…&dirflg=d` (`daddr` = destination address).
 */
export function buildMapsUrl(app: MapsApp, destination: MapsDestination): string {
  const coords = coordsOf(destination);
  const target = targetOf(destination);
  switch (app) {
    case 'waze':
      // Waze takes `ll` for a raw pin and `q` for a search — mixing them up silently searches for
      // the literal string "14.63,-90.50", which lands somewhere unrelated.
      return coords
        ? `https://waze.com/ul?ll=${encode(coords)}&navigate=yes`
        : `https://waze.com/ul?q=${encode(target)}&navigate=yes`;
    case 'apple':
      return `https://maps.apple.com/?daddr=${encode(target)}&dirflg=d`;
    default:
      return `https://www.google.com/maps/dir/?api=1&destination=${encode(target)}&travelmode=driving`;
  }
}

/**
 * The destination for an order's delivery: its pin when it has one, else its address text.
 * Returns `undefined` only when there is neither — at which point the caller must not render a
 * navigation button at all, rather than opening a maps app on an empty search.
 */
export function orderDestination(
  address: string | undefined,
  coords: Coords | undefined,
): MapsDestination | undefined {
  if (coords) {
    return { kind: 'coords', coords, ...(address !== undefined && { label: address }) };
  }
  const query = address?.trim();
  return query ? { kind: 'query', query } : undefined;
}
