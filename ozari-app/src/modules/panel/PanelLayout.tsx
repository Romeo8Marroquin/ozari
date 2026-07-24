import { useGSAP } from '@gsap/react';
import { Outlet, useLocation, useNavigate, useRouter } from '@tanstack/react-router';
import gsap from 'gsap';
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { prefersReducedMotion } from '@utils/motion';
import OverlayScrollbar from '@components/OverlayScrollbar';
import Header from './components/Header';
import Sidebar from './components/Sidebar';
import ForcedLogoutListener from './ForcedLogoutListener';
import { panelSectionFor, type PanelPath } from './navConfig';
import { PanelChromeProvider } from './hooks/usePanelChrome';
import { fadeIn, fadeOut, headerTitleIn, headerTitleOut, type EnterOptions } from './pageMotion';
import { PanelExitContext } from './PanelExitContext';
import { PanelNavContext, type PanelNav } from './PanelNavContext';
import { PanelPageTransitionContext, type PanelPageMotion } from './PanelPageTransitionContext';
import PanelScrollMemory from './PanelScrollMemory';

// One in-flight tab transition. The object is a run TOKEN: `pending` is the latest intended
// destination (a mid-exit click just swaps it — the running exit is never restarted), and the
// object's identity is the staleness guard — cancelling (or logout) detaches it, so the exit's
// completion handler can tell it was superseded and must not navigate.
interface ExitRun {
  pending: PanelPath;
  /** Whether this run has played the header title's exit — only cross-SECTION moves do (the title
   *  is the section's name; animating the same text out and back in on a grid→detail move read as
   *  a glitch). A mid-exit retarget to another section fires it late. */
  titleOut: boolean;
}

