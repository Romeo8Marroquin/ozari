import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  HiOutlineArrowPath,
  HiOutlineClipboardDocument,
  HiOutlineLink,
  HiOutlineTrash,
} from 'react-icons/hi2';
import Button from '@components/Button';
import MorphSwap from '@components/MorphSwap';
import SkeletonFade from '@components/SkeletonFade';
import { notify } from '@components/notifications/notify';
import { toFormError } from '@utils/apiError';
import ActionRow from '../ActionRow';
import type { ActionRowItem } from '../ActionRow';
import { animateTilesOut, fadeIn, fadeOut, hasMotion, revealInScroller } from '../pageMotion';
import useMorphOnChange from '../useMorphOnChange';
import SettingRow from './SettingRow';
import SettingsSection from './SettingsSection';
import CalendarConfirmModal from './CalendarConfirmModal';
import type { CalendarConfirmAction } from './CalendarConfirmModal';
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

/** These rows are {@link SettingRow}s — the same primitive the security card uses, so the screen
 *  reads as one surface rather than a page with a widget bolted on. Two things are local to this
 *  card: the region's FLIP identity (so when a row above grows or disappears, this one glides into
 *  its new place instead of teleporting) and `morphDescription`, because these descriptions really
 *  do rewrite themselves ("Conecta tu cuenta…" → "Conectado como a@b.com").
 *
 *  ⚠️ EVERY layer between the row and the buttons must be able to WRAP, or the group becomes an
 *  atomic box wider than the card. `SettingRow` owns the outer half of that rule; the wrapping
 *  classes on `SkeletonFade`'s layers and on the Google `ActionRow` below are the inner half, and they must
 *  stay `flex-wrap`. Deliberately NO `justify-*`: the row aligns this group by letting the
 *  description grow, so it is already flush right while the row is split, and when it folds onto
 *  its own line it starts at the card's left edge — under the label it belongs to, which is also
 *  where a phone has always put it. */
const ACTIONS = 'flex flex-wrap items-center gap-2';

/**
 * The subscription's buttons are items of the CARD's morph region, not an `ActionRow`.
 *
 * ⚠️ Generating or removing a link changes the whole card at once — a block arrives or leaves, a
 * button arrives or leaves, a label changes, and the row may re-wrap — and every one of those has to
 * land in ONE commit, because the region measures the card's new height and every row's new place
 * exactly once, at that commit. `ActionRow` commits its own set a beat LATER (after its leave, or a
 * task later on an arrival), so the region had already measured a card that was about to change
 * again: the height eased to the wrong number and snapped the rest of the way when it let go, the
 * rows below jumped mid-glide, and at phone width "Quitar enlace" hopped between lines while it was
 * fading out (measured frame by frame, 2026-10-09). As region items they arrive and glide with
 * everything else, and the one that leaves fades out BEFORE the commit, together with the block.
 * The Google row keeps `ActionRow`: its swaps never re-shape the card.
 */
const FEED_ACTION = 'calendar-flip inline-flex';

/**
 * "Generar enlace" ⇄ "Generar de nuevo", with BOTH labels stacked in one grid cell and only one
 * visible — so the button is always as wide as the longer of the two and its width NEVER changes.
 *
 * That is the point. A label that changes width moves (or wraps) the button beside it, and a width
 * that EASES (`MorphSwap`, which this used to be) does it in the middle of the card's own
 * transition, after the layout was measured. A fixed width keeps the change to what it is: one word
 * cross-fading inside a box that stays put. The hidden label is `aria-hidden`, so the button's
 * accessible name is only ever the visible one.
 */
