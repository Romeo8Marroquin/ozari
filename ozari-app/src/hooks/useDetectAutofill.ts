import { useCallback, useLayoutEffect, useRef } from 'react';

const useDetectAutofill = () => {
  const containerRef = useRef<HTMLDivElement>(null);

  const detectAutofill = useCallback(() => {
    const inputElement = containerRef.current?.querySelector('input');
    const intervalId = setInterval(() => {
      if (inputElement?.value !== '') {
        clearInterval(intervalId);
        inputElement?.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }, 200);

    // Return cleanup function to clear interval
    return () => clearInterval(intervalId);
  }, []);

  useLayoutEffect(() => {
    const cleanup = detectAutofill();
    return cleanup; // Clear interval on unmount
  }, [detectAutofill]);

  return {
    containerRef,
  };
};

export default useDetectAutofill;
