import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { useRef } from 'react';
import { twMerge } from 'tailwind-merge';

interface SesionCardProps {
  children: React.ReactNode;
  className?: string;
}

function SesionCard({ children, className }: Readonly<SesionCardProps>) {
  const cardRef = useRef<HTMLElement>(null);
  useGSAP(
    () => {
      gsap.from(cardRef.current, {
        opacity: 0,
        scale: 0.95,
        delay: 0.3,
        duration: 0.3,
        ease: 'power1.in',
      });
    },
    { scope: cardRef },
  );
  return (
    <section
      ref={cardRef}
      className={twMerge(
        'w-full sm:max-w-3/4 md:max-w-2/3 lg:max-w-1/2 xl:max-w-1/3 3xl:max-w-1/4 p-8 rounded-xl shadow-xl bg-white/50 flex flex-col items-center gap-8',
        className,
      )}
    >
      {children}
    </section>
  );
}

export default SesionCard;
