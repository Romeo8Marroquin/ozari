import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { HiMapPin, HiOutlineMapPin, HiOutlineMagnifyingGlass } from 'react-icons/hi2';
import 'leaflet/dist/leaflet.css';
import AnimatedMessage from '@components/AnimatedMessage';
import Button from '@components/Button';
import Modal from '@components/Modal';
import CustomInput from '@components/CustomInput';
import OverlayScrollbar from '@components/OverlayScrollbar';
import { formatCoords, isShortMapsLink, parseCoordsInput, roundCoords, type Coords } from '@utils/geo';
import {
  SEARCH_DEBOUNCE_MS,
  SEARCH_MIN_LENGTH,
  searchPlaces,
  type PlaceResult,
} from '@utils/geocode';
import { createLeafletMap, type LeafletMapHandle } from './leafletMap';

const KEY = 'components.locationPicker';
/** The app's charcoal for secondary actions — the same one Settings and the registry modal use, so
 *  these read as OUR buttons rather than as a widget's own controls. */
const SECONDARY_COLOR = '#262626';

/**
 * Nominatim returns ONE comma-joined string ("Panadería D'Obrero, 30 Calle, Barrio San Pedro, Zona
 * 5, …, Guatemala"). The first segment is the place; everything after it is context. Splitting them
 * turns a wall of five near-identical paragraphs into a scannable list — the name is what you
 * recognise, the rest is what disambiguates it.
 */
const primaryLabel = (label: string): string => {
  const comma = label.indexOf(',');
  // A single-name place ("Cayalá") has no context to split off — it is all primary.
  return (comma === -1 ? label : label.slice(0, comma)).trim();
};
const secondaryLabel = (label: string): string => {
  const comma = label.indexOf(',');
  return comma === -1 ? '' : label.slice(comma + 1).trim();
};

interface LocationPickerProps {
  open: boolean;
  onClose: () => void;
  /** The pin to open on, when the address already has one. */
  value?: Coords | undefined;
  /** Prefills the search box the first time it opens — the address text the admin already typed,
   *  so the common path is "open, tap the right result, save" with nothing to type twice. */
  initialQuery?: string | undefined;
  onConfirm: (coords: Coords) => void;
}

/**
 * THE LOCATION PICKER — a map, a search box, and a manual entry, in a dialog.
 *
 * Three ways in, because the fastest one depends on where the admin is standing:
 * - **Search** (Nominatim) for "the venue has a name / I know the street".
 * - **Pan the map** for "I know where it is, roughly, and I'll point at it" — the centre pin means
 *   the map moves and the pin stays put (see `leafletMap.ts` for why that beats a draggable marker).
 * - **Paste** a Google/Waze/Apple link or raw coordinates, for when someone is already standing at
 *   the venue with a phone and hits "share".
 *
 * The pin is ALWAYS optional: the dialog can be dismissed without choosing, and the caller keeps
 * whatever it had. Nothing here may ever become a required step in creating an order.
 */
