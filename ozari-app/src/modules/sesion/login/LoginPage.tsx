import React, { useMemo, useRef } from 'react';
import { gsap } from 'gsap';
import { FaUserAlt } from 'react-icons/fa';
import { useGSAP } from '@gsap/react';
import SesionCard from '@sesion/components/SesionCard';
import CustomInputForm from '@components/CustomInputForm';
import { FormProvider, useForm } from 'react-hook-form';
import { DevTool } from '@hookform/devtools';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  loginRequiredPatterns,
  loginSchema,
  loginSchemaDefaultValues,
  type LoginType,
} from './SchemaLogin';
import { RequiredPatternsContext } from '@contexts/RequiredFieldsContext';
import { useTranslation } from 'react-i18next';
import CustomButton from '@components/CustomButton';
import useLogin from '../../../hooks/useLogin';

const LoginPage: React.FC = () => {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const methods = useForm<LoginType>({
    resolver: zodResolver(loginSchema),
    defaultValues: loginSchemaDefaultValues,
    mode: 'onTouched',
  });
  const { trigger, reset, getValues } = methods;
  const { login, isLoading, error } = useLogin();

  useGSAP(
    () => {
      gsap.from('.stagger', {
        opacity: 0,
        y: -5,
        delay: 0.6,
        duration: 0.3,
        ease: 'power1.inOut',
        stagger: 0.2,
      });
    },
    { scope: containerRef },
  );

  const onSubmit = async () => {
    if (isLoading) return;
    const isValid = await trigger();
    if (!isValid) return;
    try {
      login(getValues());
      reset();
    } catch (err) {
      console.log('Tanstack error:', error);
      console.error('Login failed:', err);
    }
  };

  const handleAutocomplete = async (event: React.FormEvent<HTMLInputElement>) => {
    const nativeEvent = event.nativeEvent as InputEvent;
    if (
      nativeEvent.inputType === undefined &&
      nativeEvent.data === undefined &&
      nativeEvent.dataTransfer === undefined &&
      nativeEvent.isComposing === undefined &&
      !methods.formState.isSubmitting
    ) {
      const isValid = await methods.trigger();
      if (isValid) {
        methods.handleSubmit(onSubmit)();
      }
    }
  };

  const requiredPatternsContextValue = useMemo(
    () => ({ requiredPatterns: loginRequiredPatterns }),
    [],
  );

  return (
    <div ref={containerRef} className="w-full flex justify-center items-center">
      <SesionCard className="sm:px-12">
        <h2 className="stagger text-2xl font-bold text-black select-none">
          {t('modules.sesion.login.title')}
        </h2>
        <RequiredPatternsContext.Provider value={requiredPatternsContextValue}>
          <FormProvider {...methods}>
            <form
              onSubmit={methods.handleSubmit(onSubmit)}
              className="w-full flex flex-col items-center gap-6"
            >
              <div className="stagger w-full">
                <CustomInputForm<LoginType>
                  id="email-input"
                  data-testid="email-input"
                  autoComplete="email"
                  label={t('modules.sesion.login.form.emailLabel')}
                  placeholder={t('modules.sesion.login.form.emailPlaceholder')}
                  aria-label={t('modules.sesion.login.form.emailLabel')}
                  name="email"
                  autoFocus
                  icon={<FaUserAlt />}
                  onInput={handleAutocomplete}
                />
              </div>
              <div className="stagger w-full">
                <CustomInputForm<LoginType>
                  id="password"
                  data-testid="password-input"
                  autoComplete="current-password"
                  aria-label={t('modules.sesion.login.form.passwordLabel')}
                  placeholder={t('modules.sesion.login.form.passwordPlaceholder')}
                  label={t('modules.sesion.login.form.passwordLabel')}
                  name="password"
                  type="password"
                  onInput={handleAutocomplete}
                />
              </div>
              <div className="stagger">
                <CustomButton
                  text={t('modules.sesion.login.form.submitButton')}
                  disabled={!methods.formState.isValid}
                  loading={methods.formState.isSubmitting}
                />
              </div>
            </form>
          </FormProvider>
        </RequiredPatternsContext.Provider>
      </SesionCard>
      <DevTool control={methods.control} />
    </div>
  );
};

export default LoginPage;
