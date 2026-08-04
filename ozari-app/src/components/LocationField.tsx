import { lazy, Suspense, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { HiOutlineMapPin, HiOutlineTrash } from 'react-icons/hi2';
import Button from '@components/Button';
import MorphSwap from '@components/MorphSwap';
import { formatCoords, type Coords } from '@utils/geo';

/**
 * The picker — and with it Leaflet and its CSS — is loaded ONLY when someone opens it. Most orders
 * never get a pin, and every order form has this field (the registry modal has one per address), so
 * a static import would put a mapping library in the bundle of every admin who never taps it.
 */
const LocationPicker = lazy(() => import('@components/LocationPicker'));

const KEY = 'components.locationField';
/** The panel's charcoal for secondary actions — same as Settings and the registry modal. */
const SECONDARY_COLOR = '#262626';

interface LocationFieldProps {
  /** The current pin, or `undefined` when this address has none. */
  value: Coords | undefined;
  onChange: (coords: Coords | undefined) => void;
  /** The address text typed beside it — prefills the picker's search so the common path is
   *  "open, tap the right result, save" with nothing typed twice. */
  addressText?: string | undefined;
  /** Distinguishes the trigger in a list of addresses (test ids + labels). */
  id: string;
}

/**
 * The form control for an OPTIONAL map pin: a line of text plus one button that opens the picker.
 *
 * Deliberately NOT a map embedded in the form. A form with a live map in it invites the admin to
 * fiddle with the map instead of finishing the order, costs a tile fetch on every render of every
 * address row, and on a phone would push the actual fields off the screen. The map appears when it
 * is asked for, and the form stays a form.
 *
 * "Sin ubicación" is a perfectly good final state, and the copy says so rather than nagging.
 */
const LocationField: React.FC<LocationFieldProps> = ({ value, onChange, addressText, id }) => {
  const { t } = useTranslation();
  const [pickerOpen, setPickerOpen] = useState(false);
  /** Latches on the first open: before it the map chunk is never fetched, after it the dialog stays
   *  mounted so closing can animate rather than blink out. */
  const [everOpened, setEverOpened] = useState(false);

  const openPicker = (): void => {
    setEverOpened(true);
    setPickerOpen(true);
  };

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-charcoal/55">{t(`${KEY}.label`)}</p>
        {/* The value ADAPTS instead of being replaced: "Sin ubicación" and a coordinate pair differ
            in both text and width, so a plain React swap reads as a glitch in place. `MorphSwap`
            cross-fades them while the box eases between the two widths — the same treatment the
            agenda ticket gives a status chip that rewrites itself. */}
        <MorphSwap
          swapKey={value ? formatCoords(value) : 'empty'}
          className={`max-w-full text-sm ${value ? 'tabular-nums text-charcoal' : 'text-charcoal/45'}`}
        >
          {value ? formatCoords(value) : t(`${KEY}.empty`)}
        </MorphSwap>
      </div>
      <div className="flex items-center gap-2">
        {/* `soft` + charcoal + an explicitly sized icon: the exact recipe every other secondary
            action in the panel uses (Settings' "Cambiar", the registry modal's "Agregar contacto").
            `Button` does NOT size its own icons — each call site says so. */}
        <Button
          type="button"
          variant="soft"
          color={SECONDARY_COLOR}
          size="sm"
          startIcon={<HiOutlineMapPin className="size-3.5" aria-hidden />}
          onClick={openPicker}
          data-testid={`${id}-open`}
        >
          {value ? t(`${KEY}.change`) : t(`${KEY}.set`)}
        </Button>
        {/* Removing a pin must be as easy as setting one — an address that got the wrong pin is
            worse off than one with none, and re-picking is not a fix if the venue moved. The bare
            icon with a red hover is the same "remove this row" affordance the registry modal uses.

            It is ALWAYS MOUNTED and eases its own column open/shut (`grid-cols 0fr↔1fr`, the
            horizontal twin of the app's collapse pattern), because appearing and disappearing is
            what made it abrupt: the button popped in AND the row's spacing jumped with it. Hidden
            it is inert — no tab stop, nothing announced — so it can't be reached while invisible. */}
        <div
          className={`grid transition-[grid-template-columns,opacity] duration-300 ease-[var(--ease-settle)] motion-reduce:transition-none ${
            value ? 'grid-cols-[1fr] opacity-100' : 'grid-cols-[0fr] opacity-0'
          }`}
        >
          <div className="overflow-hidden">
            <button
              type="button"
              onClick={() => onChange(undefined)}
              aria-label={t(`${KEY}.clear`)}
              title={t(`${KEY}.clear`)}
              data-testid={`${id}-clear`}
              tabIndex={value ? 0 : -1}
              aria-hidden={!value}
              className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-chip text-charcoal/45 transition-[color,background-color] duration-200 hover:bg-red-50 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-magenta"
            >
              <HiOutlineTrash aria-hidden className="size-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Mounted from the FIRST open onward — never before (so the map chunk is still fetched on
          demand), and never torn down after (so `Modal` can play its exit).
          Rendering `{pickerOpen && …}` looked equivalent and was not: closing removed the dialog
          from the tree in the same frame, so the close animation had nothing left to animate and
          the modal simply vanished. A modal owns its own exit; the parent must only stop asking
          for it to be open. */}
      {everOpened && (
        <Suspense fallback={null}>
          <LocationPicker
            open={pickerOpen}
            onClose={() => setPickerOpen(false)}
            value={value}
            initialQuery={addressText}
            onConfirm={(coords) => {
              onChange(coords);
              setPickerOpen(false);
            }}
          />
        </Suspense>
      )}
    </div>
  );
};

export default LocationField;
