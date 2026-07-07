import { create } from 'zustand';

/**
 * State for the single top-of-everything app overlay. It's a simple **active** flag: the overlay is
 * raised for any whole-app blocking failure — a **backend outage** (interceptor sees a 502/503/504)
 * or the browser going **offline** (an `offline` event). Which of the two is *displayed* is derived
 * live from `navigator.onLine` inside the overlay, so an offline→(reconnect, server-still-down)
 * transition switches copy automatically without extra state here.
 *
 * This is a **global** piece of client state (like notifications) — the session teardown must NOT
 * clear it.
 */
interface AppOverlayState {
  active: boolean;
  activate: () => void;
  deactivate: () => void;
}

export const useOutageStore = create<AppOverlayState>((set) => ({
  active: false,
  activate: () => set((state) => (state.active ? state : { active: true })),
  deactivate: () => set({ active: false }),
}));

/** Imperative helpers usable from outside React (the interceptor). */
export const reportOutage = (): void => useOutageStore.getState().activate();
export const isOutageActive = (): boolean => useOutageStore.getState().active;
