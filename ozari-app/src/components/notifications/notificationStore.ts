import { create } from 'zustand';
import { DEFAULT_DURATION, type NotificationVariant } from './notificationConfig';

/** What a caller passes to raise a notification. Only `message` is required. */
export interface NotificationInput {
  message: string;
  /** Short tab title. Falls back to the variant default when omitted. */
  title?: string;
  /** Defaults to `success`. */
  variant?: NotificationVariant;
  /** Override the variant's principal color (any CSS color). */
  color?: string;
  /** ms before auto-dismiss. `0` keeps it until dismissed. Defaults to {@link DEFAULT_DURATION}. */
  duration?: number;
  /**
   * Cap on how wide the toast may grow. Below it the toast is fit-content; at it the
   * message wraps to multiple lines. Number = px, string = any CSS length.
   * Defaults to {@link DEFAULT_MAX_WIDTH}. Ignored when `width` is set.
   */
  maxWidth?: number | string;
  /**
   * Force a fixed width instead of fit-content (the message wraps within it).
   * Number = px, string = any CSS length. Overrides `maxWidth`.
   */
  width?: number | string;
}

/** A live notification held in the store. */
export interface NotificationItem extends NotificationInput {
  id: string;
  variant: NotificationVariant;
  duration: number;
}

interface NotificationState {
  notifications: NotificationItem[];
  /** Enqueue a notification. Returns its id so callers can dismiss it early. */
  push: (input: NotificationInput) => string;
  /** Remove a notification from the queue (called by the toast after its exit animation). */
  dismiss: (id: string) => void;
  /** Remove everything (e.g. on logout / hard route reset). */
  clear: () => void;
}

let counter = 0;
const genId = (): string => `ntf-${Date.now().toString(36)}-${(counter++).toString(36)}`;

/**
 * Single global queue for transient notifications. This is the only piece of
 * client state the toast layer needs; the visual lifecycle (timers, animation)
 * lives in the toast component so this stays a plain, testable data store.
 */
export const useNotificationStore = create<NotificationState>((set) => ({
  notifications: [],
  push: (input) => {
    const id = genId();
    const item: NotificationItem = {
      ...input,
      id,
      variant: input.variant ?? 'success',
      duration: input.duration ?? DEFAULT_DURATION,
    };
    set((state) => ({ notifications: [...state.notifications, item] }));
    return id;
  },
  dismiss: (id) =>
    set((state) => ({ notifications: state.notifications.filter((n) => n.id !== id) })),
  clear: () => set({ notifications: [] }),
}));
