import { useState, useEffect } from 'react';

const tailwindBreakpoints = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  '2xl': 1536,
};

const useBreakpoint = () => {
  const [breakpoint, setBreakpoint] = useState<string | null>(null);

  useEffect(() => {
    const determineBreakpoint = () => {
      let currentBreakpoint = 'base';

      if (window.matchMedia(`(min-width: ${tailwindBreakpoints['2xl']}px)`).matches) {
        currentBreakpoint = '2xl';
      } else if (window.matchMedia(`(min-width: ${tailwindBreakpoints['xl']}px)`).matches) {
        currentBreakpoint = 'xl';
      } else if (window.matchMedia(`(min-width: ${tailwindBreakpoints['lg']}px)`).matches) {
        currentBreakpoint = 'lg';
      } else if (window.matchMedia(`(min-width: ${tailwindBreakpoints['md']}px)`).matches) {
        currentBreakpoint = 'md';
      } else if (window.matchMedia(`(min-width: ${tailwindBreakpoints['sm']}px)`).matches) {
        currentBreakpoint = 'sm';
      }

      setBreakpoint(currentBreakpoint);
    };

    determineBreakpoint();

    window.addEventListener('resize', determineBreakpoint);
    return () => window.removeEventListener('resize', determineBreakpoint);
  }, []);

  return breakpoint;
};

export default useBreakpoint;
