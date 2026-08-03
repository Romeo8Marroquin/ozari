import L from 'leaflet';
import type { Coords } from '@utils/geo';

/**
 * THE LEAFLET GLUE — imperative, DOM-measuring, and deliberately the only file that imports
 * Leaflet. Everything that DECIDES anything (what a paste means, what a pin is worth, which app to
 * open, when a button appears) lives in tested pure modules; this just moves a map around.
 *
 * Coverage-excluded for the same reason as `pageMotion`: Leaflet needs real layout — element sizes,
 * scroll offsets, tile loading — none of which jsdom provides, so a "test" here would only assert
 * that our own mock was called. See `vite.config.ts`.
 *
 * ── Why a CENTRE pin instead of a draggable marker ──────────────────────────────────────────────
 * The pin is a fixed DOM element over the map's centre, and the MAP moves under it. This is the
 * pattern Google/Uber use on mobile, and it is not a style choice: dragging a ~20px marker with a
 * thumb on a phone is genuinely hard, the finger covers exactly the thing being placed, and a
 * mis-drop is silent. Panning has none of those problems, works identically with a mouse, and
 * incidentally sidesteps Leaflet's broken default marker-icon URLs under a bundler.
 */

/** OSM's community tiles: free and key-less, and their usage policy REQUIRES this attribution to
 *  be visible. Never remove it — it is the licence, not decoration. */
const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>';

/** Guatemala City — where this business operates, so an admin with no pin yet starts somewhere
 *  useful instead of in the Atlantic (Leaflet's 0,0 default). */
export const DEFAULT_CENTER: Coords = { lat: 14.634915, lng: -90.506883 };
const DEFAULT_ZOOM = 16;
/** Close enough to read house numbers — what "the map jumped to my search result" should feel like. */
const RESULT_ZOOM = 17;

export interface LeafletMapHandle {
  /** Where the pin currently is: the map's centre, rounded by the caller. */
  center: () => Coords;
  /** Move the camera (a search result, "my location", a pasted pin). */
  panTo: (coords: Coords, zoom?: number) => void;
  /** Re-measure after the container changed size — a modal that just finished animating open has
   *  a different box than the one Leaflet measured on mount, and skipping this leaves grey tiles. */
  invalidate: () => void;
  destroy: () => void;
}

/**
 * Mounts a map into `container` and reports every settled camera move through `onMove` (which is
 * what keeps the caller's coordinate readout live while the user pans).
 */
export function createLeafletMap(
  container: HTMLElement,
  options: { center?: Coords | undefined; onMove: (coords: Coords) => void },
): LeafletMapHandle {
  const map = L.map(container, {
    center: [options.center?.lat ?? DEFAULT_CENTER.lat, options.center?.lng ?? DEFAULT_CENTER.lng],
    zoom: options.center ? RESULT_ZOOM : DEFAULT_ZOOM,
    // The zoom control sits bottom-right in our layout so it never collides with the search field
    // or a phone's back gesture area.
    zoomControl: false,
    attributionControl: true,
  });
  L.tileLayer(TILE_URL, { attribution: TILE_ATTRIBUTION, maxZoom: 19 }).addTo(map);
  L.control.zoom({ position: 'bottomright' }).addTo(map);

  const report = (): void => {
    const { lat, lng } = map.getCenter();
    options.onMove({ lat, lng });
  };
  // `move` fires continuously while panning: the readout tracks the finger instead of snapping
  // after the gesture ends, which is what makes the centre pin feel attached to the map.
  map.on('move', report);

  return {
    center: () => {
      const { lat, lng } = map.getCenter();
      return { lat, lng };
    },
    panTo: (coords, zoom) => {
      map.setView([coords.lat, coords.lng], zoom ?? Math.max(map.getZoom(), RESULT_ZOOM));
    },
    invalidate: () => map.invalidateSize(),
    destroy: () => {
      map.off('move', report);
      map.remove();
    },
  };
}

export { RESULT_ZOOM };
