import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  HiOutlineArrowPath,
  HiOutlineClipboardDocument,
  HiOutlineLink,
  HiOutlineTrash,
} from 'react-icons/hi2';
import Button from '@components/Button';
import SkeletonFade from '@components/SkeletonFade';
import { notify } from '@components/notifications/notify';
import SettingsSection from './SettingsSection';
import { leadTimeKey, readCalendarOutcome, withoutCalendarOutcome } from './calendarOutcome';
import {
  useCalendar,
  useConnectGoogleCalendar,
  useCreateCalendarFeed,
  useDeleteCalendarFeed,
  useDisconnectGoogleCalendar,
} from './useCalendar';

const KEY = 'modules.panel.settings.calendar';
const SECONDARY_COLOR = '#262626';
const DANGER_COLOR = '#dc2626';
const SKELETON = 'animate-pulse rounded bg-charcoal/10 motion-reduce:animate-none';

/** A settings row: what it is on the left, the controls on the right. Matches the security rows so
 *  the screen reads as one surface rather than a page with a widget bolted on. */
const CalendarRow: React.FC<{
  label: string;
  description: string;
  children: React.ReactNode;
}> = ({ label, description, children }) => (
  <div className="flex flex-col gap-3 py-4 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
    <div className="min-w-0">
      <span className="text-sm font-medium text-charcoal">{label}</span>
      <p className="mt-0.5 text-sm leading-relaxed text-charcoal/55">{description}</p>
    </div>
    <div className="flex shrink-0 flex-wrap items-center gap-2">{children}</div>
  </div>
);

/**
 * CALENDARS — connect Google, or subscribe from anything else.
 *
 * **It lives in Ajustes, not in Preferencias, and the split is the same line those two screens
 * always draw**: a connection is somebody's own Google account and their own device's subscription,
 * so it is *my account*. The lead time — how much warning the business wants before a job — is *how
 * the business runs*, and stays in Preferencias. This section STATES it rather than editing it, so
 * the rule has one home and this screen still explains itself.
 *
 * The two halves are not alternatives, and the UI says so plainly:
 * - **Google** is a real integration. We write the events, update them as the order moves, and
 *   remove them when a step is confirmed or the order is cancelled.
 * - **The subscription** is for **Apple Calendar and everything else**, because there is no write
 *   API for Apple Calendar at all — no OAuth scope, no endpoint, nothing that does not involve
 *   holding somebody's Apple ID. A subscribed calendar is not a lesser version of the same thing; it
 *   is the mechanism those apps actually offer.
 */