const GenerateLabel: React.FC<{ regenerate: boolean }> = ({ regenerate }) => {
  const { t } = useTranslation();
  const layer = (visible: boolean): string =>
    `col-start-1 row-start-1 transition-opacity duration-200 motion-reduce:transition-none ${
      visible ? 'opacity-100' : 'opacity-0'
    }`;
  return (
    <span className="grid justify-items-center">
      <span aria-hidden={regenerate} className={layer(!regenerate)}>
        {t(`${KEY}.feed.create`)}
      </span>
      <span aria-hidden={!regenerate} className={layer(regenerate)}>
        {t(`${KEY}.feed.regenerate`)}
      </span>
    </span>
  );
};

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
 *
 * **Every state change here is choreographed, and it is layered rather than nested** (the repo's
 * motion rule): the card body is ONE `useMorphOnChange` region that owns every height change, and
 * inside it nothing else animates height — the Google buttons leave-then-reflow (`ActionRow`), the
 * descriptions cross-fade in place (`MorphSwap`), and the subscription block and its buttons are
 * region items that rise in and glide with the rows (see {@link FEED_ACTION} for why they must be).
 * Generating a link used to drop a whole paragraph, a URL and two buttons into the card in a single
 * frame, which shoved everything below it down with no explanation of where it came from.
 *
 * **Nothing destructive happens on one tap** (owner, 2026-08-31). Disconnecting and both feed
 * actions reach devices that are not in front of you, so they go through `CalendarConfirmModal`
 * first — and then follow the deletion doctrine exactly: the request is fired, the answer is waited
 * for, the outgoing content plays its exit, and only THEN is the screen told to re-read itself.
 */
