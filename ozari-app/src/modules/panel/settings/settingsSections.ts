import type { PanelPath } from '../navConfig';
import { bringIntoPanelView } from '../pageMotion';

/**
 * The Ajustes sections something outside the page can send the user to — today, the header menu's
 * "Mi perfil" (the account card IS the profile) and "Seguridad". Each is a `SettingsSection` given
 * the matching `anchor`.
 */
export type SettingsAnchor = 'account' | 'security';

/**
 * How long a request to land on a section stays good. Long enough to survive the panel's exit
 * transition and a cold, code-split route load; short enough that a navigation the user CANCELLED
 * (re-clicking the tab they were leaving) cannot surface seconds later as an unexplained jump the
 * next time they open Ajustes from the sidebar.
 */
const INTENT_TTL_MS = 4000;

/** One-shot, module-level — the same shape as `productsScroll`'s saved grid position: it has to
 *  outlive the page that set it, because the page that reads it does not exist yet. */
let pending: { anchor: SettingsAnchor; at: number } | null = null;

const sectionFor = (anchor: SettingsAnchor): HTMLElement | null =>
  document.querySelector<HTMLElement>(`[data-settings-section="${anchor}"]`);

/** Frames to wait for a section to become focusable (~1s at 60fps) before giving up quietly. */
const FOCUS_WAIT_FRAMES = 60;

/**
 * Move focus to the section once it can actually take it.
 *
 * Never on the same tick: the menu that sent us returns focus to its trigger as it closes, right
 * after this is called, and would take it straight back. And never while the section is
 * `visibility: hidden` — which is exactly what it is at the start of the Ajustes entrance (it fades
 * in from `autoAlpha: 0`), so a focus on the first frame after mounting was silently refused and
 * the user was left on the menu button (measured, 2026-10-09).
 */
function focusWhenShown(section: HTMLElement, framesLeft = FOCUS_WAIT_FRAMES): void {
  requestAnimationFrame(() => {
    if (getComputedStyle(section).visibility === 'hidden' && framesLeft > 0) {
      focusWhenShown(section, framesLeft - 1);
      return;
    }
    section.focus({ preventScroll: true });
  });
}

/** Scroll the section in (only if it is not already fully on screen) and move focus to it, so a
 *  keyboard or screen-reader user arrives where they asked to go instead of back on the menu. */
function reveal(section: HTMLElement, smooth: boolean): void {
  bringIntoPanelView(section, { smooth });
  focusWhenShown(section);
}

/**
 * Send the user to one section of Ajustes, from anywhere in the panel.
 *
 * It ALWAYS goes through the panel navigation, which already knows every case: from another page it
 * plays the normal exit → enter; already on Ajustes it does nothing; and mid-exit FROM Ajustes it
 * cancels the exit and settles the page back. So whenever the page is still here, the section is
 * revealed in place, smoothly. Otherwise the request waits for the page to mount and claim it with
 * {@link revealPendingSettingsSection}.
 */
export function openSettingsSection(
  anchor: SettingsAnchor,
  navigate: (to: PanelPath) => void,
): void {
  navigate('/panel/ajustes');
  const section = sectionFor(anchor);
  if (section) {
    pending = null;
    reveal(section, true);
    return;
  }
  pending = { anchor, at: Date.now() };
}

/**
 * Called once by the Ajustes page as it mounts, BEFORE its entrance: if it was opened to a section,
 * jump there instantly (pre-paint), so the entrance plays in place and the scroll is never seen.
 * Consumes the request either way.
 */
export function revealPendingSettingsSection(): void {
  const intent = pending;
  pending = null;
  if (!intent || Date.now() - intent.at > INTENT_TTL_MS) return;
  const section = sectionFor(intent.anchor);
  if (section) reveal(section, false);
}
