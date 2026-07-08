import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { HiOutlineArrowPath, HiOutlineExclamationTriangle } from 'react-icons/hi2';
import Button from '@components/Button';
import SkeletonFade from '@components/SkeletonFade';
import Switch from '@components/Switch';
import { getInitials } from '@utils/nameFormat';
import { useMe } from '../hooks/useMe';
import { usePanelPageExit } from '../PanelPageTransitionContext';
import ChangePasswordModal from './ChangePasswordModal';
import MfaDisableModal from './MfaDisableModal';
import MfaEnableModal from './MfaEnableModal';
import SettingsSection from './SettingsSection';

const prefersReducedMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// One shimmer bar for any loading placeholder, sized by the caller — the same skeleton language
// the header pill/menu use, so a slow `/auth/me` reads as "loading", never as a fake value.
// `animate-pulse` is disabled under reduced-motion.
const SKELETON = 'animate-pulse rounded bg-charcoal/10 motion-reduce:animate-none';

// Secondary actions reuse the app's Button primitive — the same `soft` charcoal as the logout
// modal's "Cancelar" — so they get cursor, hover-lift, press-scale, focus ring, and motion-reduce
// handling for free, and read as real buttons rather than styled text.
const SECONDARY_COLOR = '#262626';

/** Localized long date (`5 de julio de 2026`) for the account's join date; blank for bad input. */
const formatJoinDate = (iso?: string): string => {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('es-GT', { day: 'numeric', month: 'long', year: 'numeric' });
};

/** A label/value row inside the account card. Stacks on mobile, splits left/right from `sm`. */
const AccountField: React.FC<{ label: string; value: string; loading: boolean; skeletonWidth: string }> = ({
  label,
  value,
  loading,
  skeletonWidth,
}) => (
  <div className="flex flex-col gap-1 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
    <dt className="text-sm text-charcoal/55">{label}</dt>
    <dd className="text-sm font-medium text-charcoal sm:text-right">
      <SkeletonFade
        loading={loading}
        contentClassName="inline-block"
        skeleton={<span aria-hidden className={`inline-block h-4 align-middle ${skeletonWidth} ${SKELETON}`} />}
      >
        {value || '—'}
      </SkeletonFade>
    </dd>
  </div>
);

/**
 * The 2FA switch, built on the shared {@link Switch} primitive (smooth track/knob, hover halo,
 * transitioned focus ring). Toggling it never flips instantly — it opens a confirm modal (enabling is
 * a multi-step wizard; disabling is a password-confirmed step-up) and the switch only reflects the new
 * state once the backend actually changes it (via `useMe`), so its visual position always matches
 * reality even mid-request.
 */
const MfaToggle: React.FC<{ enabled: boolean; onEnable: () => void; onDisable: () => void }> = ({
  enabled,
  onEnable,
  onDisable,
}) => {
  const { t } = useTranslation();
  return enabled ? (
    <Switch checked onChange={onDisable} aria-label={t('modules.panel.settings.security.mfa.toggleOff')} />
  ) : (
    <Switch
      checked={false}
      onChange={onEnable}
      aria-label={t('modules.panel.settings.security.mfa.toggleOn')}
    />
  );
};

/** A security setting row: label + description on the left, a right-side action control. */
const SecurityRow: React.FC<{
  label: string;
  description: string;
  action: React.ReactNode;
}> = ({ label, description, action }) => (
  <div className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
    <div className="min-w-0">
      <span className="text-sm font-medium text-charcoal">{label}</span>
      <p className="mt-0.5 text-sm leading-relaxed text-charcoal/55">{description}</p>
    </div>
    <div className="shrink-0">{action}</div>
  </div>
);

/**
 * Honest error state for the account card when `/auth/me` fails with no cached data to fall back on:
 * a clear message and a real retry — never fabricated data, never a frozen skeleton. The toast (from
 * the axios interceptor) covers the transient notice; this is the persistent, actionable one.
 */
