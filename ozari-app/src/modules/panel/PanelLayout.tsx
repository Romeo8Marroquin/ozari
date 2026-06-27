import { useGSAP } from '@gsap/react';
import { Outlet } from '@tanstack/react-router';
import gsap from 'gsap';
import { useRef } from 'react';
import Header from './components/Header';
import Sidebar from './components/Sidebar';
import { notify } from '@components/notifications/notify';
import type { NotificationVariant } from '@components/notifications/notificationConfig';

// --- DEMO: throwaway control to exercise the notification layer. Safe to delete. ---
const DEMO_NOTIFICATIONS: { variant: NotificationVariant; title: string; message: string }[] = [
  { variant: 'success', title: 'Guardado', message: 'Los cambios se guardaron correctamente.' },
  { variant: 'error', title: 'Algo salió mal', message: 'No pudimos completar la acción. Inténtalo de nuevo.' },
  { variant: 'warning', title: 'Atención', message: 'Tu sesión está por expirar en unos minutos.' },
  { variant: 'info', title: 'Novedad', message: 'Hay una nueva función disponible en el panel.' },
];

const pushRandomNotification = (): void => {
  const pick = DEMO_NOTIFICATIONS[Math.floor(Math.random() * DEMO_NOTIFICATIONS.length)];
  notify.push({ ...pick, duration: 4000 + Math.floor(Math.random() * 3000) });
};

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
          {/* DEMO: throwaway button to test the notification layer. Safe to delete. */}
          <button
            type="button"
            onClick={pushRandomNotification}
            className="mb-6 w-fit cursor-pointer rounded-md bg-white px-4 py-2 text-sm font-semibold text-midnight shadow-md transition-all hover:shadow-lg active:scale-95"
          >
            Lanzar notificación aleatoria
          </button>
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default PanelLayout;
