import { zodResolver } from '@hookform/resolvers/zod';
import axios from 'axios';
import { useEffect, useMemo } from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { HiOutlineExclamationTriangle } from 'react-icons/hi2';
import Button from '@components/Button';
import CustomInputForm from '@components/CustomInputForm';
import Modal from '@components/Modal';
import { notify } from '@components/notifications/notify';
import { RequiredPatternsContext } from '@contexts/RequiredFieldsContext';
import { getServerMessage, getStatus, isOutageStatus, resolveApiErrorMessage } from '@utils/apiError';
import {
  mfaDisableDefaultValues,
  mfaDisableRequiredPatterns,
  mfaDisableSchema,
  type MfaDisableType,
} from './SchemaMfaDisable';
import { useMfaDisable } from './useMfaDisable';

interface MfaDisableModalProps {
  open: boolean;
  onClose: () => void;
}

const FORM_ID = 'mfa-disable-form';
const KEY = 'modules.panel.settings.security.mfa.disable';

/**
 * Disable-2FA dialog: the reusable `Modal` primitive (focus-trap, scroll-lock, Escape/backdrop
 * dismissal — suspended while in flight via `locked`) hosting a short RHF form. Turning off a security
 * control is a step-up action, so it requires re-entering the **account password** (the backend
 * re-verifies it, and clears the TOTP secret + recovery codes). A clear amber warning states the
 * consequence up front — this is not a silent toggle. A wrong password (422) lands INLINE on the field
 * (mirroring change-password); only ambient failures (5xx/offline) fall through to a toast. On success
 * we confirm + close; `ME` is invalidated by the hook so the switch flips off. This device stays
 * signed in — disabling deliberately keeps the user's other sessions.
 */
const MfaDisableModal: React.FC<MfaDisableModalProps> = ({ open, onClose }) => {
  const { t } = useTranslation();
  const methods = useForm<MfaDisableType>({
    resolver: zodResolver(mfaDisableSchema),
    defaultValues: mfaDisableDefaultValues,
    mode: 'onTouched',
  });
  const { handleSubmit, reset, setError } = methods;
  const { disableMfa, isPending } = useMfaDisable();

  // A fresh form each time the dialog opens — clears the typed value and any server-set field error.
  useEffect(() => {
    if (!open) reset();
  }, [open, reset]);

  const onSubmit = (data: MfaDisableType): void => {
    if (isPending) return;
    disableMfa(data, {
      onSuccess: () => {
        notify.success(t(`${KEY}.successToast`), { title: t(`${KEY}.successTitle`) });
        onClose();
      },
      onError: (error) => {
        if (!axios.isAxiosError(error)) {
          notify.error(t('errors.generic'));
          return;
        }
        const status = getStatus(error);
        if (isOutageStatus(status)) return; // the app-overlay owns backend-down states
        // 422 = the password is wrong (the session is still valid). 401 kept as a defensive fallback,
        // but a genuine 401 is caught upstream by the interceptor's silent refresh + retry.
        if (status === 422 || status === 401) {
          setError(
            'password',
            { message: getServerMessage(error) ?? t(`${KEY}.errors.invalidPassword`) },
            { shouldFocus: true },
          );
          return;
        }
        notify.error(resolveApiErrorMessage(error)); // 400 not-enabled / 5xx / network / rate limit
      },
    });
  };

  const requiredPatternsValue = useMemo(
    () => ({ requiredPatterns: mfaDisableRequiredPatterns }),
    [],
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      locked={isPending}
      title={t(`${KEY}.title`)}
      description={t(`${KEY}.description`)}
      footer={
        <>
          <Button
            variant="soft"
            color="#262626"
            fullWidth
            onClick={onClose}
            disabled={isPending}
            className="sm:w-auto"
          >
            {t(`${KEY}.cancel`)}
          </Button>
          <Button type="submit" form={FORM_ID} color="#262626" fullWidth loading={isPending} className="sm:w-auto">
            {t(`${KEY}.confirm`)}
          </Button>
        </>
      }
    >
      <RequiredPatternsContext.Provider value={requiredPatternsValue}>
        <FormProvider {...methods}>
          <form id={FORM_ID} onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
            {/* Amber attention band — a security downgrade, stated plainly before the user confirms. */}
            <div
              role="note"
              className="modal-stagger flex items-start gap-2.5 rounded-control bg-amber-50 px-3.5 py-3 text-sm text-amber-700"
            >
              <HiOutlineExclamationTriangle aria-hidden className="mt-0.5 size-5 shrink-0" />
              <p className="leading-relaxed">{t(`${KEY}.warning`)}</p>
            </div>
            <div className="modal-stagger">
              <CustomInputForm<MfaDisableType>
                id="mfa-disable-password"
                name="password"
                type="password"
                autoComplete="current-password"
                iconTabbable={false}
                data-modal-autofocus
                label={t(`${KEY}.passwordLabel`)}
                placeholder={t(`${KEY}.passwordPlaceholder`)}
                aria-label={t(`${KEY}.passwordLabel`)}
              />
            </div>
          </form>
        </FormProvider>
      </RequiredPatternsContext.Provider>
    </Modal>
  );
};

export default MfaDisableModal;
