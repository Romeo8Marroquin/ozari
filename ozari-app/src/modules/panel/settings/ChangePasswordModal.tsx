import { zodResolver } from '@hookform/resolvers/zod';
import axios from 'axios';
import { useEffect, useMemo } from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import Button from '@components/Button';
import CustomInputForm from '@components/CustomInputForm';
import Modal from '@components/Modal';
import { notify } from '@components/notifications/notify';
import { RequiredPatternsContext } from '@contexts/RequiredFieldsContext';
import { getServerMessage, getStatus, isOutageStatus, resolveApiErrorMessage } from '@utils/apiError';
import {
  changePasswordDefaultValues,
  changePasswordRequiredPatterns,
  changePasswordSchema,
  type ChangePasswordType,
} from './SchemaChangePassword';
import { useChangePassword } from './useChangePassword';

interface ChangePasswordModalProps {
  open: boolean;
  onClose: () => void;
}

const FORM_ID = 'change-password-form';
const KEY = 'modules.panel.settings.security.password.modal';

/**
 * Change-password dialog: the reusable `Modal` primitive (focus-trap, scroll-lock, Escape/backdrop
 * dismissal — suspended while the request is in flight via `locked`) hosting an RHF form. Submit
 * errors surface INLINE on the relevant field (mirroring login/register): a wrong current password
 * (401) lands on the current-password field, anything else server-side on the new-password field;
 * only ambient failures (5xx/offline) fall through to a toast. On success the current device stays
 * logged in (the backend only revokes OTHER devices) — we just confirm and close.
 */
const ChangePasswordModal: React.FC<ChangePasswordModalProps> = ({ open, onClose }) => {
  const { t } = useTranslation();
  const methods = useForm<ChangePasswordType>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: changePasswordDefaultValues,
    mode: 'onTouched',
  });
  const { handleSubmit, reset, setError } = methods;
  const { changePassword, isPending } = useChangePassword();

  // A fresh form each time the dialog opens — clears typed values and any server-set field errors.
  // Reset on close so nothing flashes while it fades in.
  useEffect(() => {
    if (!open) reset();
  }, [open, reset]);

  const onSubmit = (data: ChangePasswordType): void => {
    if (isPending) return;
    changePassword(data, {
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

        const serverMessage = getServerMessage(error);
        if (status === 401) {
          setError(
            'currentPassword',
            { message: serverMessage ?? t(`${KEY}.errors.invalidCurrent`) },
            { shouldFocus: true },
          );
          return;
        }
        if (status === 400 || status === 409) {
          // The only server 400 that survives our mirrored client validation is password reuse.
          setError(
            'newPassword',
            { message: serverMessage ?? t(`${KEY}.errors.sameAsCurrent`) },
            { shouldFocus: true },
          );
          return;
        }
        notify.error(resolveApiErrorMessage(error)); // 404 / 5xx / network / rate limit
      },
    });
  };

  const requiredPatternsValue = useMemo(
    () => ({ requiredPatterns: changePasswordRequiredPatterns }),
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
            {t(`${KEY}.submit`)}
          </Button>
        </>
      }
    >
      <RequiredPatternsContext.Provider value={requiredPatternsValue}>
        <FormProvider {...methods}>
          {/* Each field wrapped in a `modal-stagger` element so the three inputs sweep in/out one
              after another (joining the title/description sweep) instead of the form moving as one. */}
          <form id={FORM_ID} onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
            <div className="modal-stagger">
              <CustomInputForm<ChangePasswordType>
                id="current-password"
                name="currentPassword"
                type="password"
                autoComplete="current-password"
                iconTabbable={false}
                data-modal-autofocus
                label={t(`${KEY}.currentLabel`)}
                placeholder={t(`${KEY}.currentPlaceholder`)}
                aria-label={t(`${KEY}.currentLabel`)}
              />
            </div>
            <div className="modal-stagger">
              <CustomInputForm<ChangePasswordType>
                id="new-password"
                name="newPassword"
                type="password"
                autoComplete="new-password"
                iconTabbable={false}
                deps={['confirmPassword']}
                label={t(`${KEY}.newLabel`)}
                placeholder={t(`${KEY}.newPlaceholder`)}
                aria-label={t(`${KEY}.newLabel`)}
              />
            </div>
            <div className="modal-stagger">
              <CustomInputForm<ChangePasswordType>
                id="confirm-password"
                name="confirmPassword"
                type="password"
                autoComplete="new-password"
                iconTabbable={false}
                label={t(`${KEY}.confirmLabel`)}
                placeholder={t(`${KEY}.confirmPlaceholder`)}
                aria-label={t(`${KEY}.confirmLabel`)}
              />
            </div>
          </form>
        </FormProvider>
      </RequiredPatternsContext.Provider>
    </Modal>
  );
};

export default ChangePasswordModal;