const AccountError: React.FC<{ onRetry: () => void; retrying: boolean }> = ({ onRetry, retrying }) => {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center gap-3 py-10 text-center">
      {/* Amber = recoverable warning/attention (not red, which we reserve for destructive actions). */}
      <span aria-hidden className="grid size-11 place-items-center rounded-full bg-amber-50 text-amber-500">
        <HiOutlineExclamationTriangle className="size-6" />
      </span>
      <p className="text-sm text-charcoal/60">{t('modules.panel.settings.account.error.message')}</p>
      <Button
        variant="soft"
        color={SECONDARY_COLOR}
        size="sm"
        loading={retrying}
        onClick={onRetry}
        startIcon={<HiOutlineArrowPath className="size-4" />}
      >
        {t('modules.panel.settings.account.error.retry')}
      </Button>
    </div>
  );
};

/**
 * Settings shell — the panel's first real screen and the host for the account + security features:
 * the live profile from `/auth/me`, change-password, and MFA setup/enable/disable (each a confirm
 * dialog off this page). Structure, motion, and a11y are production-ready.
 */
const SettingsPage: React.FC = () => {
  const { t } = useTranslation();
  const { data: me, isLoading, isError, isFetching, refetch } = useMe();
  const root = useRef<HTMLDivElement>(null);
  const [passwordModalOpen, setPasswordModalOpen] = useState(false);
  const [mfaModalOpen, setMfaModalOpen] = useState(false);
  const [mfaDisableModalOpen, setMfaDisableModalOpen] = useState(false);

  const loading = isLoading && !me;
  // Only a COLD failure (no cached profile to show) becomes the error state; a failed background
  // refetch keeps the still-valid cached data on screen instead of blowing it away.
  const hasError = isError && !me;
  const roleLabel = t(`modules.panel.user.roles.${me?.role ?? 'unknown'}`, {
    defaultValue: t('modules.panel.user.roles.unknown'),
  });

  // ── This page's OWN entrance ─────────────────────────────────────────────────────────────────
  // Restrained on purpose: only the few `.reveal-block`s (the lead + each section as a whole) move —
  // a gentle fade + rise + faint settle, softly staggered. Nothing inside the cards moves, and it's
  // vertical only, so there's no sideways overflow. Runs on every appearance (fresh load or tab
  // change). Gated on reduced-motion; reverted by `useGSAP` on unmount.
  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add('(prefers-reduced-motion: no-preference)', () => {
        gsap.from('.reveal-block', {
          y: 16,
          autoAlpha: 0,
          scale: 0.99,
          duration: 0.5,
          ease: 'power3.out',
          stagger: 0.1,
          clearProps: 'transform',
        });
      });
    },
    { scope: root },
  );

  // ── This page's OWN exit — the reverse of the entrance ───────────────────────────────────────
  // Registered with the layout so it plays before ANY departure (tab change or logout), never the
  // default. The same few blocks lift up and fade, quick and accelerating — the mirror of the
  // entrance. Resolves when finished (immediately if there's nothing to animate / reduced motion).
  usePanelPageExit(
    useCallback(
      () =>
        new Promise<void>((resolve) => {
          const element = root.current;
          /* v8 ignore next -- root is always mounted when the exit runs, so the null-element fallback is unreachable */
          const blocks = element ? gsap.utils.selector(element)('.reveal-block') : [];
          if (blocks.length === 0 || prefersReducedMotion()) {
            resolve();
            return;
          }
          gsap.to(blocks, {
            y: -12,
            autoAlpha: 0,
            duration: 0.22,
            ease: 'power2.in',
            stagger: 0.05,
            onComplete: resolve,
          });
        }),
      [],
    ),
  );

  return (
    <div ref={root} className="mx-auto flex max-w-4xl flex-col gap-8 sm:gap-10">
      <p className="reveal-block text-sm text-charcoal/55">{t('modules.panel.settings.lead')}</p>

      {/* ── Account ─────────────────────────────────────────────────────────────────── */}
      <SettingsSection
        title={t('modules.panel.settings.account.title')}
        description={t('modules.panel.settings.account.description')}
      >
        {hasError ? (
          <AccountError onRetry={() => void refetch()} retrying={isFetching} />
        ) : (
          <>
            {/* Identity: brand avatar + name + email, mirroring the header menu's identity block. */}
            <div className="py-5">
              <SkeletonFade
                loading={loading}
                className="block"
                contentClassName="flex items-center gap-4"
                skeleton={
                  <>
                    <span aria-hidden className={`size-14 shrink-0 rounded-full ${SKELETON}`} />
                    <span className="flex flex-1 flex-col gap-2">
                      <span aria-hidden className={`h-4 w-40 ${SKELETON}`} />
                      <span aria-hidden className={`h-3 w-52 max-w-full ${SKELETON}`} />
                    </span>
                  </>
                }
              >
                <span
                  aria-hidden
                  className="grid size-14 shrink-0 place-items-center rounded-full bg-gradient-to-br from-cream to-blossom text-lg font-semibold text-charcoal shadow-sm"
                >
                  {getInitials(me?.fullName ?? '') || getInitials(t('modules.panel.user.fallbackName'))}
                </span>
                <span className="flex min-w-0 flex-col leading-tight">
                  <span className="truncate text-base font-semibold text-charcoal">
                    {me?.fullName || t('modules.panel.user.fallbackName')}
                  </span>
                  {me?.email && <span className="truncate text-sm text-charcoal/55">{me.email}</span>}
                </span>
              </SkeletonFade>
            </div>

            <div aria-hidden className="h-px bg-charcoal/[0.06]" />

            <dl className="divide-y divide-charcoal/[0.06]">
              <AccountField
                label={t('modules.panel.settings.account.role')}
                value={roleLabel}
                loading={loading}
                skeletonWidth="w-20"
              />
              <AccountField
                label={t('modules.panel.settings.account.memberSince')}
                value={formatJoinDate(me?.createdAt)}
                loading={loading}
                skeletonWidth="w-28"
              />
            </dl>
          </>
        )}
      </SettingsSection>

      {/* ── Security ────────────────────────────────────────────────────────────────── */}
      <SettingsSection
        title={t('modules.panel.settings.security.title')}
        description={t('modules.panel.settings.security.description')}
      >
        <div className="divide-y divide-charcoal/[0.06]">
          <SecurityRow
            label={t('modules.panel.settings.security.password.label')}
            description={t('modules.panel.settings.security.password.description')}
            action={
              <Button
                variant="soft"
                color={SECONDARY_COLOR}
                size="sm"
                onClick={() => setPasswordModalOpen(true)}
              >
                {t('modules.panel.settings.security.password.action')}
              </Button>
            }
          />
          <SecurityRow
            label={t('modules.panel.settings.security.mfa.label')}
            description={t('modules.panel.settings.security.mfa.description')}
            action={
              <SkeletonFade
                loading={loading}
                contentClassName="inline-flex"
                skeleton={<span aria-hidden className={`inline-block h-6 w-11 rounded-full ${SKELETON}`} />}
              >
                <MfaToggle
                  enabled={Boolean(me?.mfaEnabled)}
                  onEnable={() => setMfaModalOpen(true)}
                  onDisable={() => setMfaDisableModalOpen(true)}
                />
              </SkeletonFade>
            }
          />
        </div>
      </SettingsSection>

      <ChangePasswordModal open={passwordModalOpen} onClose={() => setPasswordModalOpen(false)} />
      <MfaEnableModal open={mfaModalOpen} onClose={() => setMfaModalOpen(false)} />
      <MfaDisableModal open={mfaDisableModalOpen} onClose={() => setMfaDisableModalOpen(false)} />
    </div>
  );
};

export default SettingsPage;
