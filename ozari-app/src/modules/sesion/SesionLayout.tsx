import { useGSAP } from '@gsap/react';
import { Outlet } from '@tanstack/react-router';
import gsap from 'gsap';
import { useLayoutEffect, useRef } from 'react';

/** Where the auth background gradient ENDS — the tone any over-scrolled canvas strip must wear. */
const GRADIENT_EDGE = '#e7e0e8';

const SesionLayout: React.FC = () => {
  const container = useRef<HTMLDivElement>(null);

  // Mobile keyboards shrink only the VISUAL viewport; over-scrolling then exposes the document
  // canvas below this section. Repaint the canvas with the gradient's edge colour while the auth
  // screens are mounted (and restore the app default on leave) so that strip is indistinguishable
  // from the design instead of a white band.
  useLayoutEffect(() => {
    const previous = document.documentElement.style.backgroundColor;
    document.documentElement.style.backgroundColor = GRADIENT_EDGE;
    return () => {
      document.documentElement.style.backgroundColor = previous;
    };
  }, []);

  useGSAP(
    () => {
      /* v8 ignore next -- defensive: the scoped ref is always attached when useGSAP runs */
      if (!container.current) return;
      gsap.from(container.current, {
        opacity: 0,
        duration: 0.3,
        ease: 'power1.in',
      });
      gsap.from('.transition-container', {
        y: 20,
        opacity: 0,
        transform: 'scale(0.9)',
        duration: 0.5,
        ease: 'power3.out',
      });
    },
    { scope: container },
  );

  return (
    <section
      ref={container}
      style={{
        background:
          'radial-gradient(120% 120% at 50% 0%, #faf7fa 0%, #efeaf0 58%, #e7e0e8 100%)',
      }}
      className="relative px-6 py-6 sm:px-0 w-full min-h-dvh overflow-auto flex items-center"
    >
      <div className="transition-container flex items-center w-full h-full">
        <Outlet />
      </div>
    </section>
  );
};

export default SesionLayout;
