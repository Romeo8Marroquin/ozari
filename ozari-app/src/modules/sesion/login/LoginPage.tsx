import logo from '@assets/svgs/logo.svg';
import React, { useMemo, useRef, type MouseEvent } from 'react';
import { gsap } from 'gsap';
import { FaUserAlt } from 'react-icons/fa';
import { useGSAP } from '@gsap/react';
import CustomInputForm from '@components/CustomInputForm';
import { FormProvider, useForm } from 'react-hook-form';
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
import useLogin from '../hooks/useLogin';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';

const LoginPage: React.FC = () => {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const search = useSearch({ from: '/sesion' });
  const navigate = useNavigate();
  const methods = useForm<LoginType>({
    resolver: zodResolver(loginSchema),
    defaultValues: loginSchemaDefaultValues,
    mode: 'onTouched',
  });
  const { reset, handleSubmit, trigger, formState } = methods;
  const { login, isPending } = useLogin();

  useGSAP(
    () => {
      if (!containerRef.current) return;
      const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });
      tl.from('.rotational-asset', {
        rotation: 0,
        x: 0,
        y: 0,
        duration: 0.75,
      });

      tl.from(
        '.form-element',
        {
          x: 15,
          opacity: 0,
          stagger: 0.15,
          duration: 0.5,
        },
        '>-0.5',
      );

      tl.from(
        '.article-element',
        {
          x: -15,
          opacity: 0,
          stagger: 0.15,
          duration: 0.5,
        },
        '<+0.1',
      );
    },
    { scope: containerRef },
  );

  const handleRedirect = () => {
    if (!containerRef.current) return;
    const tl = gsap.timeline({ defaults: { ease: 'power3.in' } });
    tl.to('.form-element', {
      x: 15,
      opacity: 0,
      stagger: 0.15,
      duration: 0.3,
    });
    tl.to(
      '.article-element',
      {
        x: -15,
        opacity: 0,
        stagger: 0.15,
        duration: 0.3,
      },
      '<+0.1',
    );
    tl.to(
      '.rotational-asset',
      {
        rotation: 0,
        x: 0,
        y: 0,
        duration: 0.75,
      },
      '<+0.5',
    );
    tl.to(
      '.principal-card',
      {
        y: 20,
        opacity: 0,
        transform: 'scale(0.9)',
        duration: 0.5,
        onComplete: () => {
          const destine = search.redirect ?? '/panel/productos';
          navigate({
            to: destine,
          });
        },
      },
      '<',
    );
  };

  const onSubmit = async (data: LoginType) => {
    if (isPending) return;
    login(data, {
      onSuccess: () => {
        reset();
        handleRedirect();
      },
      onError: () => {},
    });
  };

  const handleAutocomplete = async (event: React.FormEvent<HTMLInputElement>) => {
    const nativeEvent = event.nativeEvent as InputEvent;
    if (
      nativeEvent.inputType === undefined &&
      nativeEvent.data === undefined &&
      nativeEvent.dataTransfer === undefined &&
      nativeEvent.isComposing === undefined &&
      !formState.isSubmitting
    ) {
      const isValid = await trigger();
      if (isValid) {
        handleSubmit(onSubmit)();
      }
    }
  };

  const handleRegister = (e: MouseEvent) => {
    e.preventDefault();
    if (!containerRef.current) return;
    const tl = gsap.timeline({ defaults: { ease: 'power3.in' } });
    tl.to('.form-element', {
      x: 15,
      opacity: 0,
      stagger: 0.15,
      duration: 0.3,
    });
    tl.to(
      '.article-element',
      {
        x: -15,
        opacity: 0,
        stagger: 0.15,
        duration: 0.3,
      },
      '<+0.1',
    );
    tl.to(
      '.rotational-asset',
      {
        rotation: 0,
        x: 0,
        y: 0,
        duration: 0.75,
        onComplete: () => {
          navigate({
            to: '/sesion/registro',
          });
        },
      },
      '<+0.5',
    );
  };

  const requiredPatternsContextValue = useMemo(
    () => ({ requiredPatterns: loginRequiredPatterns }),
    [],
  );

  return (
    <div ref={containerRef} className="w-full flex justify-center items-center">
      <section className="principal-card relative p-6 sm:p-12 bg-white border-none shadow-xl/15 rounded-xl gap-20 md:gap-30 flex flex-col md:flex-row items-center justify-center overflow-hidden">
        <div className="rotational-asset absolute w-[150%] h-[110%] md:w-[110%] md:h-[150%] -rotate-15 origin-bottom md:origin-right -translate-y-7/12 md:translate-y-0 md:-translate-x-1/2 blur-lg bg-gradient-to-l md:bg-gradient-to-b from-cream to-blossom"></div>
        <div className="flex">
          <div className="flex flex-col items-center justify-center gap-4 md:gap-6 z-10">
            <h2 className="article-element text-2xl font-bold text-black select-none">
              {t('modules.sesion.login.welcomeMessage')}
            </h2>
            <p className="article-element text-lg text-black select-none text-center max-w-55">
              {t('modules.sesion.login.subtitle')}
            </p>
            <div className="article-element w-24 h-32 overflow-hidden">
              <img
                src={logo}
                alt={t('components.pageLoader.logo')}
                className="w-full h-full object-cover object-center select-none"
                aria-label={t('components.pageLoader.logo')}
              />
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-6 justify-center items-center">
          <h2 className="form-element text-2xl font-bold text-black select-none">
            {t('modules.sesion.login.title')}
          </h2>
          <RequiredPatternsContext.Provider value={requiredPatternsContextValue}>
            <FormProvider {...methods}>
              <form
                onSubmit={handleSubmit(onSubmit)}
                className="w-full flex flex-col items-center gap-6"
              >
                <div className="form-element w-full">
                  <CustomInputForm<LoginType>
                    id="email-input"
                    data-testid="email-input"
                    autoComplete="email"
                    label={t('modules.sesion.login.form.emailLabel')}
                    placeholder={t('modules.sesion.login.form.emailPlaceholder')}
                    aria-label={t('modules.sesion.login.form.emailLabel')}
                    name="email"
                    icon={<FaUserAlt />}
                    onInput={handleAutocomplete}
                  />
                </div>
                <div className="form-element w-full">
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
                <div className="form-element flex flex-col items-center">
                  <CustomButton
                    text={t('modules.sesion.login.form.submitButton')}
                    disabled={!formState.isValid}
                    loading={formState.isSubmitting}
                  />
                </div>

                <p className="form-element text-xs text-gray-500 flex flex-col items-center">
                  <span>{t('modules.sesion.login.form.noAccount')}</span>
                  <span>
                    {t('modules.sesion.login.form.signUpLink')}{' '}
                    <Link onClick={handleRegister} className="text-magenta hover:underline">
                      {t('modules.sesion.login.form.here')}
                    </Link>
                  </span>
                </p>
              </form>
            </FormProvider>
          </RequiredPatternsContext.Provider>
        </div>
      </section>
    </div>
  );
};

export default LoginPage;
