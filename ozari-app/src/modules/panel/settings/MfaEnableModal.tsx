import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { HiOutlineExclamationTriangle } from 'react-icons/hi2';
import Button from '@components/Button';
import Modal from '@components/Modal';
import MfaCodeField from '@components/MfaCodeField';
import SkeletonFade from '@components/SkeletonFade';
import { useModalPhaseTransition } from '@components/useModalPhaseTransition';
import { notify } from '@components/notifications/notify';
import { QueryKeys } from '@constants/QueryKeys';
import { getServerMessage, getStatus, isOutageStatus, resolveApiErrorMessage } from '@utils/apiError';
import CopyButton from './CopyButton';
import MfaQrCode from './MfaQrCode';
import RecoveryCodesPanel from './RecoveryCodesPanel';
import { mfaCodeDefaultValues, mfaCodeSchema, type MfaCodeType } from './SchemaMfaCode';
import { useEnableMfa, useSetupMfa, type MfaSetupData } from './useMfa';

interface MfaEnableModalProps {
  open: boolean;
  onClose: () => void;
}

const FORM_ID = 'mfa-enable-form';
const KEY = 'modules.panel.settings.security.mfa.enable';

/** form → scan + confirm (skeleton until the secret loads) · recovery → show codes · error → retry. */
type Phase = 'form' | 'recovery' | 'error';

// The shared skeleton shimmer (same language as the settings page / header pill), reused for every
// placeholder while the secret is being generated. `animate-pulse` is disabled under reduced motion.
const SKELETON = 'animate-pulse rounded bg-charcoal/10 motion-reduce:animate-none';

/**
 * The enable-MFA wizard: one modal that walks setup → verify → recovery.
 *
 * On open it calls `POST /auth/mfa/setup` for a pending secret; the QR + manual-secret + code
 * sections render as **skeletons** first (so the modal's staggered entrance always has content to
 * sweep in, matching the other modals) and gently re-reveal once the secret lands. A 6-digit code is
 * confirmed with `POST /auth/mfa/enable`, then the one-time recovery codes are shown. `useMe` is
 * invalidated by `useEnableMfa` so the settings toggle flips to "on" the moment we succeed. Errors
 * follow the app doctrine: an invalid code (401) lands INLINE on the field, outages defer to the app
 * overlay, ambient failures toast. Built from reusable pieces (`MfaCodeField`, `MfaQrCode`,
 * `RecoveryCodesPanel`, `CopyButton`) so the future two-step login and disable flows can share them.
 *
 * State is reset on OPEN, never on close — so closing animates out the real content (no "loading"
 * flash) and a fresh session starts clean on the next open.
 */
