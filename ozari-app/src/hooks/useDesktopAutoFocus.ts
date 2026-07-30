import { useState } from 'react';
import { isFinePointerDevice } from '@utils/pointer';

/**
 * Whether auto-focusing the first field is appropriate on this device — the React face of
 * {@link isFinePointerDevice}, evaluated once on mount so it stays stable across re-renders.
 *
 * True only on hover + fine-pointer devices (desktop/laptop with a mouse or trackpad), where
 * focusing a field on mount is a welcome shortcut. False on touch, where auto-focus pops the
 * on-screen keyboard over half the screen and breaks entrance animations (notably on Android).
 *
 * Every form that focuses a field on mount goes through this — the auth pages, the MFA code field
 * (in or out of a dialog), the forgot-password step. Dialogs get it for free: `Modal` applies the
 * same rule to `[data-modal-autofocus]` itself.
 */
export default function useDesktopAutoFocus(): boolean {
  const [shouldAutoFocus] = useState(isFinePointerDevice);

  return shouldAutoFocus;
}
