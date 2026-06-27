import { useGSAP } from '@gsap/react';
import { Outlet } from '@tanstack/react-router';
import gsap from 'gsap';
import { useRef } from 'react';
import Header from './components/Header';
import Sidebar from './components/Sidebar';

const PanelLayout: React.FC = () => {
  const container = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      if (!container.current) return;

      // Create a smooth fade-in sequence that complements the login fade-out
      const tl = gsap.timeline({ defaults: { ease: 'power2.out' } });

      // Start with container fade-in
      tl.from(container.current, {
        opacity: 0,
        duration: 0.4,
      });

      // Sidebar slides in from left
      tl.from(
        '.panel-sidebar',
        {
          x: -50,
          opacity: 0,
          duration: 0.5,
        },
        '-=0.2', // Start slightly before container finishes
      );

      // Header slides in from top
      tl.from(
        '.panel-header',
        {
          y: -30,
          opacity: 0,
          duration: 0.5,
        },
        '<+0.1', // Start slightly after sidebar
      );

      // Main content fades in with subtle scale
      tl.from(
        '.panel-main',
        {
          y: 20,
          opacity: 0,
          scale: 0.98,
          duration: 0.6,
        },
        '<+0.1', // Start slightly after header
      );
    },
    { scope: container },
  );

  return (
    <div
      ref={container}
      className="relative overflow-hidden w-full min-h-screen flex bg-customWhite"
    >
      <Sidebar />
      <div className="flex flex-col flex-1 overflow-y-hidden">
        <Header />
        <main className="panel-main flex flex-col h-full p-6 overflow-y-auto bg-blue-500">
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default PanelLayout;