const CalendarSection: React.FC = () => {
  const { t } = useTranslation();
  const { data, isLoading, isError } = useCalendar();
  const { connect, isPending: connecting } = useConnectGoogleCalendar();
  const {
    disconnect,
    isPending: disconnecting,
    commit: commitDisconnect,
  } = useDisconnectGoogleCalendar();
  const { createFeed, isPending: creatingFeed, commit: commitFeed } = useCreateCalendarFeed();
  const {
    deleteFeed,
    isPending: deletingFeed,
    commit: commitFeedRemoval,
  } = useDeleteCalendarFeed();
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState<CalendarConfirmAction | undefined>(undefined);
  const [confirmError, setConfirmError] = useState<string | undefined>(undefined);

  const feedUrl = data?.feed.url;
  const googleConnected = data?.google.connected === true;
  /**
   * ⚠️ A connection can be PRESENT and DEAD, and the difference is the whole feature.
   *
   * When Google answers `invalid_grant` — the admin revoked access, or the refresh token expired
   * (which it does in ~7 days while the OAuth app is in Testing) — the sync deactivates the row
   * rather than retrying forever, and then says nothing, because a calendar failure must never
   * surface on the order that triggered it. The row stays in the database, so `connected` is still
   * true, and this screen used to read ONLY that: it kept saying "Conectado como a@b.com" while
   * every order silently stopped reaching the calendar. The one signal that tells them apart is
   * `isActive`, which the API has always returned and this screen never read.
   */
  const googleExpired = googleConnected && data?.google.isActive === false;
  const googleAvailable = data?.googleAvailable !== false;

  /**
   * The body adapts to whatever the state now is: the height eases and the rows glide.
   *
   * The key is the whole VISIBLE state rather than a flag, because each part of it changes the card's
   * size — the description gaining a line, the subscription block appearing, the URL itself changing
   * on a regenerate. A background refetch handing back identical data leaves the key untouched and
   * therefore animates nothing, which is the entire point of keying it.
   */
  const body = useMorphOnChange<HTMLDivElement>(
    `${isLoading}|${isError}|${googleAvailable}|${googleConnected}|${googleExpired}|${data?.google.accountEmail ?? ''}|${feedUrl ?? ''}|${data?.reminderMinutes ?? ''}`,
    '.calendar-flip',
    // The ROWS only move when a row is added, removed or re-wrapped. Keyed on the full state they
    // re-glided on a regenerate and on a lead-time change — the whole card drifting for a swap that
    // moved nothing, which is what `itemsKey` exists to prevent (the catalog card's lesson). The URL
    // VALUE and the reminder are deliberately absent: they morph in place, inside a fixed box.
    `${isLoading}|${isError}|${googleAvailable}|${googleConnected}|${googleExpired}|${feedUrl !== undefined}`,
  );

  /** The subscription block — held so its ARRIVAL can rise in and its DEPARTURE can play out before
   *  the state that removes it is committed. */
  const feedBlock = useRef<HTMLDivElement>(null);
  /** The "Quitar enlace" action, held so it can fade out WITH the block before the removal commits. */
  const removeAction = useRef<HTMLSpanElement>(null);
  const hadFeed = useRef(false);
  /** Whether a real answer has been seen yet. The FIRST one is adopted silently: a link that already
   *  existed is not something that just appeared, and animating it in would fight the settings
   *  page's own entrance — two entrances on one element, the trap the order detail's evidence card
   *  documents. Only a link that arrives on a settled screen rises in. */
  const seenFeedState = useRef(false);

  // A LAYOUT effect, declared AFTER `useMorphOnChange` on purpose: it runs before the first paint of
  // the new state (a passive effect painted the block at full opacity for a frame, then blinked it
  // out to start its entrance), and it runs after the region's reflow, so it can see whether that
  // reflow already gave the block its entrance.
  useLayoutEffect(() => {
    if (isLoading) return;
    const has = feedUrl !== undefined;
    if (!seenFeedState.current) {
      seenFeedState.current = true;
      hadFeed.current = has;
      return;
    }
    if (has && !hadFeed.current && feedBlock.current) {
      // It APPEARED: rise it in, and bring it into view. A link you just generated is the thing you
      // are looking for, and on a short viewport it lands below the fold (the repo's "adding
      // something is a request to SEE it" rule). The region's own tween eases the height around it.
      //
      // ⚠️ ONE entrance. The block is a region item, so the reflow normally rises it in itself; a
      // second `fadeIn` on top killed that tween halfway — after it had set `scale: .96` and before
      // it could clear it — and left the whole block shrunk to 96% until something else moved the
      // card. Ours runs only when the region declined (a snapshot it could not trust).
      //
      // Fade + RISE, not the editor slot's sideways hand-over: this block arrives in a column that
      // reads top-to-bottom, and a horizontal entrance crossing a vertical growth was the part that
      // read as struggling rather than as one movement (the lateral rule — an axis is a statement).
      if (!hasMotion(feedBlock.current)) fadeIn(feedBlock.current);
      revealInScroller(feedBlock.current);
    }
    hadFeed.current = has;
  }, [feedUrl, isLoading]);

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
    /* v8 ignore next -- the button only exists once a URL is present */
    if (!feedUrl) return;
    void navigator.clipboard
      ?.writeText(feedUrl)
      .then(() => {
        setCopied(true);
        notify.success(t(`${KEY}.feed.copied`));
      })
      // Clipboard access can be refused (an insecure origin, a permission policy). Saying so beats
      // a button that silently does nothing — the URL is selectable on screen either way.
      .catch(() => notify.error(t(`${KEY}.feed.copyFailed`)));
  };

  /**
   * The confirmed act, in the ONE order that is honest: ask the server, wait for its answer, play
   * the exit, then commit that answer to the screen.
   *
   * Animating first and undoing on failure would show the thing already gone while the request can
   * still fail. `leaving` plays whatever actually disappears from the card — nothing, for a
   * disconnect (the row stays and its buttons swap, which `ActionRow` owns) and, for a removal, the
   * whole subscription block AND its "Quitar enlace" button together, each fading where it stands so
   * that the commit finds them already gone and the region eases the gap shut in one move.
   */
  const runConfirmed = <T,>(
    action: CalendarConfirmAction,
    request: () => Promise<T>,
    commit: (answer: T) => void,
    leaving: () => Promise<unknown>,
    toast: string,
  ): void => {
    setConfirmError(undefined);
    void request()
      .then(async (answer) => {
        // Whatever is going away fades where it stands FIRST; only then does the state that removes
        // it commit, so the region eases the gap shut around content that is already gone.
        await leaving();
        commit(answer);
        setConfirming(undefined);
        notify.success(toast);
      })
      .catch((requestError: unknown) => {
        // Inline, in the dialog the admin is looking at, so the action can simply be retried; a
        // toast behind a modal is a message nobody reads. Ambient failures still toast.
        const { inline, toast: ambient } = toFormError(
          requestError,
          t(`${KEY}.confirm.${action}.error`),
        );
        if (inline) setConfirmError(inline);
        if (ambient) notify.error(ambient);
      });
  };

  const busy = connecting || disconnecting || creatingFeed || deletingFeed;

  /** The FIRST link: nothing exists to break, so it needs no dialog — but it still has to handle its
   *  own failure, or a rejected write becomes an unhandled rejection and the button just sits there. */
  const generateFirstFeed = (): void => {
    void createFeed()
      .then(commitFeed)
      .catch(() => notify.error(t(`${KEY}.confirm.feedRegenerate.error`)));
  };

  const nothingLeaves = (): Promise<void> => Promise.resolve();

  const confirmAction = (): void => {
    /* v8 ignore next -- the footer only exists while an action is being confirmed */
    if (confirming === undefined || busy) return;
    if (confirming === 'googleDisconnect') {
      runConfirmed(
        confirming,
        disconnect,
        commitDisconnect,
        nothingLeaves,
        t(`${KEY}.google.disconnectedToast`),
      );
      return;
    }
    if (confirming === 'feedRemove') {
      runConfirmed(
        confirming,
        deleteFeed,
        commitFeedRemoval,
        // Either can be gone already — a focus re-read can take the link away under the open
        // dialog — and then there is simply nothing to fade; both helpers resolve at once.
        () =>
          Promise.all([
            feedBlock.current ? fadeOut(feedBlock.current) : undefined,
            animateTilesOut(removeAction.current ? [removeAction.current] : []),
          ]),
        t(`${KEY}.feed.removedToast`),
      );
      return;
    }
    // A regenerate REPLACES the URL rather than removing the block, so nothing leaves: the code
    // element morphs to the new value and the card resizes around it.
    runConfirmed(
      confirming,
      createFeed,
      commitFeed,
      nothingLeaves,
      t(`${KEY}.feed.regeneratedToast`),
    );
  };

  /** The Google half's buttons. Keyed by what the action IS, so connect→disconnect is a replacement
   *  (it fades out, the other rises in) rather than a label that morphed. */
  const googleActions: ActionRowItem[] = !googleAvailable
    ? []
    : googleConnected
      ? [
          // A dead grant is only fixable by consenting again, so the row leads with that — and keeps
          // "Desconectar" beside it, because the other honest answer is to stop using the
          // integration. Its own key, so it ARRIVES rather than morphing out of "Desconectar".
          ...(googleExpired
            ? [
                {
                  key: 'reconnect',
                  node: (
                    <Button
                      color={SECONDARY_COLOR}
                      size="sm"
                      loading={connecting}
                      disabled={busy}
                      startIcon={<HiOutlineLink className="size-4" />}
                      onClick={startConnect}
                    >
                      {t(`${KEY}.google.reconnect`)}
                    </Button>
                  ),
                },
              ]
            : []),
          {
            key: 'disconnect',
            node: (
              <Button
                variant="soft"
                color={DANGER_COLOR}
                size="sm"
                loading={disconnecting}
                disabled={busy}
                startIcon={<HiOutlineTrash className="size-4" />}
                onClick={() => setConfirming('googleDisconnect')}
              >
                {t(`${KEY}.google.disconnect`)}
              </Button>
            ),
          },
        ]
      : [
          {
            key: 'connect',
            node: (
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
            ),
          },
        ];

  const lead = leadTimeKey(data?.reminderMinutes ?? 0);

  return (
    <SettingsSection title={t(`${KEY}.title`)} description={t(`${KEY}.description`)}>
      <div ref={body}>
        {isError ? (
          <p className="py-6 text-sm text-charcoal/55">{t(`${KEY}.error`)}</p>
        ) : (
          <div className="divide-y divide-charcoal/[0.06]">
            {/* ── Google ───────────────────────────────────────────────────────────────────── */}
            <SettingRow
              flipId="google"
              className="calendar-flip"
              morphDescription
              label={t(`${KEY}.google.label`)}
              description={
                !googleAvailable
                  ? t(`${KEY}.google.unavailable`)
                  : googleExpired
                    ? t(`${KEY}.google.expired`, {
                        account: data?.google.accountEmail ?? t(`${KEY}.google.unknownAccount`),
                      })
                    : googleConnected
                      ? t(`${KEY}.google.connectedAs`, {
                          account: data?.google.accountEmail ?? t(`${KEY}.google.unknownAccount`),
                        })
                      : t(`${KEY}.google.description`)
              }
            >
              <SkeletonFade
                loading={isLoading}
                contentClassName={ACTIONS}
                skeleton={<span aria-hidden className={`inline-block h-11 w-32 ${SKELETON}`} />}
              >
                <ActionRow items={googleActions} className={ACTIONS} />
              </SkeletonFade>
            </SettingRow>

            {/* ── The subscription: Apple Calendar, Outlook, anything ──────────────────────── */}
            <SettingRow
              flipId="feed"
              className="calendar-flip"
              label={t(`${KEY}.feed.label`)}
              description={t(`${KEY}.feed.description`)}
            >
              <SkeletonFade
                loading={isLoading}
                contentClassName={ACTIONS}
                skeleton={<span aria-hidden className={`inline-block h-11 w-32 ${SKELETON}`} />}
              >
                {/* ONE button across both labels: generating the first link and replacing it are the
                    same action, so it stays where it is and only its word changes. */}
                <span data-flip-id="feed-generate" className={FEED_ACTION}>
                  <Button
                    variant="soft"
                    color={SECONDARY_COLOR}
                    size="sm"
                    loading={creatingFeed}
                    disabled={busy}
                    startIcon={<HiOutlineArrowPath className="size-4" />}
                    onClick={() => (feedUrl ? setConfirming('feedRegenerate') : generateFirstFeed())}
                  >
                    <GenerateLabel regenerate={feedUrl !== undefined} />
                  </Button>
                </span>
                {feedUrl && (
                  <span ref={removeAction} data-flip-id="feed-remove" className={FEED_ACTION}>
                    <Button
                      variant="soft"
                      color={DANGER_COLOR}
                      size="sm"
                      loading={deletingFeed}
                      disabled={busy}
                      startIcon={<HiOutlineTrash className="size-4" />}
                      onClick={() => setConfirming('feedRemove')}
                    >
                      {t(`${KEY}.feed.remove`)}
                    </Button>
                  </span>
                )}
              </SkeletonFade>
            </SettingRow>

            {feedUrl && (
              <div
                ref={feedBlock}
                data-flip-id="feed-url"
                className="calendar-flip flex flex-col gap-2 py-4"
              >
                <p className="text-sm text-charcoal/55">{t(`${KEY}.feed.howTo`)}</p>
                <div className="flex flex-wrap items-center gap-2">
                  {/* Selectable and wrapping: this is a long secret somebody may need to read out or
                      copy by hand when the clipboard is unavailable. `break-all` because a URL has no
                      spaces to wrap at, and a fixed-width font because it will be compared by eye.
                      It MORPHS on a regenerate — the URL is the one thing on this card a person is
                      actually reading, so replacing it in a single frame is how you fail to notice
                      that the link you just copied is not the one on screen.
                      `grow basis-56`, not `flex-1`: `flex-1`'s zero basis let the box shrink to a
                      sliver beside the button on a narrow card, printing the URL two characters per
                      line. With a floor it keeps a readable width and the button folds underneath
                      instead — the same rule the rows above follow. */}
                  <MorphSwap
                    block
                    swapKey={feedUrl}
                    className="min-w-0 grow basis-56 rounded-control bg-charcoal/[0.04] px-3 py-2"
                  >
                    <code className="block break-all text-xs text-charcoal/80">{feedUrl}</code>
                  </MorphSwap>
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

            {/* ── The rule both halves obey ────────────────────────────────────────────────── */}
            <SettingRow
              flipId="reminder"
              className="calendar-flip"
              label={t(`${KEY}.reminder.label`)}
              description={t(`${KEY}.reminder.description`)}
            >
              <SkeletonFade
                loading={isLoading}
                contentClassName="inline-flex"
                skeleton={<span aria-hidden className={`inline-block h-4 w-20 ${SKELETON}`} />}
              >
                {/* A VALUE, not a control — and it obeys the same alignment as the buttons above it:
                    right-aligned, centred on its description. `text-right` matters only for the one
                    case the row cannot help with, a value long enough to wrap. */}
                <MorphSwap
                  swapKey={data?.reminderMinutes ?? 0}
                  className="text-right text-sm font-medium text-charcoal"
                >
                  {data ? t(`${KEY}.reminder.${lead.key}`, { count: lead.count }) : ''}
                </MorphSwap>
              </SkeletonFade>
            </SettingRow>
          </div>
        )}
      </div>

      <CalendarConfirmModal
        action={confirming}
        pending={busy}
        error={confirmError}
        onConfirm={confirmAction}
        onClose={() => {
          setConfirming(undefined);
          setConfirmError(undefined);
        }}
      />
    </SettingsSection>
  );
};

export default CalendarSection;
