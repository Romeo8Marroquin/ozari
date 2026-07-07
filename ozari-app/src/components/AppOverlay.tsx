import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { FiRefreshCw } from 'react-icons/fi';
import Button from './Button';
import ErrorScreen from './ErrorScreen';
import { checkHealth } from '@utils/health';
import { useOutageStore } from '../stores/outageStore';

// Poll health on this cadence, and bound the AUTO attempts so a long outage doesn't turn every
// client into a health-endpoint DDoS. The same interval is the button's disable cooldown, so a
// manual retry (or an auto probe) locks the button until the next slot.
const CHECK_INTERVAL_S = 10;
const MAX_AUTO_ATTEMPTS = 6; // ~60s of hands-free retrying, then manual only

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A smoothly expanding/collapsing note (the "still failing" retry feedback), matching the form-error
 * gentleness (`grid-rows 0fr↔1fr`). Keeps the last message painted through the collapse via the
 * sanctioned adjust-state-during-render pattern (no effect, no ref).
 */
const CollapsingNote: React.FC<{ message?: string }> = ({ message }) => {
  const [displayed, setDisplayed] = useState(message);
  const [prev, setPrev] = useState(message);
  if (message !== prev) {
    setPrev(message);
    if (message) setDisplayed(message);
  }
  const open = Boolean(message);
  return (
    <div
      aria-hidden={!open}
      className={`grid transition-[grid-template-rows,opacity] duration-300 ease-[var(--ease-settle)] motion-reduce:transition-none ${
        open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
      }`}
    >
      <div className="overflow-hidden">
        <p role="alert" className="max-w-xs pt-1 text-xs leading-relaxed text-red-500">
          {displayed}
        </p>
      </div>
    </div>
  );
};

/**
 * The overlay's contents + health poller. Mounted only while the overlay is open, so its state is
 * fresh per activation. The displayed variant is derived **live** from `navigator.onLine`:
 *  - **offline** → we don't poll the server (pointless); we wait for the browser `online` event, then
 *    probe once. A manual retry is available but will just report "still offline".
 *  - **online** (backend outage) → auto-poll every 10s up to the cap, then manual-only.
 * On a healthy probe it calls `onHealthy` (recover). A failed probe shows a smooth per-reason note.
 */
const OverlayContent: React.FC<{
  onHealthy: () => void;
  visible: boolean;
  onExited: () => void;
}> = ({ onHealthy, visible, onExited }) => {
  const { t } = useTranslation();
  const [online, setOnline] = useState(() => navigator.onLine);
  const [checking, setChecking] = useState(false);
  const [autoExhausted, setAutoExhausted] = useState(false);
  const [failedKey, setFailedKey] = useState<string | null>(null);
  // The button is disabled until this timestamp — for BOTH auto and manual probes. Start disabled
  // when online (counting down to the first auto probe); enabled when offline (manual/event driven).
  const [cooldownUntil, setCooldownUntil] = useState(() =>
    navigator.onLine ? Date.now() + CHECK_INTERVAL_S * 1000 : 0,
  );
  const [now, setNow] = useState(() => Date.now());

  const checkingRef = useRef(false);
  const attemptsRef = useRef(0);

  const variant = online ? 'maintenance' : 'offline';

  const runCheck = useCallback(async () => {
    if (checkingRef.current) return;
    checkingRef.current = true;
    setChecking(true);
    setFailedKey(null);
    setCooldownUntil(Date.now() + CHECK_INTERVAL_S * 1000);

    const healthy = await checkHealth();

    checkingRef.current = false;
    setChecking(false);
    if (healthy) {
      onHealthy();
      return;
    }
    // Still failing — a friendly, reason-specific note (offline vs server down).
    setFailedKey(
      navigator.onLine ? 'errorScreen.maintenance.retryFailed' : 'errorScreen.offline.retryFailed',
    );
  }, [onHealthy]);

  // Track connectivity: switch the displayed variant, and probe once the moment we're back online.
  useEffect(() => {
    const handleOffline = (): void => setOnline(false);
    const handleOnline = (): void => {
      setOnline(true);
      void runCheck();
    };
    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);
    return () => {
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
    };
  }, [runCheck]);

  // Auto-poll only while online (offline waits for the 'online' event). Bounded, then manual-only.
  useEffect(() => {
    if (!online) return;
    const id = setInterval(() => {
      if (attemptsRef.current >= MAX_AUTO_ATTEMPTS) {
        setAutoExhausted(true);
        clearInterval(id);
        return;
      }
      attemptsRef.current += 1;
      void runCheck();
    }, CHECK_INTERVAL_S * 1000);
    return () => clearInterval(id);
  }, [online, runCheck]);

  // Tick `now` while a cooldown is pending — drives the countdown label and re-enables the button.
  useEffect(() => {
    const id = setInterval(() => {
      const t2 = Date.now();
      setNow(t2);
      if (t2 >= cooldownUntil) clearInterval(id);
    }, 500);
    return () => clearInterval(id);
  }, [cooldownUntil]);

  const secondsLeft = Math.max(0, Math.ceil((cooldownUntil - now) / 1000));
  const disabled = checking || secondsLeft > 0;

  const handleManualRetry = (): void => {
    // Hard guard in JS state, not just the button's `disabled` attribute — editing the DOM to
    // re-enable it can't spam the probe. (Backend rate-limiting is the real enforcement.)
    /* v8 ignore next -- defense-in-depth: the button is already `disabled` whenever this guard would
       trip (disabled = checking || secondsLeft > 0), so a real click can't reach the early return */
    if (checkingRef.current || secondsLeft > 0) return;
    void runCheck();
  };

  const label =
    secondsLeft > 0
      ? t('errorScreen.maintenance.retryIn', { seconds: secondsLeft })
      : t(`errorScreen.${variant}.action`);

  const statusText = !online
    ? t('errorScreen.offline.autoWaiting')
    : autoExhausted
      ? t('errorScreen.maintenance.autoStopped')
      : t('errorScreen.maintenance.autoRetrying');

  const controls = (
    <>
      <Button
        color="#262626"
        onClick={handleManualRetry}
        disabled={disabled}
        loading={checking}
        startIcon={<FiRefreshCw aria-hidden className="size-[18px]" />}
      >
        {label}
      </Button>
      <span className="text-xs text-charcoal/45" aria-live="polite">
        {statusText}
      </span>
      <CollapsingNote message={failedKey ? t(failedKey) : undefined} />
    </>
  );

  return <ErrorScreen variant={variant} action={controls} visible={visible} onExited={onExited} />;
};