const LocationPicker: React.FC<LocationPickerProps> = ({
  open,
  onClose,
  value,
  initialQuery,
  onConfirm,
}) => {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMapHandle | null>(null);
  const resultsScroller = useRef<HTMLUListElement>(null);
  /**
   * Has the map drawn ITS FIRST tiles? Only that moment matters.
   *
   * Leaflet re-fires `loading` on every pan and zoom, so a veil bound to "tiles in flight" would
   * flash on every gesture — and worse, `load` does not always follow (a move served entirely from
   * cache raises no completion), which left the state stuck at "loading" forever. Anything hidden
   * behind it then never came back: that is what made the pin vanish the moment you panned.
   *
   * So this latches ONCE and never flips back, and nothing but the first-paint skeleton depends on
   * it. The pin belongs to us, not to the network — it is always visible.
   */
  const [mapReady, setMapReady] = useState(false);
  // What the pin is pointing at RIGHT NOW — driven by the map's own `move` events, so the readout
  // tracks the finger rather than snapping when the gesture ends.
  const [center, setCenter] = useState<Coords | undefined>(value);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [searching, setSearching] = useState(false);
  /** A real search has COMPLETED for the current text — the only state in which an empty list is
   *  news worth telling the user about, rather than "you haven't typed enough yet". */
  const [searched, setSearched] = useState(false);
  const [manual, setManual] = useState('');
  const [manualError, setManualError] = useState<string | undefined>(undefined);

  /** Is there anything to show under the search box? Drives the region's collapse. */
  const hasResultsRegion = results.length > 0 || (!searching && searched);

  // Mount the map only while the dialog is open: Leaflet measures its container on creation, and a
  // hidden one measures as zero — which is the classic "grey tiles until you resize" bug.
  useEffect(() => {
    if (!open || !containerRef.current) return undefined;
    const handle = createLeafletMap(containerRef.current, {
      center: value,
      onMove: (coords) => setCenter(roundCoords(coords)),
      // Only ever used to latch "the first tiles arrived"; later loads are ignored on purpose.
      onLoadingChange: (loading) => {
        if (!loading) setMapReady(true);
      },
    });
    mapRef.current = handle;
    setCenter(value ?? handle.center());
    // The modal animates open, so the box Leaflet just measured is not its final one. Re-measure on
    // the next frame, once the entrance has settled the layout.
    const frame = requestAnimationFrame(() => handle.invalidate());
    return () => {
      cancelAnimationFrame(frame);
      handle.destroy();
      mapRef.current = null;
    };
  }, [open, value]);

  // Reset the transient state every time it OPENS, so a previous session's search results and
  // paste error never greet the next address. Adjust-state-during-render (React's documented
  // alternative to a reset effect, and what the preferences cards already use) rather than an
  // effect: resetting in an effect renders the stale values once first, and cascading setState in
  // an effect body is what the compiler lint forbids.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setQuery(initialQuery ?? '');
      setResults([]);
      setSearched(false);
      setManual('');
      setManualError(undefined);
    }
  }

  // Debounced search, aborting the superseded request — Nominatim's policy is 1 req/s, and a fast
  // typist must produce one request, not one per keystroke.
  useEffect(() => {
    if (!open) return undefined;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      // Too short to mean anything: clear the list without claiming we looked.
      if (query.trim().length < SEARCH_MIN_LENGTH) {
        setResults([]);
        setSearched(false);
        return;
      }
      setSearching(true);
      void searchPlaces(query, controller.signal)
        .then((found) => {
          setResults(found);
          setSearched(true);
        })
        .finally(() => setSearching(false));
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [open, query]);

  const goTo = useCallback((coords: Coords) => {
    mapRef.current?.panTo(coords);
    setCenter(coords);
  }, []);

  const useMyLocation = useCallback(() => {
    navigator.geolocation?.getCurrentPosition((position) => {
      goTo(roundCoords({ lat: position.coords.latitude, lng: position.coords.longitude }));
    });
  }, [goTo]);

  const applyManual = useCallback(() => {
    const parsed = parseCoordsInput(manual);
    if (parsed) {
      setManualError(undefined);
      goTo(parsed);
      return;
    }
    // A shortened link carries no coordinates at all until a server follows the redirect, so say
    // THAT — "no pude leer eso" would send the admin hunting for a typo that isn't there.
    setManualError(isShortMapsLink(manual) ? t(`${KEY}.manualShortLink`) : t(`${KEY}.manualInvalid`));
  }, [manual, goTo, t]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t(`${KEY}.title`)}
      description={t(`${KEY}.description`)}
      size="xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t(`${KEY}.cancel`)}
          </Button>
          <Button
            onClick={() => {
              /* v8 ignore next -- unreachable via the UI: the button is disabled without a centre.
                 Kept so the callback can never fire with `undefined` if that ever changes. */
              if (center) onConfirm(center);
            }}
            disabled={!center}
          >
            {t(`${KEY}.confirm`)}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {/* `modal-stagger` on each block joins the dialog's own sweep — the same in/out language
            every other modal uses. Without it this content just appeared, while its title, footer
            and scrim animated around it. */}
        <div className="modal-stagger">
          <CustomInput
            id="location-search"
            label={t(`${KEY}.searchLabel`)}
            placeholder={t(`${KEY}.searchPlaceholder`)}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            icon={
              searching ? (
                // A spinner IN the field: the search is about this box, so its progress belongs
                // here rather than as a line of text somewhere below. Purely VISUAL — `CustomInput`
                // hides a non-interactive icon from assistive tech (correctly), so the spoken
                // half is the live region below rather than a label nobody would ever hear.
                <span className="block size-4 animate-spin rounded-full border-2 border-charcoal/25 border-t-charcoal/70 motion-reduce:animate-none" />
              ) : (
                <HiOutlineMagnifyingGlass />
              )
            }
            data-modal-autofocus
          />
          {/* Always mounted so the change is announced when it happens — a live region added at the
              same moment as its text is frequently missed by screen readers. */}
          <p className="sr-only" role="status" aria-live="polite" data-testid="search-status">
            {searching ? t(`${KEY}.searching`) : ''}
          </p>
          {/* Says WHAT can be searched and where the answers come from. Without it the box is a
              blank invitation with no clue whether it wants a venue, a street or an address — and
              the results are OpenStreetMap's, which are not the same set Google would return. */}
          <p className="ml-1.5 mt-1 text-xs text-charcoal/50">{t(`${KEY}.searchHint`)}</p>
        </div>

        {/* The results region EASES open and shut instead of appearing, so the map below glides
            rather than jumping as results arrive or clear. The `grid-rows 0fr↔1fr` collapse is the
            app's documented transient-appearance pattern (FormError, CollapsingNote): always
            mounted, pure CSS, and — unlike a GSAP height tween — it never fights the modal's own
            sweep running at the same time. */}
        <div
          className={`modal-stagger grid transition-[grid-template-rows] duration-300 ease-[var(--ease-settle)] motion-reduce:transition-none ${
            hasResultsRegion ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
          }`}
        >
          <div className="overflow-hidden">
            {results.length > 0 && (
              <div className="relative">
              <ul
                ref={resultsScroller}
                className="no-native-scrollbar max-h-40 overflow-y-auto rounded-control border border-charcoal/10 bg-white py-1"
              >
                {results.map((result) => (
                  <li key={result.id} data-flip-id={result.id}>
                    {/* Hover is ASYMMETRIC, per the app's motion rule: quick and decisive in
                        (150ms), settling out over 300ms on `--ease-settle`. One duration in both
                        directions is what made this feel like a flat on/off switch. */}
                    <button
                      type="button"
                      onClick={() => goTo(result.coords)}
                      className="group flex w-full cursor-pointer items-start gap-2.5 px-3 py-2 text-left transition-[background-color,color] duration-300 ease-[var(--ease-settle)] hover:bg-charcoal/[0.04] hover:duration-150 hover:ease-out focus-visible:bg-charcoal/[0.04] focus-visible:outline-none"
                    >
                      <HiOutlineMapPin
                        aria-hidden
                        className="mt-0.5 size-4 shrink-0 text-charcoal/35 transition-colors duration-300 ease-[var(--ease-settle)] group-hover:text-magenta group-hover:duration-150 group-hover:ease-out"
                      />
                      <span className="min-w-0">
                        {/* Nominatim returns one long comma-joined string; the FIRST part is the
                            place and the rest is context. Splitting them makes a list of five
                            results scannable instead of five paragraphs. */}
                        <span className="block truncate text-sm font-medium text-charcoal">
                          {primaryLabel(result.label)}
                        </span>
                        <span className="block truncate text-xs text-charcoal/50">
                          {secondaryLabel(result.label)}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
                {/* The app has ONE scrollbar; a native bar here would be the only one in the app. */}
                <OverlayScrollbar target={resultsScroller} />
              </div>
            )}
            {/* "Nothing found" must be said out loud: silence after typing reads as a broken
                search, which is exactly how the blocked-by-CSP bug presented. */}
            {!searching && searched && results.length === 0 && (
              <p className="text-xs text-charcoal/50">{t(`${KEY}.noResults`)}</p>
            )}
          </div>
        </div>

        <div className="modal-stagger">
          <div className="relative">
            {/* h-[45dvh] on phones, a fixed comfortable height once there's room: the map must be the
                biggest thing in the dialog on a small screen without pushing the actions off it. */}
            <div
              ref={containerRef}
              className="h-[45dvh] w-full overflow-hidden rounded-control border border-charcoal/10 bg-charcoal/[0.04] sm:h-80"
              data-testid="location-picker-map"
            />

            {/* Tiles still arriving — a SKELETON, deliberately nothing like a pin: a shimmering
                surface with the spinner off to one side. A spinner sitting exactly where the pin
                belongs read as "the pin is loading", which it never was (the pin is ours, the tiles
                are the network's). Fades out rather than cutting, so a fast connection reads as one
                smooth reveal instead of a flicker. */}
            <div
              aria-hidden={mapReady}
              className={`pointer-events-none absolute inset-0 overflow-hidden rounded-control bg-charcoal/[0.05] transition-opacity duration-300 ease-[var(--ease-settle)] ${
                mapReady ? 'opacity-0' : 'opacity-100'
              }`}
            >
              <span className="absolute inset-0 animate-pulse bg-charcoal/[0.04] motion-reduce:animate-none" />
              <span
                role="status"
                aria-label={t(`${KEY}.loadingMap`)}
                className="absolute left-3 top-3 size-5 animate-spin rounded-full border-2 border-charcoal/20 border-t-charcoal/60 motion-reduce:animate-none"
              />
            </div>

            {/* The OSM credit, IN the map's corner — where every map puts it, and where it stops
                being a line of our dialog's layout. It is required by the data's licence (ODbL), so
                it is small and quiet but never invisible: white-on-white would not be attribution,
                it would just be a licence breach that is harder to notice. Bottom-LEFT because the
                zoom controls own the bottom-right. */}
            <a
              href="https://www.openstreetmap.org/copyright"
              target="_blank"
              rel="noreferrer"
              className="absolute bottom-1.5 left-1.5 z-[400] rounded-chip bg-white/75 px-1.5 py-0.5 text-[10px] leading-none text-charcoal/45 backdrop-blur-[2px] transition-colors duration-300 ease-[var(--ease-settle)] hover:text-charcoal/75 hover:duration-150"
            >
              {t(`${KEY}.attribution`)}
            </a>

            {/* THE PIN — the whole dialog's answer to "which point am I saving?".
                · `pointer-events-none` is load-bearing: it must never swallow the drag beneath it.
                · The pin is SOLID and sized so it reads instantly over dense street tiles; the
                  outline version at 32px disappeared into the map (2026-08-03).
                · Its TIP sits exactly on the centre, and a small dot marks that pixel underneath —
                  a pin alone leaves you guessing whether the point is the tip or the middle. */}
            {/* ALWAYS visible. It was briefly tied to the tile-loading state, which is how it
                disappeared the moment you panned (see `mapReady`): the pin is the dialog's whole
                answer to "which point am I saving?", so nothing about the network may hide it. */}
            <div className="pointer-events-none absolute inset-0 z-[500]" data-testid="location-pin">
              <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-full pb-1">
                {/* A white outline UNDER the glyph (stacked drop-shadows) so the pin keeps its edge
                    over dark satellite-ish tiles, park green and white streets alike — a plain
                    shadow alone let it sink into busy blocks. */}
                <HiMapPin
                  aria-hidden
                  className="size-9 text-magenta [filter:drop-shadow(0_0_1px_white)_drop-shadow(0_0_1px_white)_drop-shadow(0_2px_3px_rgba(0,0,0,0.4))]"
                />
              </div>
              {/* The exact pixel the dialog will save: a magenta dot ringed in white. The pin says
                  "a point is here"; this says WHICH one — without it the anchor could be read as
                  the glyph's middle rather than its tip. */}
              <div className="absolute left-1/2 top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-magenta shadow-[0_0_2px_rgba(0,0,0,0.45)]" />
            </div>
          </div>

        </div>

        {/* The readout + "my location" share a row: the coordinates say where the pin IS, and the
            button is the one-tap way to put it where you are standing. */}
        <div className="modal-stagger flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs tabular-nums text-charcoal/55">
            {center ? formatCoords(center) : t(`${KEY}.noPin`)}
          </p>
          <Button
            variant="soft"
            color={SECONDARY_COLOR}
            size="sm"
            startIcon={<HiOutlineMapPin className="size-3.5" />}
            onClick={useMyLocation}
            className="ml-auto"
          >
            {t(`${KEY}.myLocation`)}
          </Button>
        </div>

        <div className="modal-stagger">
          <div className="flex items-end gap-2">
            <div className="min-w-0 flex-1">
              <CustomInput
                id="location-manual"
                label={t(`${KEY}.manualLabel`)}
                value={manual}
                onChange={(event) => {
                  setManual(event.target.value);
                  setManualError(undefined);
                }}
                error={Boolean(manualError)}
              />
            </div>
            <Button
              variant="soft"
              color={SECONDARY_COLOR}
              size="sm"
              onClick={applyManual}
              disabled={manual.trim() === ''}
            >
              {t(`${KEY}.manualApply`)}
            </Button>
          </div>
          {/* Same gentle inline language as every other field error in the app. */}
          <AnimatedMessage id="location-manual-error" errorMessage={manualError} />
        </div>
      </div>
    </Modal>
  );
};

export default LocationPicker;