const CalendarSection: React.FC = () => {
  const { t } = useTranslation();
  const { data, isLoading, isError } = useCalendar();
  const { connect, isPending: connecting } = useConnectGoogleCalendar();
  const { disconnect, isPending: disconnecting } = useDisconnectGoogleCalendar();
  const { createFeed, isPending: creatingFeed } = useCreateCalendarFeed();
  const { deleteFeed, isPending: deletingFeed } = useDeleteCalendarFeed();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const outcome = readCalendarOutcome(window.location.search);
    if (!outcome) return;
    if (outcome === 'connected') {
      notify.success(t(`${KEY}.google.connectedToast`));
    } else {
      notify.error(t(`${KEY}.google.errorToast`));
    }
    // Stripping the marker is what makes this run ONCE, and it is the only guard needed: a second
    // pass (React's double-invoked effect, a re-render) finds no marker and returns. It also means
    // a bookmark or a refresh cannot report a connection that happened days ago.
    window.history.replaceState(
      null,
      '',
      withoutCalendarOutcome(window.location.pathname + window.location.search),
    );
  }, [t]);

  const startConnect = (): void => {
    void connect()
      // A full navigation of THIS tab, not a popup: a consent screen in a popup is where the flow
      // goes to die on mobile browsers, and the callback brings the browser straight back here.
      .then((url) => window.location.assign(url))
      .catch(() => notify.error(t(`${KEY}.google.errorToast`)));
  };

  const copyFeed = (): void => {
    const url = data?.feed.url;
    /* v8 ignore next -- the button only exists once a URL is present */
    if (!url) return;
    void navigator.clipboard
      ?.writeText(url)
      .then(() => {
        setCopied(true);
        notify.success(t(`${KEY}.feed.copied`));
      })
      // Clipboard access can be refused (an insecure origin, a permission policy). Saying so beats
      // a button that silently does nothing — the URL is selectable on screen either way.
      .catch(() => notify.error(t(`${KEY}.feed.copyFailed`)));
  };

  const busy = connecting || disconnecting || creatingFeed || deletingFeed;

  return (
    <SettingsSection title={t(`${KEY}.title`)} description={t(`${KEY}.description`)}>
      {isError ? (
        <p className="py-6 text-sm text-charcoal/55">{t(`${KEY}.error`)}</p>
      ) : (
        <div className="divide-y divide-charcoal/[0.06]">
          {/* ── Google ─────────────────────────────────────────────────────────────────────── */}
          <CalendarRow
            label={t(`${KEY}.google.label`)}
            description={
              data?.googleAvailable === false
                ? t(`${KEY}.google.unavailable`)
                : data?.google.connected
                  ? t(`${KEY}.google.connectedAs`, {
                      account: data.google.accountEmail ?? t(`${KEY}.google.unknownAccount`),
                    })
                  : t(`${KEY}.google.description`)
            }
          >
            <SkeletonFade
              loading={isLoading}
              contentClassName="inline-flex gap-2"
              skeleton={<span aria-hidden className={`inline-block h-9 w-28 ${SKELETON}`} />}
            >
              {data?.googleAvailable === false ? null : data?.google.connected ? (
                <Button
                  variant="soft"
                  color={DANGER_COLOR}
                  size="sm"
                  loading={disconnecting}
                  disabled={busy}
                  startIcon={<HiOutlineTrash className="size-4" />}
                  onClick={() => disconnect()}
                >
                  {t(`${KEY}.google.disconnect`)}
                </Button>
              ) : (
                <Button
                  color={SECONDARY_COLOR}
                  size="sm"
                  loading={connecting}
                  disabled={busy}
                  startIcon={<HiOutlineLink className="size-4" />}
                  onClick={startConnect}
                >
                  {t(`${KEY}.google.connect`)}
                </Button>
              )}
            </SkeletonFade>
          </CalendarRow>

          {/* ── The subscription: Apple Calendar, Outlook, anything ────────────────────────── */}
          <CalendarRow
            label={t(`${KEY}.feed.label`)}
            description={t(`${KEY}.feed.description`)}
          >
            <SkeletonFade
              loading={isLoading}
              contentClassName="inline-flex gap-2"
              skeleton={<span aria-hidden className={`inline-block h-9 w-28 ${SKELETON}`} />}
            >
              <Button
                variant="soft"
                color={SECONDARY_COLOR}
                size="sm"
                loading={creatingFeed}
                disabled={busy}
                startIcon={<HiOutlineArrowPath className="size-4" />}
                onClick={() => createFeed()}
              >
                {t(`${KEY}.feed.${data?.feed.url ? 'regenerate' : 'create'}`)}
              </Button>
              {data?.feed.url && (
                <Button
                  variant="soft"
                  color={DANGER_COLOR}
                  size="sm"
                  loading={deletingFeed}
                  disabled={busy}
                  startIcon={<HiOutlineTrash className="size-4" />}
                  onClick={() => deleteFeed()}
                >
                  {t(`${KEY}.feed.remove`)}
                </Button>
              )}
            </SkeletonFade>
          </CalendarRow>

          {data?.feed.url && (
            <div className="flex flex-col gap-2 py-4">
              <p className="text-sm text-charcoal/55">{t(`${KEY}.feed.howTo`)}</p>
              <div className="flex flex-wrap items-center gap-2">
                {/* Selectable and wrapping: this is a long secret somebody may need to read out or
                    copy by hand when the clipboard is unavailable. `break-all` because a URL has no
                    spaces to wrap at, and a fixed-width font because it will be compared by eye. */}
                <code className="min-w-0 flex-1 break-all rounded-control bg-charcoal/[0.04] px-3 py-2 text-xs text-charcoal/80">
                  {data.feed.url}
                </code>
                <Button
                  variant="soft"
                  color={SECONDARY_COLOR}
                  size="sm"
                  startIcon={<HiOutlineClipboardDocument className="size-4" />}
                  onClick={copyFeed}
                >
                  {t(`${KEY}.feed.${copied ? 'copyAgain' : 'copy'}`)}
                </Button>
              </div>
              {/* Regenerating is the ONLY revoke. Said plainly, because the button above is one tap
                  away from silently breaking every device already subscribed. */}
              <p className="text-xs text-charcoal/45">{t(`${KEY}.feed.revokeNote`)}</p>
            </div>
          )}

          {/* ── The rule both halves obey ──────────────────────────────────────────────────── */}
          <CalendarRow
            label={t(`${KEY}.reminder.label`)}
            description={t(`${KEY}.reminder.description`)}
          >
            <SkeletonFade
              loading={isLoading}
              contentClassName="inline-flex"
              skeleton={<span aria-hidden className={`inline-block h-4 w-20 ${SKELETON}`} />}
            >
              <span className="text-sm font-medium text-charcoal">
                {data
                  ? (() => {
                      const lead = leadTimeKey(data.reminderMinutes);
                      return t(`${KEY}.reminder.${lead.key}`, { count: lead.count });
                    })()
                  : ''}
              </span>
            </SkeletonFade>
          </CalendarRow>
        </div>
      )}
    </SettingsSection>
  );
};

export default CalendarSection;