const MfaEnableModal: React.FC<MfaEnableModalProps> = ({ open, onClose }) => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [phase, setPhase] = useState<Phase>('form');
  const [setup, setSetup] = useState<MfaSetupData | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);

  // The content swaps between phases (scan → recovery → error) while the panel stays mounted. Instead
  // of a jarring instant replace, run the modal's OWN open/close sweep between steps: the whole panel
  // (title, body blocks, footer) leaves like a close, the next step enters like an open, and the
  // panel resizes across the swap. Everything visible follows `renderedPhase`, one step behind `phase`
  // (the target). The hook drives the sweep on the real panel nodes, so it needs the panel ref. See
  // `useModalPhaseTransition`.
  const panelRef = useRef<HTMLDivElement>(null);
  const renderedPhase = useModalPhaseTransition(phase, panelRef);

  const { setupMfa, isPending: isSettingUp } = useSetupMfa();
  const { enableMfa, isPending: isEnabling } = useEnableMfa();

  const methods = useForm<MfaCodeType>({
    resolver: zodResolver(mfaCodeSchema),
    defaultValues: mfaCodeDefaultValues,
    mode: 'onTouched',
  });
  const { handleSubmit, reset, setError } = methods;

  const ready = Boolean(setup);

  // MFA turned out to be already on (enabled from another tab/device): refresh state so the toggle
  // reflects reality, tell the user, and close. Shared by the setup and confirm 409 paths.
  const settleAlreadyEnabled = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: [QueryKeys.ME] });
    notify.info(t(`${KEY}.alreadyEnabledToast`));
    onClose();
  }, [queryClient, t, onClose]);

  const runSetup = useCallback(async () => {
    setPhase('form');
    setSetup(null); // back to the skeleton while a fresh secret is fetched
    try {
      const data = await setupMfa();
      if (!data) {
        setPhase('error');
        return;
      }
      setSetup(data); // secret in hand → the skeleton re-reveals as the real QR/secret/code
    } catch (error) {
      const status = axios.isAxiosError(error) ? getStatus(error) : undefined;
      if (isOutageStatus(status)) {
        onClose(); // the full-screen overlay owns backend-down states
        return;
      }
      if (status === 409) {
        settleAlreadyEnabled();
        return;
      }
      setPhase('error');
    }
  }, [setupMfa, onClose, settleAlreadyEnabled]);

  // Kick off setup once per open; reset happens HERE (on open), not on close — so the modal keeps its
  // real content while it animates out. Guarded so a parent re-render can't re-trigger setup mid-flight.
  const openedRef = useRef(false);
  useEffect(() => {
    if (open && !openedRef.current) {
      openedRef.current = true;
      setRecoveryCodes([]);
      reset();
      void runSetup();
    } else if (!open && openedRef.current) {
      openedRef.current = false;
    }
  }, [open, runSetup, reset]);

  const onSubmit = async (data: MfaCodeType): Promise<void> => {
    if (isEnabling) return;
    try {
      const result = await enableMfa(data.code);
      if (!result) {
        notify.error(t('errors.generic'));
        return;
      }
      setRecoveryCodes(result.recoveryCodes);
      setPhase('recovery');
    } catch (error) {
      if (!axios.isAxiosError(error)) {
        notify.error(t('errors.generic'));
        return;
      }
      const status = getStatus(error);
      if (isOutageStatus(status)) return; // overlay owns it
      // 422 = wrong code (the session is valid). 401 kept as a defensive fallback, though a real 401
      // is intercepted upstream (silent refresh + retry) rather than surfacing here.
      if (status === 422 || status === 401) {
        setError('code', { message: getServerMessage(error) ?? t(`${KEY}.errors.invalidCode`) }, { shouldFocus: true });
        return;
      }
      if (status === 409) {
        settleAlreadyEnabled();
        return;
      }
      if (status === 400) {
        // The pending secret expired/was lost — restart enrollment with a fresh one.
        notify.error(getServerMessage(error) ?? t(`${KEY}.errors.setupExpired`));
        void runSetup();
        return;
      }
      notify.error(resolveApiErrorMessage(error)); // 429 / 5xx / network
    }
  };

  const title = renderedPhase === 'recovery' ? t(`${KEY}.recovery.title`) : t(`${KEY}.title`);
  const description =
    renderedPhase === 'form'
      ? t(`${KEY}.scanDescription`)
      : renderedPhase === 'recovery'
        ? t(`${KEY}.recovery.description`)
        : undefined;

  const footer =
    renderedPhase === 'recovery' ? (
      <Button color="#262626" fullWidth onClick={onClose} className="sm:w-auto">
        {t(`${KEY}.recovery.done`)}
      </Button>
    ) : renderedPhase === 'error' ? (
      <>
        <Button variant="soft" color="#262626" fullWidth onClick={onClose} className="sm:w-auto">
          {t(`${KEY}.cancel`)}
        </Button>
        <Button color="#262626" fullWidth loading={isSettingUp} onClick={() => void runSetup()} className="sm:w-auto">
          {t(`${KEY}.retry`)}
        </Button>
      </>
    ) : (
      <>
        <Button variant="soft" color="#262626" fullWidth onClick={onClose} disabled={isEnabling} className="sm:w-auto">
          {t(`${KEY}.cancel`)}
        </Button>
        <Button
          type="submit"
          form={FORM_ID}
          color="#262626"
          fullWidth
          loading={isEnabling}
          disabled={!ready}
          className="sm:w-auto"
        >
          {t(`${KEY}.confirm`)}
        </Button>
      </>
    );

  return (
    <Modal open={open} onClose={onClose} size="md" locked={isEnabling} title={title} description={description} footer={footer} panelRef={panelRef}>
      <FormProvider {...methods}>
        {/* Announce the pending state while the secret is being generated (form phase only). */}
        <div aria-busy={renderedPhase === 'form' && !ready}>
          {renderedPhase === 'error' && (
            <div className="modal-stagger flex flex-col items-center gap-3 py-8 text-center">
              <span aria-hidden className="grid size-11 place-items-center rounded-full bg-amber-50 text-amber-500">
                <HiOutlineExclamationTriangle className="size-6" />
              </span>
              <p className="text-sm text-charcoal/60">{t(`${KEY}.errors.setupFailed`)}</p>
            </div>
          )}

          {renderedPhase === 'recovery' && (
            <div className="modal-stagger">
              <RecoveryCodesPanel codes={recoveryCodes} />
            </div>
          )}

          {renderedPhase === 'form' && (
            <div className="flex flex-col gap-5">
              {/* QR — crossfades from its skeleton once the secret loads */}
              <div className="modal-stagger flex justify-center">
                <SkeletonFade
                  loading={!setup}
                  contentClassName="flex justify-center"
                  skeleton={
                    <span className="grid place-items-center rounded-card border border-charcoal/[0.07] bg-white p-4 shadow-sm">
                      <span aria-hidden className={`size-40 ${SKELETON}`} />
                    </span>
                  }
                >
                  {setup ? <MfaQrCode value={setup.otpauthUri} title={t(`${KEY}.qrTitle`)} /> : null}
                </SkeletonFade>
              </div>

              {/* Manual secret + copy. The skeleton mirrors the exact box model of the real content so
                  there is no height jump on reveal: the caption reserves its real (responsive) wrapped
                  height via invisible real text, the key bar reuses the same bordered box + a text-sm
                  line, and the copy button matches the sm Button height. */}
              <div className="modal-stagger">
                <SkeletonFade
                  loading={!setup}
                  className="block"
                  contentClassName="block"
                  skeleton={
                    <>
                      <span aria-hidden className="relative mb-1.5 block text-center text-xs text-transparent">
                        {t(`${KEY}.manualIntro`)}
                        <span className={`absolute inset-0 rounded ${SKELETON}`} />
                      </span>
                      <span className="block rounded-control border border-charcoal/10 bg-charcoal/[0.02] px-3 py-2 text-sm">
                        <span aria-hidden className={`inline-block h-3.5 w-full rounded align-middle ${SKELETON}`} />
                      </span>
                      <span className="mt-2 flex justify-center">
                        <span aria-hidden className={`h-11 w-32 rounded-[10px] ${SKELETON}`} />
                      </span>
                    </>
                  }
                >
                  {setup ? (
                    <>
                      <p className="mb-1.5 text-center text-xs text-charcoal/50">{t(`${KEY}.manualIntro`)}</p>
                      <div className="rounded-control border border-charcoal/10 bg-charcoal/[0.02] px-3 py-2">
                        <code className="block break-all text-center font-mono text-sm tracking-wider text-charcoal">
                          {setup.secret}
                        </code>
                      </div>
                      <div className="mt-2 flex justify-center">
                        <CopyButton value={setup.secret} label={t(`${KEY}.copySecret`)} copiedLabel={t(`${KEY}.copied`)} />
                      </div>
                    </>
                  ) : null}
                </SkeletonFade>
              </div>

              {/* Code entry. The skeleton reserves the label's text-sm line, the h-14 input, AND the
                  always-present (blank) error-message line — the piece that used to be missing and
                  caused the jump. */}
              <div className="modal-stagger">
                <SkeletonFade
                  loading={!setup}
                  className="block"
                  contentClassName="block"
                  skeleton={
                    <>
                      <span className="mb-2 block text-sm">
                        <span aria-hidden className={`inline-block h-3.5 w-36 rounded align-middle ${SKELETON}`} />
                      </span>
                      <span aria-hidden className={`block h-14 w-full rounded-control ${SKELETON}`} />
                      <span aria-hidden className="ml-1.5 mt-[3px] block text-xs">&nbsp;</span>
                    </>
                  }
                >
                  {setup ? (
                    <form id={FORM_ID} onSubmit={handleSubmit(onSubmit)}>
                      <MfaCodeField<MfaCodeType> name="code" label={t(`${KEY}.codeLabel`)} autoFocus />
                    </form>
                  ) : null}
                </SkeletonFade>
              </div>
            </div>
          )}
        </div>
      </FormProvider>
    </Modal>
  );
};

export default MfaEnableModal;
