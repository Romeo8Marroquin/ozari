import { useGSAP } from '@gsap/react';
import { Outlet } from '@tanstack/react-router';
import gsap from 'gsap';
import { useCallback, useRef } from 'react';
import Header from './components/Header';
import Sidebar from './components/Sidebar';
import { PanelChromeProvider } from './hooks/usePanelChrome';
import { PanelExitContext } from './PanelExitContext';

const PanelShell: React.FC = () => {
  const container = useRef<HTMLDivElement>(null);

  // One-time entrance, in the same smooth/harmonious spirit as the auth pages: the chrome
  // settles in from its edges, then the nav items and content stagger in. Runs once when the
  // panel mounts (the layout persists across child-route changes). On mobile `.panel-sidebar`
  // doesn't exist (the drawer is hidden), so those targets are simply skipped.
  // Gated behind `prefers-reduced-motion: no-preference` — for reduced-motion users the timeline
  // never runs, so the `.from()` start states are never applied and the chrome simply appears at
  // rest. `gsap.matchMedia` is reverted automatically by `useGSAP` on unmount.
  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add('(prefers-reduced-motion: no-preference)', () => {
        const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });
        tl.from(container.current, { opacity: 0, duration: 0.35 })
          .from('.panel-sidebar', { x: -24, opacity: 0, duration: 0.5 }, 0.05)
          .from('.panel-header', { y: -20, opacity: 0, duration: 0.45 }, 0.12)
          .from('.panel-main', { y: 16, opacity: 0, duration: 0.5 }, 0.18)
          .from(
            '.panel-nav-item',
            { x: -12, opacity: 0, duration: 0.35, stagger: 0.05, clearProps: 'transform' },
            0.22,
          );
      });
    },
    { scope: container },
  );

  // The mirror of the entrance, in reverse order (content out first, chrome last): the nav items
  // and main slide/fade away, then the header lifts, the sidebar slides left, and finally the whole
  // frame fades — so the panel "leaves the way it arrived". Resolves when finished (or immediately
  // for reduced-motion) so the caller can then navigate to login.
  const runExit = useCallback(
    () =>
      new Promise<void>((resolve) => {
        const root = container.current;
        const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (!root || reduce) {
          resolve();
          return;
        }
        const tl = gsap.timeline({ defaults: { ease: 'power2.in' }, onComplete: resolve });
        tl.to('.panel-nav-item', { x: -12, autoAlpha: 0, duration: 0.22, stagger: { each: 0.03, from: 'end' } }, 0)
          .to('.panel-main', { y: 16, autoAlpha: 0, duration: 0.26 }, 0.04)
          .to('.panel-header', { y: -20, autoAlpha: 0, duration: 0.26 }, 0.08)
          .to('.panel-sidebar', { x: -24, autoAlpha: 0, duration: 0.3 }, 0.1)
          .to(root, { autoAlpha: 0, duration: 0.28 }, 0.18);
      }),
    [],
  );

  return (
    <PanelExitContext.Provider value={runExit}>
      <div ref={container} className="panel-root flex h-dvh w-full overflow-hidden bg-customWhite">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <Header />
          <main className="panel-main flex-1 overflow-y-auto bg-gradient-to-b from-[#f8f5f8] to-[#f0ecf1]">
            {/* The gradient fills the full viewport width, but the content itself is clamped and
                centered so it stays readable on ultrawide monitors (chrome edge-to-edge, content
                capped). Padding lives on this inner wrapper so it doubles as the side gutter. */}
            <div className="mx-auto w-full max-w-[var(--spacing-panel-content)] p-4 md:p-6 lg:p-8">
              <Outlet />
            </div>
          </main>
        </div>
      </div>
    </PanelExitContext.Provider>
  );
};

const PanelLayout: React.FC = () => (
  <PanelChromeProvider>
    <PanelShell />
  </PanelChromeProvider>
);

export default PanelLayout;
