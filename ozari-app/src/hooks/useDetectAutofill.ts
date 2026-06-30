import { useEffect, useRef } from 'react';

/**
 * Detects when the input inside `containerRef` is autofilled by the browser or a password
 * manager, and (a) makes sure the value is synced into React state, (b) calls `onAutofill`.
 *
 * Detection uses the two cross-browser signals (there is no real autofill event):
 *  - `animationstart` from the `onAutofill` keyframe on `:-webkit-autofill` / `:autofill`
 *    (Chrome, Edge, Opera, Safari, iOS), and
 *  - a **trusted** `input` event with no `inputType`/`data` (Firefox / some managers / iOS).
 *
 * The `isTrusted` check is what keeps this honest: our own synced `input` dispatch (and any
 * script-driven value change) is `isTrusted === false`, so it never counts as an autofill —
 * which is exactly what made the old polling approach misfire. Manual typing carries
 * `inputType: "insertText"`, so it's excluded too.
 */
const useDetectAutofill = (onAutofill?: () => void) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const callbackRef = useRef(onAutofill);

  useEffect(() => {
    callbackRef.current = onAutofill;
  }, [onAutofill]);

  useEffect(() => {
    const input = containerRef.current?.querySelector('input');
    if (!input) return;

    let coalescing = false;
    const handleAutofill = () => {
      // Push the autofilled value into React/RHF (the controlled field may not have caught
      // it). Our dispatch is untrusted, so the listeners below ignore it — no loop.
      if (input.value) input.dispatchEvent(new Event('input', { bubbles: true }));
      // Coalesce the animation + input signals (and rapid repeats) into one callback.
      if (coalescing) return;
      coalescing = true;
      callbackRef.current?.();
      setTimeout(() => {
        coalescing = false;
      }, 0);
    };

    const onAnimationStart = (event: AnimationEvent) => {
      if (event.animationName === 'onAutofill') handleAutofill();
    };
    const onInput = (event: Event) => {
      const inputEvent = event as InputEvent;
      if (
        event.isTrusted &&
        inputEvent.inputType == null &&
        inputEvent.data == null &&
        !inputEvent.isComposing
      ) {
        handleAutofill();
      }
    };

    input.addEventListener('animationstart', onAnimationStart);
    input.addEventListener('input', onInput);
    return () => {
      input.removeEventListener('animationstart', onAnimationStart);
      input.removeEventListener('input', onInput);
    };
  }, []);

  return {
    containerRef,
  };
};

export default useDetectAutofill;
