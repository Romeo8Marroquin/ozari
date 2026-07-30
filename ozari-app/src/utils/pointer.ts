/**
 * Does this device drive with a MOUSE or trackpad?
 *
 * The one question behind every auto-focus decision in the app. Focusing a field on mount is a
 * welcome shortcut with a keyboard already under your hands; on touch it yanks the on-screen
 * keyboard up over half the screen the instant a dialog or a page appears — unasked, and often over
 * the very content that explains what you're being asked. So: focus on fine pointers, never on
 * touch. Matches the login/register behaviour that has always been right, generalized.
 *
 * A plain function (not a hook) so the modal primitive can ask inside an effect and React callers
 * can wrap it in `useDesktopAutoFocus` — one rule, one place, no copy that can drift.
 */
export const isFinePointerDevice = (): boolean =>
  typeof window !== 'undefined' &&
  window.matchMedia('(hover: hover) and (pointer: fine)').matches;
