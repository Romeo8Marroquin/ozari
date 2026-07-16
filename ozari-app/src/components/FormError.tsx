import { useState } from 'react';
import { FiAlertCircle } from 'react-icons/fi';

interface FormErrorProps {
  /** The error to show. Falsy = collapsed/hidden. */
  message?: string;
  /** Wire to the form's submit button via `aria-describedby` / `aria-errormessage` if desired. */
  id?: string;
}

/**
 * A form-level error (server-side submit errors: bad credentials, duplicate email, …) shown above the
 * submit button as plain icon + red text — matching the inline field errors (`AnimatedMessage`), no
 * box/border. Two coordinated motions so nothing pops: the row height eases open/closed via a
 * `grid-template-rows` 0fr↔1fr trick (softly pushing the button), and the text itself gently
 * fades+slides in (`ease-in-out`) instead of snapping. The last message is kept while collapsing so
 * the text doesn't vanish mid-animation. `role="alert"` announces it to assistive tech.
 */
const FormError: React.FC<FormErrorProps> = ({ message, id }) => {
  // Keep the last non-empty message painted so it stays readable through the collapse animation
  // (when `message` clears to undefined). Uses React's sanctioned "adjust state during render"
  // pattern — no effect, no ref — so `displayed` only ever moves forward to a real message.
  const [displayed, setDisplayed] = useState(message);
  const [prevMessage, setPrevMessage] = useState(message);
  if (message !== prevMessage) {
    setPrevMessage(message);
    if (message) setDisplayed(message);
  }

  const open = Boolean(message);

  return (
    <div
      aria-hidden={!open}
      className={`grid w-full transition-[grid-template-rows] duration-300 ease-[var(--ease-settle)] motion-reduce:transition-none ${
        open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
      }`}
    >
      <div className="overflow-hidden">
        <p
          id={id}
          role="alert"
          className={`mb-4 flex items-start gap-1.5 text-left text-sm text-red-600 transition-[opacity,translate] duration-300 ease-in-out motion-reduce:transition-none ${
            open ? 'translate-y-0 opacity-100' : '-translate-y-1 opacity-0'
          }`}
        >
          <FiAlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span>{displayed}</span>
        </p>
      </div>
    </div>
  );
};

export default FormError;
