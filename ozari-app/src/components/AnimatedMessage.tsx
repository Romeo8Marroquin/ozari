import React, { useRef, useState } from 'react';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';

interface AnimatedMessageProps {
  errorMessage?: string;
  instructions?: string;
  focusColor?: string;
  id?: string;
}

const textClass: Record<string, string> = {
  midnight: 'text-midnight',
};

const AnimatedMessage: React.FC<AnimatedMessageProps> = ({
  errorMessage,
  instructions,
  focusColor = 'midnight',
  id,
}) => {
  const containerRef = useRef<HTMLParagraphElement>(null);
  const [showed, setShowed] = useState<string | undefined>(undefined);

  useGSAP(
    () => {
      const tl = gsap.timeline({ defaults: { duration: 0.2, ease: 'power1.inOut' } });
      tl.to(containerRef.current, { y: -9, opacity: 0 })
        .add(() => {
          setShowed(errorMessage ?? instructions);
        })
        .to(containerRef.current, { y: 0, opacity: 1 });
    },
    // Re-run when EITHER the error or the instructions change, so a field whose hint is dynamic (e.g.
    // a per-product availability count) updates its text — not only when an error toggles.
    { scope: containerRef, dependencies: [errorMessage, instructions] },
  );

  return (
    <p
      ref={containerRef}
      id={id}
      role="alert"
      className={`ml-1.5 mt-[3px] text-xs ${errorMessage ? 'text-red-600' : textClass[focusColor]}`}
    >
      {showed}&nbsp;
    </p>
  );
};

export default AnimatedMessage;
