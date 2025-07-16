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
  }, []);

  useLayoutEffect(() => {
    detectAutofill();
  }, [detectAutofill]);

  return {
    containerRef,
  };
};

export default useDetectAutofill;
