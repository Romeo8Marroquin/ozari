import { useLayoutEffect, useRef, useState } from 'react';
import { gsap } from 'gsap';
import useBreakpoint from './useBreakpoint';

/**
 * Animates the rotational asset smoothly when breakpoint changes
 * between mobile and desktop layouts
 *
 * @param variant - 'login' or 'register' to determine rotation direction
 */
const useRotationalAssetAnimation = (variant: 'login' | 'register' = 'login') => {
  const { breakpoint } = useBreakpoint();
  const previousBreakpointRef = useRef<string | null>(null);
  const rotationalAssetRef = useRef<HTMLDivElement>(null);
  const [isInitialized, setIsInitialized] = useState(false);

  useLayoutEffect(() => {
    // Early return if no breakpoint or ref yet
    if (!breakpoint || !rotationalAssetRef.current) return;

    // Skip initial render - just set the initialized flag
    if (!isInitialized) {
      previousBreakpointRef.current = breakpoint;
      setIsInitialized(true);
      return;
    }

    const isMobileNow = breakpoint === 'base' || breakpoint === 'sm';
    const wasMobileBefore =
      previousBreakpointRef.current === 'base' || previousBreakpointRef.current === 'sm';

    // Only animate on actual breakpoint transition (mobile ↔ desktop)
    // Skip if previousBreakpoint is null (shouldn't happen after initialization)
    if (previousBreakpointRef.current !== null && isMobileNow !== wasMobileBefore) {
      const isLogin = variant === 'login';

      if (isMobileNow) {
        // Transitioning to mobile: animate to mobile position
        gsap.to(rotationalAssetRef.current, {
          rotation: isLogin ? -15 : 15,
          transformOrigin: 'bottom center',
          x: '0%',
          y: '-58.333333%', // -translate-y-7/12 = -58.333%
          width: '150%',
          height: '110%',
          duration: 0.6,
          ease: 'power2.inOut',
        });
      } else {
        // Transitioning to desktop: animate to desktop position
        gsap.to(rotationalAssetRef.current, {
          rotation: isLogin ? -15 : 15,
          transformOrigin: isLogin ? 'right center' : 'left center',
          x: isLogin ? '-50%' : '50%',
          y: '0%',
          width: '110%',
          height: '150%',
          duration: 0.6,
          ease: 'power2.inOut',
        });
      }
    }

    previousBreakpointRef.current = breakpoint;
  }, [breakpoint, variant, isInitialized]);

  return rotationalAssetRef;
};

export default useRotationalAssetAnimation;
