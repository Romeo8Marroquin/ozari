import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { HiCheck, HiOutlineShare } from 'react-icons/hi2';
import { twMerge } from 'tailwind-merge';

/** How long the copied-check confirmation stays before the icon settles back. */
export const SHARE_COPIED_MS = 1800;

interface ShareButtonProps {
  /** What is being shared (the native sheet's title). */
  title: string;
  /** The absolute URL to share / copy. */
  url: string;
  /** Style overrides for placement-specific looks (merged over the soft default). */
  className?: string;
}

/**
 * The universal "spread this" affordance, using the best capability the platform offers, in order:
 *
 *  1. **Web Share API** with the URL — Chromium (Windows/Android/ChromeOS) and Safari (macOS/iOS)
 *     open the native sheet. The sheet itself is the feedback; cancelling it is not an error.
 *  2. **Clipboard** (`navigator.clipboard`): copy the link; the icon morphs to a check.
 *  3. **Legacy copy** (`document.execCommand`): same check — this tier still works on INSECURE
 *     contexts (plain-HTTP LAN testing), where the modern APIs above simply don't exist.
 *
 * Links only, by design: platforms treat the URL as the shareable unit (previews come from the
 * page's own metadata), and an earlier attach-the-image tier (Web Share Level 2 files) proved to
 * be what almost no share sheet leads with — it was removed rather than half-supported.
 *
 * NOTE for testers: tiers 1–2 require a SECURE context (HTTPS or localhost) by browser rule — on a
 * LAN `http://` origin only tier 3 can run. Production is HTTPS, so phones get the real sheet.
 */
const ShareButton: React.FC<ShareButtonProps> = ({ title, url, className }) => {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
    },
    [],
  );

  const confirmCopied = (): void => {
    setCopied(true);
    if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
    resetTimer.current = window.setTimeout(() => setCopied(false), SHARE_COPIED_MS);
  };

  /** Tier 3: the textarea + execCommand copy — the only tier that works on insecure origins. */
  const legacyCopy = (): boolean => {
    const area = document.createElement('textarea');
    area.value = url;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    let succeeded: boolean;
    try {
      succeeded = document.execCommand('copy');
    } catch {
      succeeded = false;
    }
    area.remove();
    return succeeded;
  };

  const share = async (): Promise<void> => {
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title, url });
      } catch {
        // Cancelled sheet (AbortError) or a platform refusal — quiet either way.
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      confirmCopied();
    } catch {
      // Clipboard denied or absent (insecure context) — the legacy tier still works there.
      if (legacyCopy()) confirmCopied();
    }
  };

  return (
    <button
      type="button"
      aria-label={copied ? t('components.share.copied') : t('components.share.label')}
      onClick={() => void share()}
      className={twMerge(
        'relative grid size-9 cursor-pointer place-items-center rounded-full bg-charcoal/[0.06] text-charcoal/70 transition-[background-color,color,scale] duration-200 ease-[var(--ease-settle)] hover:scale-105 hover:bg-charcoal/10 hover:text-charcoal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-magenta motion-reduce:transition-none',
        className,
      )}
    >
      {/* Both glyphs stay mounted and crossfade — the check "arrives", never pops. */}
      <HiOutlineShare
        aria-hidden
        className={`col-start-1 row-start-1 size-4 transition-[opacity,scale] duration-200 ease-[var(--ease-settle)] motion-reduce:transition-none ${
          copied ? 'scale-75 opacity-0' : 'scale-100 opacity-100'
        }`}
      />
      <HiCheck
        aria-hidden
        data-testid="share-copied-check"
        className={`col-start-1 row-start-1 size-4 text-emerald-600 transition-[opacity,scale] duration-200 ease-[var(--ease-settle)] motion-reduce:transition-none ${
          copied ? 'scale-100 opacity-100' : 'scale-75 opacity-0'
        }`}
      />
      <span aria-live="polite" className="sr-only">
        {copied ? t('components.share.copied') : ''}
      </span>
    </button>
  );
};

export default ShareButton;
