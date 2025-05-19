import React, { useRef } from 'react';
import { gsap } from 'gsap';
import { FaUserAlt, FaLock } from 'react-icons/fa';
import { useGSAP } from '@gsap/react';
import SesionCard from '@sesion/components/SesionCard';
import CustomInput from '@components/CustomInput';

const LoginPage: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      gsap.from('.stagger', {
        opacity: 0,
        y: -5,
        delay: 0.6,
        duration: 0.3,
        ease: 'power1.inOut',
        stagger: 0.05,
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
            <CustomInput icon={<FaUserAlt />} placeholder="Ingresa tu usuario" label="Usuario" />
          </div>
          <div className="stagger relative">
            <input
              type="password"
              id="password"
              name="password"
              autoComplete="current-password"
              placeholder="Contraseña"
              className="w-full py-3 pl-12 pr-4 rounded-xl bg-white/60 text-gray-800 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blossom focus:bg-white/90 transition-all duration-300 shadow-md"
              required
              aria-label="Contraseña"
            />
            <FaLock className="absolute left-4 top-1/2 -translate-y-1/2 text-blossom text-lg pointer-events-none" />
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
    </div>
  );
};

export default LoginPage;
