import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { HiOutlineArrowDownTray, HiOutlineExclamationTriangle } from 'react-icons/hi2';
import Button from '@components/Button';
import CopyButton from './CopyButton';

interface RecoveryCodesPanelProps {
  codes: string[];
}

const KEY = 'modules.panel.settings.security.mfa.enable.recovery';

/**
 * The one-time recovery codes, shown exactly once right after enabling MFA — the fallback if the
 * authenticator is ever lost. Presented as an evenly-spaced monospace grid (so each code is easy to
 * transcribe), under a plain-language warning, with copy-all and download-as-text actions. These are
 * NEVER persisted client-side; leaving the wizard drops them for good. Reusable by a future
 * "regenerate codes" flow.
 */
const RecoveryCodesPanel: React.FC<RecoveryCodesPanelProps> = ({ codes }) => {
  const { t } = useTranslation();
  const joined = codes.join('\n');

  const onDownload = useCallback(() => {
    const blob = new Blob([`${joined}\n`], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'ozari-recovery-codes.txt';
    anchor.click();
    URL.revokeObjectURL(url);
  }, [joined]);

  return (
    <div className="flex flex-col gap-4">
      {/* Amber attention band — recoverable/important, not destructive-red. */}
      <div role="note" className="flex items-start gap-2.5 rounded-control bg-amber-50 px-3.5 py-3 text-sm text-amber-700">
        <HiOutlineExclamationTriangle aria-hidden className="mt-0.5 size-5 shrink-0" />
        <p className="leading-relaxed">{t(`${KEY}.warning`)}</p>
      </div>

      <ul
        aria-label={t(`${KEY}.listLabel`)}
        className="grid grid-cols-2 gap-2 rounded-card border border-charcoal/[0.07] bg-charcoal/[0.02] p-4"
      >
        {codes.map((code) => (
          <li
            key={code}
            className="text-center font-mono text-sm tracking-wider text-charcoal tabular-nums"
          >
            {code}
          </li>
        ))}
      </ul>

      <div className="flex flex-col gap-2.5 sm:flex-row">
        <CopyButton value={joined} label={t(`${KEY}.copy`)} copiedLabel={t(`${KEY}.copied`)} fullWidth />
        <Button
          variant="soft"
          color="#262626"
          size="sm"
          fullWidth
          onClick={onDownload}
          startIcon={<HiOutlineArrowDownTray className="size-4" />}
        >
          {t(`${KEY}.download`)}
        </Button>
      </div>
    </div>
  );
};

export default RecoveryCodesPanel;
