import { useGSAP } from '@gsap/react';
import { Outlet, useLocation, useNavigate } from '@tanstack/react-router';
import gsap from 'gsap';
import { useCallback, useLayoutEffect, useRef } from 'react';
import Header from './components/Header';
import Sidebar from './components/Sidebar';
import type { PanelPath } from './navConfig';
import { PanelChromeProvider } from './hooks/usePanelChrome';
import { PanelExitContext } from './PanelExitContext';
import { PanelNavContext } from './PanelNavContext';
import { PanelPageTransitionContext, type PanelExitAnimation } from './PanelPageTransitionContext';

const prefersReducedMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// The DEFAULT body transition — a simple fade + rise / fade + lift. It's the baseline for pages that
// don't ship their own animation (the not-yet-built placeholders). A page can fully override this by
// registering a custom exit (see `usePanelPageExit`) and running its own entrance on mount — Settings
// does exactly that. So "each page can have its own animation" while everything else stays polished.
const defaultContentIn = (element: HTMLElement): void => {
  gsap.killTweensOf(element);
  if (prefersReducedMotion()) {
    gsap.set(element, { autoAlpha: 1, y: 0 });
    return;
  }
  gsap.fromTo(element, { autoAlpha: 0, y: 16 }, { autoAlpha: 1, y: 0, duration: 0.45, ease: 'power3.out', overwrite: 'auto' });
};

const defaultContentOut = (element: HTMLElement): Promise<void> => {
  gsap.killTweensOf(element);
  if (prefersReducedMotion()) return Promise.resolve();
  return new Promise((resolve) => {
    gsap.to(element, { autoAlpha: 0, y: -16, duration: 0.18, ease: 'power2.in', overwrite: 'auto', onComplete: resolve });
  });
};

const PanelShell: React.FC = () => {
  const container = useRef<HTMLDivElement>(null);
  // The content body (wraps the <Outlet>) — the element the DEFAULT transition animates.
  const screen = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const pathname = useLocation({ select: (location) => location.pathname });

  // The current page's custom exit, if it registered one. Its presence also means the page owns its
  // ENTRANCE, so the default body-in below is skipped for it. `registerExit` is stable so the
  // registration effect in child pages runs once (see `usePanelPageExit`).
  const customExit = useRef<PanelExitAnimation | null>(null);
  const registerExit = useCallback((exit: PanelExitAnimation | null) => {
    customExit.current = exit;
  }, []);

  // CHROME-only entrance on mount: the sidebar and header settle in from their edges and the nav
  // items stagger in. The content BODY is intentionally NOT animated here — `contentIn` (below) owns
  // it, and runs on the first load too, so a fresh load reveals the content the same way a tab
  // change does. On mobile `.panel-sidebar` doesn't exist (the drawer is hidden), so it's skipped.
  // Gated behind `prefers-reduced-motion: no-preference`; `gsap.matchMedia` is reverted by `useGSAP`.
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
    const custom = customExit.current;
    if (custom) return custom();
    const element = screen.current;
    return element ? defaultContentOut(element) : Promise.resolve();
  }, []);

  // FULL exit (logout): the page's own exit plays, and the chrome peels away around it (nav items,
  // then header, then sidebar, then a final wash). Resolves when everything is done (or immediately
  // for reduced motion) so the caller can navigate to login, where it plays its own mount-in.
  const runExit = useCallback(() => {
    const root = container.current;
    if (!root || prefersReducedMotion()) return Promise.resolve();
    const chrome = new Promise<void>((resolve) => {
      gsap
        .timeline({ defaults: { ease: 'power2.in' }, onComplete: resolve })
        .to('.panel-nav-item', { x: -12, autoAlpha: 0, duration: 0.22, stagger: { each: 0.03, from: 'end' } }, 0)
        .to('.panel-header', { y: -20, autoAlpha: 0, duration: 0.26 }, 0.08)
        .to('.panel-sidebar', { x: -24, autoAlpha: 0, duration: 0.3 }, 0.1)
        .to(root, { autoAlpha: 0, duration: 0.28 }, 0.18);
    });
    return Promise.all([runContentExit(), chrome]).then(() => undefined);
  }, [runContentExit]);

  // A tab change: the page's exit plays, THEN the route commits and the incoming page plays its own
  // entrance — the same exit as logout, the same entrance as a fresh load. `viewTransition: false` is
  // ESSENTIAL: the router defaults to the browser's View Transition cross-fade, which would fight the
  // GSAP timelines (the old "flash of the previous page" glitch). No-op on the active tab; reduced
  // motion just jumps.
  const navigateBody = useCallback(
    (to: PanelPath) => {
      if (to === pathname) return;
      const go = () => void navigate({ to, viewTransition: false });
      if (prefersReducedMotion()) {
        go();
        return;
      }
      void runContentExit().then(go);
    },
    [navigate, pathname, runContentExit],
  );

  // The DEFAULT entrance, run every time a panel route commits (including the first) — UNLESS the
  // page registered a custom transition, in which case it owns its own entrance (run on its mount)
  // and we stay out of the way. The child's registration effect runs before this parent effect, so
  // `customExit.current` is already set for the incoming page here.
  useLayoutEffect(() => {
    if (!screen.current || !pathname.startsWith('/panel')) return;
    if (customExit.current) return;
    defaultContentIn(screen.current);
  }, [pathname]);

  return (
    <PanelExitContext.Provider value={runExit}>
      <PanelNavContext.Provider value={navigateBody}>
        <PanelPageTransitionContext.Provider value={registerExit}>
          <div ref={container} className="panel-root flex h-dvh w-full overflow-hidden bg-customWhite">
            <Sidebar />
            <div className="flex min-w-0 flex-1 flex-col">
              <Header />
              <main className="panel-main flex-1 overflow-y-auto bg-gradient-to-b from-[#f8f5f8] to-[#f0ecf1]">
                {/* The gradient fills the full viewport width, but the content itself is clamped and
                    centered so it stays readable on ultrawide monitors (chrome edge-to-edge, content
                    capped). Padding lives on this inner wrapper so it doubles as the side gutter. The
                    `panel-screen` wrapper is the element the default transition animates. */}
                <div
                  ref={screen}
                  className="panel-screen mx-auto w-full max-w-[var(--spacing-panel-content)] p-4 md:p-6 lg:p-8"
                >
                  <Outlet />
                </div>
              </main>
            </div>
          </div>
        </PanelPageTransitionContext.Provider>
      </PanelNavContext.Provider>
    </PanelExitContext.Provider>
  );
};

const PanelLayout: React.FC = () => (
  <PanelChromeProvider>
    <PanelShell />
  </PanelChromeProvider>
);

export default PanelLayout;
