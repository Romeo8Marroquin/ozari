import { lazy, Suspense, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { HiOutlineMapPin, HiOutlineTrash } from 'react-icons/hi2';
import Button from '@components/Button';
import { formatCoords, type Coords } from '@utils/geo';

/**
 * The picker — and with it Leaflet and its CSS — is loaded ONLY when someone opens it. Most orders
 * never get a pin, and every order form has this field (the registry modal has one per address), so
 * a static import would put a mapping library in the bundle of every admin who never taps it.
 */
const LocationPicker = lazy(() => import('@components/LocationPicker'));

const KEY = 'components.locationField';

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

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-charcoal/55">{t(`${KEY}.label`)}</p>
        <p className={`truncate text-sm ${value ? 'tabular-nums text-charcoal' : 'text-charcoal/45'}`}>
          {value ? formatCoords(value) : t(`${KEY}.empty`)}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          startIcon={<HiOutlineMapPin aria-hidden />}
          onClick={() => setPickerOpen(true)}
          data-testid={`${id}-open`}
        >
          {value ? t(`${KEY}.change`) : t(`${KEY}.set`)}
        </Button>
        {/* Removing a pin must be as easy as setting one — an address that got the wrong pin is
            worse off than one with none, and re-picking is not a fix if the venue moved. */}
        {value && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onChange(undefined)}
            aria-label={t(`${KEY}.clear`)}
            title={t(`${KEY}.clear`)}
            data-testid={`${id}-clear`}
          >
            <HiOutlineTrash aria-hidden />
          </Button>
        )}
      </div>

      {/* Mounted only while open, so the chunk is fetched on the first tap and the dialog's own
          state starts fresh each time. */}
      {pickerOpen && (
        <Suspense fallback={null}>
          <LocationPicker
            open
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
