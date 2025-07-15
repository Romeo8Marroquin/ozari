import { useCallback, useLayoutEffect, useRef, useState } from 'react';

const useDetectAutofill = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isAutofilled, setIsAutofilled] = useState(false);

  const detectAutofill = useCallback(() => {
    const inputElement = containerRef.current?.querySelector('input');
    const intervalId = setInterval(() => {
      if (inputElement?.value !== '' && !isAutofilled) {
        setIsAutofilled(true);
        clearInterval(intervalId);
        inputElement?.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }, 200);
  }, [isAutofilled]);

  useLayoutEffect(() => {
    detectAutofill();
  }, [detectAutofill]);

  return {
    containerRef,
  };
};

export default useDetectAutofill;
