import { useState, useLayoutEffect } from 'react';

const tailwindBreakpoints = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  '2xl': 1536,
};

const useBreakpoint = () => {
  const [breakpoint, setBreakpoint] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState<boolean>();

  useLayoutEffect(() => {
    const determineBreakpoint = () => {
      let currentBreakpoint = 'base';
      if (globalThis.matchMedia(`(min-width: ${tailwindBreakpoints['2xl']}px)`).matches) {
        currentBreakpoint = '2xl';
      } else if (globalThis.matchMedia(`(min-width: ${tailwindBreakpoints['xl']}px)`).matches) {
        currentBreakpoint = 'xl';
      } else if (globalThis.matchMedia(`(min-width: ${tailwindBreakpoints['lg']}px)`).matches) {
        currentBreakpoint = 'lg';
      } else if (globalThis.matchMedia(`(min-width: ${tailwindBreakpoints['md']}px)`).matches) {
        currentBreakpoint = 'md';
      } else if (globalThis.matchMedia(`(min-width: ${tailwindBreakpoints['sm']}px)`).matches) {
        currentBreakpoint = 'sm';
      }
      setIsMobile(currentBreakpoint === 'base');
      setBreakpoint(currentBreakpoint);
    };

    determineBreakpoint();

    globalThis.addEventListener('resize', determineBreakpoint);
    return () => globalThis.removeEventListener('resize', determineBreakpoint);
  }, []);

  return { breakpoint, isMobile };
};

export default useBreakpoint;
