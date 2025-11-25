import { useGSAP } from '@gsap/react';
import { Outlet } from '@tanstack/react-router';
import gsap from 'gsap';
import { useRef } from 'react';

const SesionLayout: React.FC = () => {
  const container = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      gsap.from(container.current, {
        opacity: 0,
        duration: 0.3,
        ease: 'power1.in',
      });
    },
    { scope: container },
  );

  return (
    <div
      ref={container}
      className="relative px-6 py-12 sm:px-0 w-full min-h-screen flex items-center bg-customWhite"
    >
      <Outlet />
    </div>
  );
};

export default SesionLayout;
