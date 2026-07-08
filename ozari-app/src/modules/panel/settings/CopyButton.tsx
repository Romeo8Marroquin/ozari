import { useCallback, useEffect, useRef, useState } from 'react';
import { HiOutlineCheck, HiOutlineClipboard } from 'react-icons/hi2';
import Button from '@components/Button';

interface CopyButtonProps {
  /** Text to place on the clipboard. */
  value: string;
  /** Idle label (e.g. "Copiar"). */
  label: string;
  /** Confirmation label shown briefly after a successful copy (e.g. "Copiado"). */
  copiedLabel: string;
  /** Optional full-width in a stacked action row. */
  fullWidth?: boolean;
}

const RESET_MS = 1800;

/**
 * A small copy-to-clipboard action with transient "copied" feedback — reused for the manual TOTP
 * secret and for the recovery codes. Built on the app `Button` (soft charcoal) so it gets the shared
 * hover/press/focus treatment; the label swaps to a check for ~1.8s on success and silently no-ops
 * if the Clipboard API is unavailable or denied (the value is always visible to copy by hand).
 */
const CopyButton: React.FC<CopyButtonProps> = ({ value, label, copiedLabel, fullWidth = false }) => {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const onCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), RESET_MS);
    } catch {
      // Clipboard blocked/unavailable — the value stays on screen for manual copy, so stay quiet.
    }
  }, [value]);

  return (
    <>
      <Button
        variant="soft"
        color="#262626"
        size="sm"
        fullWidth={fullWidth}
        onClick={() => void onCopy()}
        startIcon={copied ? <HiOutlineCheck className="size-4" /> : <HiOutlineClipboard className="size-4" />}
      >
        {copied ? copiedLabel : label}
      </Button>
      {/* The visual label swap isn't reliably announced, so mirror "copied" into a live region. */}
      <span role="status" aria-live="polite" className="sr-only">
        {copied ? copiedLabel : ''}
      </span>
    </>
  );
};

export default CopyButton;
