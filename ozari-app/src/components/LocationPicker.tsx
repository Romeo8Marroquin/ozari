import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { HiOutlineMapPin, HiOutlineMagnifyingGlass, HiOutlineViewfinderCircle } from 'react-icons/hi2';
import 'leaflet/dist/leaflet.css';
import AnimatedMessage from '@components/AnimatedMessage';
import Button from '@components/Button';
import Modal from '@components/Modal';
import CustomInput from '@components/CustomInput';
import { formatCoords, isShortMapsLink, parseCoordsInput, roundCoords, type Coords } from '@utils/geo';
import { SEARCH_DEBOUNCE_MS, searchPlaces, type PlaceResult } from '@utils/geocode';
import { createLeafletMap, type LeafletMapHandle } from './leafletMap';

const KEY = 'components.locationPicker';

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
  // What the pin is pointing at RIGHT NOW — driven by the map's own `move` events, so the readout
  // tracks the finger rather than snapping when the gesture ends.
  const [center, setCenter] = useState<Coords | undefined>(value);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [manual, setManual] = useState('');
  const [manualError, setManualError] = useState<string | undefined>(undefined);

  // Mount the map only while the dialog is open: Leaflet measures its container on creation, and a
  // hidden one measures as zero — which is the classic "grey tiles until you resize" bug.
  useEffect(() => {
    if (!open || !containerRef.current) return undefined;
    const handle = createLeafletMap(containerRef.current, {
      center: value,
      onMove: (coords) => setCenter(roundCoords(coords)),
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
      setSearching(true);
      void searchPlaces(query, controller.signal)
        .then(setResults)
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
        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <CustomInput
              id="location-search"
              label={t(`${KEY}.searchLabel`)}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              icon={<HiOutlineMagnifyingGlass />}
              data-modal-autofocus
            />
          </div>
          <Button
            variant="outline"
            onClick={useMyLocation}
            aria-label={t(`${KEY}.myLocation`)}
            title={t(`${KEY}.myLocation`)}
          >
            <HiOutlineViewfinderCircle aria-hidden />
          </Button>
        </div>

        {/* Results collapse away entirely when empty — the map is the point, and a permanent empty
            list would eat the map's height on a phone. */}
        {results.length > 0 && (
          <ul className="max-h-32 overflow-y-auto rounded-control border border-charcoal/10">
            {results.map((result) => (
              <li key={result.id}>
                <button
                  type="button"
                  onClick={() => goTo(result.coords)}
                  className="block w-full px-3 py-2 text-left text-sm text-charcoal/80 transition-[background-color,color] duration-150 hover:bg-charcoal/[0.04] hover:text-charcoal focus-visible:bg-charcoal/[0.04] focus-visible:outline-none"
                >
                  {result.label}
                </button>
              </li>
            ))}
          </ul>
        )}
        {searching && results.length === 0 && (
          <p className="text-xs text-charcoal/50">{t(`${KEY}.searching`)}</p>
        )}

        <div className="relative">
          {/* h-[45dvh] on phones, a fixed comfortable height once there's room: the map must be the
              biggest thing in the dialog on a small screen without pushing the actions off it. */}
          <div
            ref={containerRef}
            className="h-[45dvh] w-full overflow-hidden rounded-control border border-charcoal/10 sm:h-80"
            data-testid="location-picker-map"
          />
          {/* The fixed centre pin. `pointer-events-none` is load-bearing — it must never swallow the
              drag that moves the map beneath it. The −100% Y offset puts the TIP at the centre. */}
          <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-full text-magenta drop-shadow">
            <HiOutlineMapPin className="h-8 w-8" aria-hidden />
          </div>
        </div>

        <p className="text-center text-xs tabular-nums text-charcoal/55">
          {center ? formatCoords(center) : t(`${KEY}.noPin`)}
        </p>

        <div>
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
            <Button variant="outline" onClick={applyManual} disabled={manual.trim() === ''}>
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