/**
 * The single, top-of-everything app overlay (above notifications — `--z-app-overlay`), mounted once
 * in `__root`. Raised by the axios interceptor on a backend outage (502/503/504) or by the browser
 * going offline. It fades in, **blocks the whole app** (nothing is touchable while things are broken —
 * React Query also pauses its own fetches while offline), and on recovery fades out and
 * **`invalidateQueries()`** (soft refetch, NO reload), so the app behind it comes back fresh.
 *
 * Uses the mount-during-exit fade pattern (like `Modal`) so the fade-out actually plays before it
 * unmounts. `OverlayContent` mounts only while shown, so its poller state is fresh each time.
 */
const AppOverlay: React.FC = () => {
  const { t } = useTranslation();
  const active = useOutageStore((state) => state.active);
  const deactivate = useOutageStore((state) => state.deactivate);
  const queryClient = useQueryClient();

  // Keep the overlay mounted through its reverse exit: `exiting` stays true from the moment `active`
  // drops until ErrorScreen's `onExited` fires (the un-build finishes). `session` bumps on every fresh
  // activation so the content remounts with a clean poller (no stale attempts/cooldown from before).
  // Adjust-state-during-render (no effect) to catch the active→inactive edge.
  const [prevActive, setPrevActive] = useState(active);
  const [exiting, setExiting] = useState(false);
  const [session, setSession] = useState(0);
  if (active !== prevActive) {
    setPrevActive(active);
    setExiting(!active); // just went inactive → begin exit; reactivated → cancel any exit
    if (active) setSession((s) => s + 1);
  }
  const rendered = active || exiting;

  const wrapperRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  // Always-on: losing the connection raises the overlay immediately, before any request even fails.
  useEffect(() => {
    const handleOffline = (): void => useOutageStore.getState().activate();
    window.addEventListener('offline', handleOffline);
    return () => window.removeEventListener('offline', handleOffline);
  }, []);

  // Blocking behaviour while open: lock body scroll, move focus in, and trap Tab inside the overlay
  // (the pointer is already blocked by the full-screen layer). Restores scroll + focus on close.
  useEffect(() => {
    if (!active) return;
    openerRef.current = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const raf = requestAnimationFrame(() => {
      const root = wrapperRef.current;
      (root?.querySelector<HTMLElement>(FOCUSABLE) ?? root)?.focus();
    });

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Tab' || !wrapperRef.current) return;
      const focusables = Array.from(wrapperRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusables.length === 0) {
        event.preventDefault(); // nothing focusable yet (retry still cooling) — keep focus captured
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const current = document.activeElement as HTMLElement;
      if (!focusables.includes(current)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && current === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && current === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      openerRef.current?.focus();
    };
  }, [active]);

  const handleHealthy = useCallback(() => {
    // Refresh the app behind the overlay (refetch all queries), then let it play its reverse exit.
    void queryClient.invalidateQueries();
    deactivate();
  }, [queryClient, deactivate]);

  const handleExited = useCallback(() => setExiting(false), []);

  if (!rendered) return null;

  return createPortal(
    <div
      ref={wrapperRef}
      role="alertdialog"
      aria-modal="true"
      aria-label={t('errorScreen.overlayLabel')}
      tabIndex={-1}
      className="fixed inset-0 z-[var(--z-app-overlay)] outline-none"
    >
      <OverlayContent key={session} visible={active} onHealthy={handleHealthy} onExited={handleExited} />
    </div>,
    document.body,
  );
};

export default AppOverlay;
