/**
 * TEMPORARY on-device debug log. Enabled only when the URL has `?debug` (e.g.
 * `http://192.168.x.x:5173/sesion/inicio?debug`), so it never shows in normal use. Lets us see
 * what actually happens on a real phone — where there's no console — by rendering a log overlay
 * (see DebugOverlay) and capturing thrown errors / unhandled rejections. Remove once the mobile
 * login issue is diagnosed.
 */
type Listener = () => void;

const lines: string[] = [];
const listeners = new Set<Listener>();
let enabled: boolean | null = null;
let errorsHooked = false;
// Bumped on every change so useSyncExternalStore sees a NEW snapshot (the `lines` array is
// mutated in place, so its reference alone never signals a change).
let version = 0;

function safeStringify(value: unknown): string {
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (typeof value === 'object' && value !== null) {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

export function isDebugEnabled(): boolean {
  if (enabled === null) {
    enabled =
      typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('debug');
    if (enabled) hookGlobalErrors();
  }
  return enabled;
}

function hookGlobalErrors(): void {
  if (errorsHooked || typeof window === 'undefined') return;
  errorsHooked = true;
  window.addEventListener('error', (event) => {
    dlog('window.error:', event.message, `@${event.filename}:${event.lineno}`);
  });
  window.addEventListener('unhandledrejection', (event) => {
    dlog('unhandledrejection:', safeStringify(event.reason));
  });
}

export function dlog(...args: unknown[]): void {
  if (!isDebugEnabled()) return;
  const time = new Date().toLocaleTimeString();
  lines.push(`${time}  ${args.map(safeStringify).join(' ')}`);
  if (lines.length > 200) lines.shift();
  version += 1;
  listeners.forEach((listener) => listener());
}

export function clearDebug(): void {
  lines.length = 0;
  version += 1;
  listeners.forEach((listener) => listener());
}

export function getDebugLines(): string[] {
  return lines;
}

export function getDebugVersion(): number {
  return version;
}

export function subscribeDebug(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
