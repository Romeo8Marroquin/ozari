import React from 'react';
import { createPortal } from 'react-dom';
import NotificationToast from './NotificationToast';
import { useNotificationStore } from './notificationStore';

/**
 * The single, app-wide floating notification layer. Mounted once at the router root
 * so it renders on every page (login, landing, panel, …). See README.md in this
 * folder: this is the ONLY out-of-the-box floating overlay — anything new that floats
 * must be coordinated against it (z-index + pointer-events) to avoid layout fights.
 *
 * **Top-RIGHT at every width** (owner, 2026-08-31). It used to centre itself below `sm`,
 * which looked defensible in a simulator and wrong on a real phone: the toast floated in
 * the middle of the screen, anchored to nothing, its pill pointing at one edge while the
 * body pointed at neither. A notification comes from the same corner on every device now,
 * so where it appears is a fact the user learns once. The equal margins the mobile centring
 * was really providing come from this container's padding instead, which is symmetric by
 * construction.
 *
 * The column is `w-full` under a max width, so the toast's own cap resolves against the
 * SPACE ACTUALLY AVAILABLE (see `NotificationToast`'s width policy): wide screens get the
 * designed maximum, narrow ones get the viewport minus these margins and wrap into more
 * lines. `min-w-0` because a long unbreakable string in a message must wrap rather than
 * widen the column (the repo's truncation rule).
 *
 * The whole stack is `pointer-events-none` (container AND per-toast wrappers) so it never
 * blocks the page; each toast re-enables `pointer-events` ONLY on its clipped glass
 * surface, so the transparent corner beside the pill stays click-through.
 */
const NotificationHost: React.FC = () => {
  const notifications = useNotificationStore((state) => state.notifications);

  /* v8 ignore next -- SSR guard; `document` always exists under jsdom/browser */
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[var(--z-notification)] flex justify-end p-4 sm:p-6">
      <div className="flex w-full min-w-0 max-w-[440px] flex-col items-end">
        {notifications.map((item) => (
          <div key={item.id} className="pointer-events-none flex w-full min-w-0 justify-end">
            <NotificationToast item={item} align="right" />
          </div>
        ))}
      </div>
    </div>,
    document.body,
  );
};

export default NotificationHost;
