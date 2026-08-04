import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { HiOutlineMap } from 'react-icons/hi2';
import Button from '@components/Button';
import Modal from '@components/Modal';
import { buildMapsUrl, MAPS_APPS, type MapsApp, type MapsDestination } from '@utils/mapLinks';
import { getMapsAppPreference, setMapsAppPreference } from '@utils/mapsPreference';

const KEY = 'components.openInMaps';
/** The panel's charcoal for secondary actions — same as every other button in the action row. */
const SECONDARY_COLOR = '#262626';

interface OpenInMapsButtonProps {
  /** Where to navigate. The caller resolves pin-or-address (`orderDestination`) and renders NOTHING
   *  when there is neither — opening a maps app on an empty search helps nobody. */
  destination: MapsDestination;
  /** `sm` beside a compact action row, `md` when it stands alone. */
  size?: 'sm' | 'md';
}

/**
 * "Abrir en mapas" — hands the destination to the driver's own maps app.
 *
 * The behaviour is the DEVICE preference (`mapsPreference`): once someone has chosen Waze, the
 * button is one tap forever after. Until then it asks, because guessing would mean opening an app
 * that may not be installed — which fails in the most confusing way possible, a blank tab.
 *
 * The chooser doubles as the place to make the choice permanent, so a driver never has to find
 * Settings to stop being asked: the checkbox is right where the annoyance is.
 */
const OpenInMapsButton: React.FC<OpenInMapsButtonProps> = ({ destination, size = 'sm' }) => {
  const { t } = useTranslation();
  const [chooserOpen, setChooserOpen] = useState(false);
  const [remember, setRemember] = useState(true);

  const openWith = (app: MapsApp): void => {
    if (remember) setMapsAppPreference(app);
    // `noopener` is required with `_blank`: without it the opened tab gets a handle back to this
    // window. `_blank` (not a same-tab navigation) so the order stays exactly where the driver
    // left it when they come back from navigating.
    window.open(buildMapsUrl(app, destination), '_blank', 'noopener,noreferrer');
    setChooserOpen(false);
  };

  const handleClick = (): void => {
    const preference = getMapsAppPreference();
    if (preference === 'ask') {
      setChooserOpen(true);
      return;
    }
    window.open(buildMapsUrl(preference, destination), '_blank', 'noopener,noreferrer');
  };

  return (
    <>
      <Button
        type="button"
        variant="soft"
        color={SECONDARY_COLOR}
        size={size}
        startIcon={<HiOutlineMap aria-hidden className="size-4" />}
        onClick={handleClick}
        data-testid="open-in-maps"
      >
        {t(`${KEY}.action`)}
      </Button>

      <Modal
        open={chooserOpen}
        onClose={() => setChooserOpen(false)}
        title={t(`${KEY}.chooseTitle`)}
        description={t(`${KEY}.chooseDescription`)}
        size="sm"
      >
        <div className="flex flex-col gap-2">
          {MAPS_APPS.map((app) => (
            <Button
              key={app}
              variant="soft"
              color={SECONDARY_COLOR}
              fullWidth
              onClick={() => openWith(app)}
            >
              {t(`${KEY}.apps.${app}`)}
            </Button>
          ))}
          <label className="mt-2 flex items-center gap-2 text-sm text-charcoal/70">
            <input
              type="checkbox"
              checked={remember}
              onChange={(event) => setRemember(event.target.checked)}
              className="h-4 w-4 accent-magenta"
            />
            {t(`${KEY}.remember`)}
          </label>
          <p className="text-xs text-charcoal/50">{t(`${KEY}.rememberHint`)}</p>
        </div>
      </Modal>
    </>
  );
};

export default OpenInMapsButton;
