import { useGSAP } from '@gsap/react';
import { Outlet } from '@tanstack/react-router';
import gsap from 'gsap';
import { useRef } from 'react';
import Header from './components/Header';
import Sidebar from './components/Sidebar';
import { PanelChromeProvider } from './hooks/usePanelChrome';

const PanelShell: React.FC = () => {
  const container = useRef<HTMLDivElement>(null);

  // One-time entrance, in the same smooth/harmonious spirit as the auth pages: the chrome
  // settles in from its edges, then the nav items and content stagger in. Runs once when the
  // panel mounts (the layout persists across child-route changes). On mobile `.panel-sidebar`
  // doesn't exist (the drawer is hidden), so those targets are simply skipped.
  useGSAP(
    () => {
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
    },
    { scope: container },
  );

  return (
    <div ref={container} className="flex h-dvh w-full overflow-hidden bg-customWhite">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header />
        <main className="panel-main flex-1 overflow-y-auto bg-gradient-to-b from-[#f8f5f8] to-[#f0ecf1] p-4 md:p-6 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
};

const PanelLayout: React.FC = () => (
  <PanelChromeProvider>
    <PanelShell />
  </PanelChromeProvider>
);

export default PanelLayout;
