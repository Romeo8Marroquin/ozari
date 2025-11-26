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
      gsap.from(container.current, {
        opacity: 0,
        duration: 0.3,
        ease: 'power1.in',
      });
      gsap.from('.transition-container', {
        y: 20,
        opacity: 0,
        transform: 'scale(0.9)',
        duration: 0.5,
        ease: 'power3.out',
      });
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
        <main className="flex flex-col h-full p-6 overflow-y-auto bg-blue-500">
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default PanelLayout;
