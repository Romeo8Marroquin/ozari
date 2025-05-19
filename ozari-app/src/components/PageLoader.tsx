import logo from '@assets/svgs/logo.svg';
import { useTranslation } from 'react-i18next';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import { useRef } from 'react';

export default function PageLoader() {
  const { t } = useTranslation();
  const container = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      gsap.from(container.current, {
        opacity: 0,
        duration: 0.2,
        ease: 'power1.inOut',
      });
      gsap.from('div', {
        opacity: 0,
        scale: 0.5,
        duration: 0.5,
        ease: 'power1.in',
      });
      gsap.from('img', {
        opacity: 0,
        scale: 0.9,
        duration: 0.4,
        ease: 'power1.in',
      });
      gsap.to('div', {
        rotate: 360,
        duration: 1,
        repeat: -1,
        ease: 'linear',
      });
    },
    { scope: container },
  );

  return (
    <section
      ref={container}
      className="fixed top-0 left-0 inset-0 flex flex-col items-center justify-center gap-2 bg-gradient-to-br from-aqua to-blossom"
    >
      <img
        src={logo}
        alt={t('components.pageLoader.logo')}
        className="max-w-24 w-24 md:max-w-32 md:w-32"
        aria-label={t('components.pageLoader.logo')}
      />

      <div
        className="absolute size-52 md:size-72 rounded-full border border-solid border-white border-y-blossom opacity-80"
        aria-hidden="true"
      />
    </section>
  );
}
