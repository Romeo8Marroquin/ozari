import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { HiOutlineMap } from 'react-icons/hi2';
import Button from '@components/Button';
import MapsAppIcon from '@components/MapsAppIcon';
import Modal from '@components/Modal';
import { buildMapsUrl, MAPS_APPS, type MapsApp, type MapsDestination } from '@utils/mapLinks';
import { getMapsAppPreference, setMapsAppPreference } from '@utils/mapsPreference';

const KEY = 'components.openInMaps';
/** The panel's charcoal for secondary actions — same as every other button in the action row. */
const SECONDARY_COLOR = '#262626';

interface OpenInMapsButtonProps {
  /** Where to navigate. The caller renders NOTHING when the order has no PIN — see `orderDestination`. */
  destination: MapsDestination;
  /** Must match whatever it sits next to: a row of two buttons at different heights reads as a
   *  mistake, not as a hierarchy. `xs` in a card's summary row, `sm` beside a page action. */
  size?: 'xs' | 'sm' | 'md';
  /** Drops the label, keeping the mark alone. For scannable cards, where the one full label belongs
   *  to the step that moves the job forward — the name still reaches assistive tech via the
   *  `aria-label`, and hovering shows it as a tooltip. */
  iconOnly?: boolean;
}

/**
 * "Abrir mapa" — hands the destination to the driver's own maps app.
 *
 * The behaviour is the DEVICE preference (`mapsPreference`): once someone has chosen Waze, the
 * button is one tap forever after — and it then **wears that app's own mark and name**, so the
 * driver sees where the tap is going before making it. Until a choice exists it shows a neutral map
 * icon and asks, because guessing would mean opening an app that may not be installed, which fails
 * in the most confusing way possible: a blank tab.
 *
 * The chooser doubles as the place to make the choice permanent, so a driver never has to find
 * Settings to stop being asked: the checkbox is right where the annoyance is.
 */
const OpenInMapsButton: React.FC<OpenInMapsButtonProps> = ({
  destination,
  size = 'sm',
  iconOnly = false,
}) => {
  const { t } = useTranslation();
  const [chooserOpen, setChooserOpen] = useState(false);
  const [remember, setRemember] = useState(true);
  // Read at RENDER, so the button re-labels itself as soon as a choice is made in the dialog below
  // (the dialog closes, this re-renders, and the next tap is one step).
  const preference = getMapsAppPreference();
  const chosen = preference === 'ask' ? undefined : preference;
  // The label is always COMPUTED, even when it isn't drawn: `iconOnly` hides it visually but it
  // still names the button for assistive tech and as a hover tooltip.
  const label = chosen
    ? t(`${KEY}.openWith`, { app: t(`${KEY}.apps.${chosen}`) })
    : t(`${KEY}.action`);

  const open = (app: MapsApp): void => {
    // `noopener` is required with `_blank`: without it the opened tab gets a handle back to this
    // window. `_blank` (not a same-tab navigation) so the order stays exactly where the driver
    // left it when they come back from navigating.
    window.open(buildMapsUrl(app, destination), '_blank', 'noopener,noreferrer');
  };

  const openWith = (app: MapsApp): void => {
    if (remember) setMapsAppPreference(app);
    open(app);
    setChooserOpen(false);
  };

  return (
    <>
      <Button
        type="button"
        variant="soft"
        color={SECONDARY_COLOR}
        size={size}
        startIcon={
          chosen ? (
            <MapsAppIcon app={chosen} className="size-4 rounded-[3px]" />
          ) : (
            <HiOutlineMap aria-hidden className="size-4" />
          )
        }
        onClick={() => (chosen ? open(chosen) : setChooserOpen(true))}
        data-testid="open-in-maps"
        aria-label={label}
        title={label}
      >
        {iconOnly ? null : label}
      </Button>

      <Modal
        open={chooserOpen}
        onClose={() => setChooserOpen(false)}
        title={t(`${KEY}.chooseTitle`)}
        description={t(`${KEY}.chooseDescription`)}
        size="sm"
      >
        {/* `gap-2.5` is the point: the rows are tinted surfaces, so with no gap they read as one
            block with dividers rather than three choices. Each is its own `.modal-stagger` element,
            so they arrive in the dialog's budget-capped wave instead of cross-fading as a slab. */}
        <div className="flex flex-col gap-2.5">
          {MAPS_APPS.map((app) => (
            <div key={app} className="modal-stagger">
              <button
                type="button"
                onClick={() => openWith(app)}
              // A brand row, not a generic button: the mark leads, the name follows, and the whole
              // row is the target. Same hover grammar as every card in the panel (2px lift in
              // quickly, settle out) so it still reads as ours rather than as three foreign chips.
                className="flex w-full cursor-pointer items-center gap-3 rounded-control bg-charcoal/[0.04] px-3.5 py-3 text-left outline-none transition-[translate,background-color,box-shadow] duration-300 ease-[var(--ease-settle)] hover:-translate-y-0.5 hover:bg-charcoal/[0.07] hover:shadow-[0_10px_24px_-18px_rgba(38,38,38,0.6)] hover:duration-150 hover:ease-[cubic-bezier(0.2,0,0,1)] active:translate-y-0 active:duration-75 focus-visible:ring-2 focus-visible:ring-charcoal/30 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
              >
                <MapsAppIcon app={app} className="size-7 shrink-0" />
                <span className="min-w-0 flex-1 truncate text-sm font-semibold text-charcoal">
                  {t(`${KEY}.apps.${app}`)}
                </span>
              </button>
            </div>
          ))}
        </div>

        <div className="modal-stagger mt-5">
          <label className="flex items-center gap-2 text-sm text-charcoal/70">
            <input
              type="checkbox"
              checked={remember}
              onChange={(event) => setRemember(event.target.checked)}
              className="h-4 w-4 accent-magenta"
            />
            {t(`${KEY}.remember`)}
          </label>
          <p className="mt-1 text-xs text-charcoal/50">{t(`${KEY}.rememberHint`)}</p>
        </div>
      </Modal>
    </>
  );
};

export default OpenInMapsButton;
