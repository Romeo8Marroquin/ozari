import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import NotificationToast from './NotificationToast';
import { useNotificationStore } from './notificationStore';

const DESKTOP_QUERY = '(min-width: 640px)';

/**
 * The single, app-wide floating notification layer. Mounted once at the router root
 * so it renders on every page (login, landing, panel, …). See README.md in this
 * folder: this is the ONLY out-of-the-box floating overlay — anything new that floats
 * must be coordinated against it (z-index + pointer-events) to avoid layout fights.
 *
 * - Position: top-right on >=640px, top-center on mobile.
 * - The container is `pointer-events-none` so it never blocks the page; each toast
 *   re-enables `pointer-events` for its own click-to-dismiss.
 */
const NotificationHost: React.FC = () => {
  const notifications = useNotificationStore((state) => state.notifications);
  const [isDesktop, setIsDesktop] = useState(true);

  useEffect(() => {
    const mql = window.matchMedia(DESKTOP_QUERY);
    const update = () => setIsDesktop(mql.matches);
    update();
    mql.addEventListener('change', update);
    return () => mql.removeEventListener('change', update);
  }, []);

  if (typeof document === 'undefined') return null;

  const align = isDesktop ? 'right' : 'left';

  return createPortal(
    <div
      className={`pointer-events-none fixed inset-x-0 top-0 z-[1000] flex p-4 sm:p-6 ${
        isDesktop ? 'justify-end' : 'justify-center'
      }`}
    >
      <div className={`flex w-full max-w-[360px] flex-col ${isDesktop ? 'items-end' : 'items-center'}`}>
        {notifications.map((item) => (
          <div key={item.id} className="pointer-events-auto">
            <NotificationToast item={item} align={align} />
          </div>
        ))}
      </div>
    </div>,
    document.body,
  );
};

export default NotificationHost;
