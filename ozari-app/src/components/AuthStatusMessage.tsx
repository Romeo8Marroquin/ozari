import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import React, { useRef } from 'react';

export type AuthStatus = { type: 'success' | 'error'; message: string } | null;

interface AuthStatusMessageProps {
  status: AuthStatus;
}

/**
 * Form-level status line for the auth pages. Announced to assistive tech
 * (`role="alert"` + `aria-live`) and fades in smoothly when it changes. Carries the
 * `form-element` class so it participates in the page's enter/leave animation.
 */
const AuthStatusMessage: React.FC<AuthStatusMessageProps> = ({ status }) => {
  const ref = useRef<HTMLParagraphElement>(null);

  useGSAP(
    () => {
      if (status && ref.current) {
        gsap.fromTo(
          ref.current,
          { opacity: 0, y: -6 },
          { opacity: 1, y: 0, duration: 0.3, ease: 'power2.out' },
        );
      }
    },
    { dependencies: [status?.type, status?.message] },
  );

  if (!status) return null;

  return (
    <p
      ref={ref}
      role="alert"
      aria-live="assertive"
      className={`form-element text-xs text-center ${
        status.type === 'success' ? 'text-green-600' : 'text-red-600'
      }`}
    >
      {status.message}
    </p>
  );
};

export default AuthStatusMessage;
