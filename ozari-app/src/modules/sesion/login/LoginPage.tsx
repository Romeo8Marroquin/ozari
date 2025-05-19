import React, { useRef } from 'react';
import { gsap } from 'gsap';
import { FaUserAlt } from 'react-icons/fa';
import { useGSAP } from '@gsap/react';
import SesionCard from '@sesion/components/SesionCard';
import CustomInputForm from '@components/CustomInputForm';
import { useForm } from 'react-hook-form';
import { DevTool } from '@hookform/devtools';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  LOWER_REGEX,
  NUMBER_REGEX,
  SAFE_SYMBOL_REGEX,
  UNSAFE_SYMBOL_REGEX,
  UPPER_REGEX,
} from '@constants/Regex';

const loginSchema = z.object({
  email: z
    .string()
    .nonempty('El correo electrónico es obligatorio')
    .email('El correo electrónico debe tener un formato válido')
    .max(128, 'El correo electrónico no puede exceder 128 caracteres'),

  password: z
    .string()
    .nonempty('La contraseña es obligatoria')
    .min(12, 'La contraseña debe tener al menos 12 caracteres')
    .max(128, 'La contraseña no puede exceder 128 caracteres')
    .refine(
      (val) => UPPER_REGEX.test(val),
      'La contraseña debe contener al menos una letra mayúscula',
    )
    .refine(
      (val) => LOWER_REGEX.test(val),
      'La contraseña debe contener al menos una letra minúscula',
    )
    .refine((val) => NUMBER_REGEX.test(val), 'La contraseña debe contener al menos un número')
    .refine((val) => SAFE_SYMBOL_REGEX.test(val), 'La contraseña debe contener al menos un símbolo')
    .refine(
      (val) => !UNSAFE_SYMBOL_REGEX.test(val),
      'La contraseña no puede contener caracteres inválidos',
    ),
});

type LoginFormValues = z.infer<typeof loginSchema>;

const LoginPage: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);

  const { control } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: '',
      password: '',
    },
    mode: 'onTouched',
  });

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

  return (
    <div ref={containerRef} className="w-full flex justify-center items-center">
      <SesionCard>
        <h2 className="stagger text-2xl font-bold text-black select-none">INICIAR SESIÓN</h2>
        <form className="w-full flex flex-col gap-6">
          <div className="stagger">
            <CustomInputForm
              id="email"
              data-testid="email-input"
              autoComplete="email"
              aria-label="Correo"
              control={control}
              name="email"
              icon={<FaUserAlt />}
              placeholder="Ingresa tu correo"
              label="Correo"
            />
          </div>
          <div className="stagger">
            <CustomInputForm
              id="password"
              data-testid="password-input"
              autoComplete="password"
              aria-label="Contraseña"
              control={control}
              name="password"
              placeholder="Ingresa tu contraseña"
              label="Contraseña"
              type="password"
            />
          </div>
          <button
            type="submit"
            className="stagger cursor-pointer mt-2 w-full py-3 rounded-xl bg-blossom text-white font-semibold text-lg shadow-lg hover:bg-plum active:scale-95 focus:outline-none focus:ring-2 focus:ring-blossom"
          >
            ENTRAR
          </button>
        </form>
        <button className="stagger cursor-pointer mt-6 text-center">
          <span className="text-gray">¿Nuevo en eBanking? </span>
          <a
            href="/sesion/registro"
            className="text-blossom font-semibold hover:underline hover:text-plum transition-colors duration-200"
          >
            Regístrate aquí
          </a>
        </button>
      </SesionCard>
      <DevTool control={control} />
    </div>
  );
};

export default LoginPage;