const PanelShell: React.FC = () => {
  const container = useRef<HTMLDivElement>(null);
  // The content body (wraps the <Outlet>) — the element the DEFAULT transition animates.
  const screen = useRef<HTMLDivElement>(null);
  // The scroll container — its NATIVE bar is hidden (it occupies layout space, so pages jumped
  // sideways whenever overflow appeared/disappeared); PanelScrollbar overlays it instead.
  const main = useRef<HTMLElement>(null);
  const navigate = useNavigate();
  const router = useRouter();
  const pathname = useLocation({ select: (location) => location.pathname });

  // Warm the destination WHILE the exit plays: routes are code-split, so on a slow connection the
  // commit could otherwise wait on the chunk and flash the router's pending loader between exit and
  // enter. The exit (~0.3s) is a free download window. Best-effort — a failed preload just means
  // the navigation itself loads the chunk, as before.
  const preload = useCallback(
    // The cast: PanelPath includes RESOLVED param paths (`/panel/productos/7`), which the router
    // handles at runtime but TanStack's typed `to` can't express (it only knows `$productId`).
    (to: PanelPath) => void router.preloadRoute({ to: to as never }).catch(() => {}),
    [router],
  );
  // The controller compares intents against the CURRENT pathname when a click lands or an exit
  // resolves — a ref avoids stale closures (e.g. browser back racing an in-flight exit). Synced in
  // a layout effect (never during render), which still commits before any user event can read it.
  const pathnameRef = useRef(pathname);
  useLayoutEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  // The current page's custom motion, if it registered one. Its presence also means the page owns
  // its ENTRANCE, so the default body-in below is skipped for it. `registerMotion` is stable so the
  // registration effect in child pages runs once (see `usePanelPageMotion`).
  const customMotion = useRef<PanelPageMotion | null>(null);
  const registerMotion = useCallback((motion: PanelPageMotion | null) => {
    customMotion.current = motion;
  }, []);

  // The in-flight tab transition (null when idle) + its published mirror for the chrome: the
  // sidebar glides its active pill/tint to `pending` the moment a click lands, and back home if
  // the move is cancelled. The ref is the synchronous truth the controller decides with; the state
  // is what re-renders consumers.
  const exitRef = useRef<ExitRun | null>(null);
  const [pending, setPending] = useState<PanelPath | null>(null);

  // The header title animates IN on navigation but not on the first mount — the chrome mount
  // timeline already reveals the whole header (title included) then.
  const firstTitleIn = useRef(true);

  // CHROME-only entrance on mount: the sidebar and header settle in from their edges and the nav
  // items stagger in. The content BODY is intentionally NOT animated here — the route-commit
  // effect (below) owns it, and runs on the first load too, so a fresh load reveals the content the
  // same way a tab change does. On mobile `.panel-sidebar` doesn't exist (the drawer is hidden), so
  // it's skipped. Gated behind `prefers-reduced-motion: no-preference`; `gsap.matchMedia` is
  // reverted by `useGSAP`.
  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add('(prefers-reduced-motion: no-preference)', () => {
        gsap
          .timeline({ defaults: { ease: 'power3.out' } })
          .from('.panel-sidebar', { x: -24, opacity: 0, duration: 0.5 }, 0)
          .from('.panel-header', { y: -20, opacity: 0, duration: 0.45 }, 0.07)
          .from('.panel-nav-item', { x: -12, opacity: 0, duration: 0.35, stagger: 0.05, clearProps: 'transform' }, 0.17);
      });
    },
    { scope: container },
  );

  // The current page's exit — its own registered one, or the default body-out. Used identically by
  // BOTH a tab change and logout, so a page always leaves the same way regardless of the trigger.
  const runContentExit = useCallback((): Promise<void> => {
    const motion = customMotion.current;
    if (motion) return motion.exit();
    const element = screen.current;
    /* v8 ignore next -- the content-body ref is always attached while runContentExit runs; the empty-resolve fallback is defensive */
    return element ? fadeOut(element) : Promise.resolve();
  }, []);

  // Settle the CURRENT page back in — the cancel path (re-clicking the active tab mid-exit) and the
  // route-commit entrance share this. `fromCurrent` resumes from wherever the cut exit left the
  // elements; `overwrite: true` inside the motion helpers is what actually cuts the exit tweens.
  const enterCurrent = useCallback((options?: EnterOptions) => {
    const motion = customMotion.current;
    const element = screen.current;
    /* v8 ignore next -- the content-body ref is always attached while enterCurrent runs; the no-element fallback is defensive */
    if (motion) motion.enter(options); else if (element) fadeIn(element, options);
    headerTitleIn(options);
  }, []);

  // FULL exit (logout): the page's own exit plays, and the chrome peels away around it (nav items,
  // then header, then sidebar, then a final wash). Resolves when everything is done (or immediately
  // for reduced motion) so the caller can navigate to login, where it plays its own mount-in. Any
  // in-flight TAB transition is abandoned first (its run token is detached, so its completion
  // handler no-ops) — logout owns the departure from here on.
  const runExit = useCallback(() => {
    exitRef.current = null;
    setPending(null);
    const root = container.current;
    if (!root || prefersReducedMotion()) return Promise.resolve();
    const chrome = new Promise<void>((resolve) => {
      gsap
        .timeline({ defaults: { ease: 'power2.in', overwrite: 'auto' }, onComplete: resolve })
        .to('.panel-nav-item', { x: -12, autoAlpha: 0, duration: 0.22, stagger: { each: 0.03, from: 'end' } }, 0)
        .to('.panel-header', { y: -20, autoAlpha: 0, duration: 0.26 }, 0.08)
        .to('.panel-sidebar', { x: -24, autoAlpha: 0, duration: 0.3 }, 0.1)
        .to(root, { autoAlpha: 0, duration: 0.28 }, 0.18);
    });
    return Promise.all([runContentExit(), chrome]).then(() => undefined);
  }, [runContentExit]);

  // A tab change — the interruptible transition controller. ONE transition at a time, LATEST intent
  // wins; nothing blocks, queues, or restarts:
  //   - idle click            → play the exit (content + header title), then navigate to the intent.
  //   - mid-exit, new target  → swap the run's destination; the running exit continues untouched
  //                             (it's already heading to the right visual state).
  //   - mid-exit, current tab → CANCEL: detach the run token and settle the content back in from
  //                             the current frame (`fromCurrent`) — no navigation.
  //   - mid-enter, new target → a fresh exit starts; `overwrite: true` in the motion helpers cuts
  //                             the entrance at the current frame and drives to the exit target.
  //   - mid-enter, current tab / idle on the active tab → no-op (already there / already arriving).
  // `viewTransition: false` is ESSENTIAL: the router defaults to the browser's View Transition
  // cross-fade, which would fight the GSAP timelines (the old "flash of the previous page" glitch).
  // Reduced motion just jumps. The anti-flash invariant: the exit's final state (autoAlpha: 0)
  // persists untouched until React unmounts the page — nothing reverts opacity after an exit ends.
  const navigateBody = useCallback(
    (to: PanelPath) => {
      if (prefersReducedMotion()) {
        // Same resolved-param-path cast as `preload`.
        if (to !== pathnameRef.current) void navigate({ to: to as never, viewTransition: false });
        return;
      }
      const run = exitRef.current;
      if (run) {
        if (to === pathnameRef.current) {
          // Cancel: cut the exit where it stands and settle back in. Detaching the token first
          // makes the in-flight exit's completion handler a no-op. (`enterCurrent`'s title-in is a
          // visual no-op when this run never took the title out — `fromCurrent` resumes a tween
          // from the current, already-settled state.)
          exitRef.current = null;
          setPending(null);
          enterCurrent({ fromCurrent: true });
        } else {
          // Retarget: same exit, new destination. If the original target shared the leaving page's
          // section (title held still) but the NEW one doesn't, the title exits now — late, but in
          // step with the still-running content exit.
          run.pending = to;
          if (!run.titleOut && panelSectionFor(pathnameRef.current) !== panelSectionFor(to)) {
            run.titleOut = true;
            void headerTitleOut();
          }
          setPending(to);
          preload(to);
        }
        return;
      }
      if (to === pathnameRef.current) return;
      // The route this run is leaving FROM. Only an EXTERNAL commit (browser back/forward — our
      // own navigate hasn't fired yet) can change the pathname while the exit plays; if one does,
      // the pop is the NEWER intent and must win (see the completion guard below).
      const fromPath = pathnameRef.current;
      // The header title is the SECTION's name — it only animates when the section changes
      // (products grid → product detail keeps "Productos" perfectly still).
      const sectionChanges = panelSectionFor(fromPath) !== panelSectionFor(to);
      const newRun: ExitRun = { pending: to, titleOut: sectionChanges };
      exitRef.current = newRun;
      setPending(to);
      preload(to);
      // Leaving: the content body (and, on a section change, the header title) exit together,
      // THEN we navigate — so the header is in lock-step with the content instead of popping
      // after the swap.
      void Promise.all([
        runContentExit(),
        ...(sectionChanges ? [headerTitleOut()] : []),
      ]).then(() => {
        if (exitRef.current !== newRun) return; // cancelled or superseded (logout) — abandon
        exitRef.current = null;
        setPending(null);
        // A history commit landed mid-exit: the popped page has already entered (the commit
        // effect played its entrance + title-in), so navigating now would stomp the user's back/
        // forward press with an abrupt swap — or push a duplicate entry when the pop landed on
        // this very destination. Abandon; the pop is the latest intent.
        if (pathnameRef.current !== fromPath) return;
        // Same resolved-param-path cast as `preload`.
        void navigate({ to: newRun.pending as never, viewTransition: false });
      });
    },
    [navigate, runContentExit, enterCurrent, preload],
  );

  // Entering, run every time a panel route commits: the incoming header title slides in (in step
  // with the content entrance), and the default body-in runs UNLESS the page owns its own entrance
  // (custom motion, played by the page itself on mount). The child's registration effect runs
  // before this parent effect, so `customMotion.current` is already set for the incoming page here.
  // The header title-in is skipped on the very first mount (the chrome mount timeline reveals it)
  // AND on same-SECTION commits (grid → detail keeps the same title — it never left, see
  // `navigateBody`; this also covers history pops within a section).
  const prevPanelPathname = useRef(pathname);
  useLayoutEffect(() => {
    const from = prevPanelPathname.current;
    prevPanelPathname.current = pathname;
    if (!screen.current || !pathname.startsWith('/panel')) return;
    if (!customMotion.current) fadeIn(screen.current);
    if (firstTitleIn.current) {
      firstTitleIn.current = false;
      return;
    }
    if (panelSectionFor(from) === panelSectionFor(pathname)) return;
    headerTitleIn();
  }, [pathname]);

  const nav = useMemo<PanelNav>(() => ({ navigateTo: navigateBody, pending }), [navigateBody, pending]);

  return (
    <PanelExitContext.Provider value={runExit}>
      <PanelNavContext.Provider value={nav}>
        <PanelPageTransitionContext.Provider value={registerMotion}>
          <div ref={container} className="panel-root flex h-dvh w-full overflow-hidden bg-customWhite">
            <ForcedLogoutListener />
            <Sidebar />
            <div className="flex min-w-0 flex-1 flex-col">
              <Header />
              {/* The relative box scopes the overlay scrollbar to the CONTENT area only (never the
                  header); `min-h-0` lets the flex child actually shrink so `main` scrolls. */}
              <div className="relative min-h-0 flex-1">
                {/* BEFORE the scroller on purpose: its restore-on-commit layout effect must run
                    before any page's own effects (always-top pages override it and win). */}
                <PanelScrollMemory target={main} />
                <main
                  ref={main}
                  className="panel-main no-native-scrollbar h-full overflow-y-auto bg-gradient-to-b from-[#f8f5f8] to-[#f0ecf1]"
                >
                  {/* The gradient fills the full viewport width, but the content itself is clamped and
                      centered so it stays readable on ultrawide monitors (chrome edge-to-edge, content
                      capped). Padding lives on this inner wrapper so it doubles as the side gutter. The
                      `panel-screen` wrapper is the element the default transition animates. */}
                  <div
                    ref={screen}
                    className="panel-screen mx-auto flex min-h-full w-full max-w-[var(--spacing-panel-content)] flex-col p-4 md:p-6 lg:p-8"
                  >
                    <Outlet />
                  </div>
                </main>
                <OverlayScrollbar target={main} />
              </div>
            </div>
          </div>
        </PanelPageTransitionContext.Provider>
      </PanelNavContext.Provider>
    </PanelExitContext.Provider>
  );
};

// The panel is open to EVERY authenticated role (Client, Driver, Admin). The shell doesn't gate by
// role — sections do: the products routes bounce a Driver (Epic-2A) and the sidebar derives its
// tabs from `filterNavByRole`, while capabilities WITHIN shared views use `RoleGate`/`useHasRole`
// (e.g. only Admin sees "add product"). The route guard (`routes/panel.tsx`) only requires a valid
// session; the backend re-checks roles on every endpoint (the real boundary).
const PanelLayout: React.FC = () => (
  <PanelChromeProvider>
    <PanelShell />
  </PanelChromeProvider>
);

export default PanelLayout;
