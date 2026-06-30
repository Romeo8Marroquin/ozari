import { useState } from 'react';

/**
 * Whether auto-focusing the first field is appropriate on this device.
 *
 * True only on hover + fine-pointer devices (desktop/laptop with a mouse or trackpad),
 * where focusing a field on mount is a welcome shortcut. False on touch devices, where
 * auto-focus pops the on-screen keyboard and breaks the login↔register entrance
 * animation (notably on Android). Evaluated once on mount, so it stays stable.
 */
export default function useDesktopAutoFocus(): boolean {
  const [shouldAutoFocus] = useState(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia('(hover: hover) and (pointer: fine)').matches,
  );

  return shouldAutoFocus;
}
