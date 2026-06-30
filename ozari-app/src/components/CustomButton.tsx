import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { useRef, useState } from 'react';

interface CustomButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  text?: string;
  startIcon?: React.ReactNode;
  endIcon?: React.ReactNode;
  buttonType?: 'outlined';
  buttonColor?: 'magenta' | 'midnight' | 'sky' | 'blossom' | 'cream' | 'yellow' | 'aqua';
  loading?: boolean;
}

const buttonClasses = {
  outlined: {
    magenta:
      'border-3 border-magenta text-magenta hover:shadow-[0_0_10px_0.5px_var(--color-magenta)] focus:shadow-[0_0_15px_0.5px_var(--color-magenta)]',
    midnight:
      'border-3 border-midnight text-midnight hover:shadow-[0_0_10px_0.5px_var(--color-midnight)] focus:shadow-[0_0_15px_0.5px_var(--color-midnight)]',
    sky: 'border-3 border-sky text-sky hover:shadow-[0_0_10px_0.5px_var(--color-sky)] focus:shadow-[0_0_15px_0.5px_var(--color-sky)]',
    blossom:
      'border-3 border-blossom text-blossom hover:shadow-[0_0_10px_0.5px_var(--color-blossom)] focus:shadow-[0_0_15px_0.5px_var(--color-blossom)]',
    cream:
      'border-3 border-cream text-cream hover:shadow-[0_0_10px_0.5px_var(--color-cream)] focus:shadow-[0_0_15px_0.5px_var(--color-cream)]',
    yellow:
      'border-3 border-yellow text-yellow hover:shadow-[0_0_10px_0.5px_var(--color-yellow)] focus:shadow-[0_0_15px_0.5px_var(--color-yellow)]',
    aqua: 'border-3 border-aqua text-aqua hover:shadow-[0_0_10px_0.5px_var(--color-aqua)] focus:shadow-[0_0_15px_0.5px_var(--color-aqua)]',
  },
};

const loaderColors = {
  magenta: 'border-magenta',
  midnight: 'border-midnight',
  sky: 'border-sky',
  blossom: 'border-blossom',
  cream: 'border-cream',
  yellow: 'border-yellow',
  aqua: 'border-aqua',
};

const CustomButton: React.FC<CustomButtonProps> = ({
  text,
  startIcon,
  endIcon,
  buttonType = 'outlined',
  buttonColor = 'midnight',
  loading = false,
  className,
  ...props
}: CustomButtonProps) => {
  const loadingRef = useRef<HTMLSpanElement>(null);
  const [showingLoading, setShowingLoading] = useState(false);

  useGSAP(
    () => {
      const tl = gsap.timeline({ defaults: { ease: 'power1.inOut', duration: 0.2 } });
      if (loading) {
        setShowingLoading(true);
      } else {
        // Only animate if the loading element exists
        if (loadingRef.current) {
          tl.to(loadingRef.current, {
            opacity: 0,
            width: 0,
            height: 0,
            marginRight: 0,
          }).add(() => {
            if (!loading) setShowingLoading(false);
          });
        } else {
          // If element doesn't exist, just update state immediately
          setShowingLoading(false);
        }
      }
    },
    { dependencies: [loading, setShowingLoading] },
  );

  useGSAP(
    () => {
      const tl = gsap.timeline({
        defaults: { ease: 'power1.inOut', duration: 0.2 },
      });
      // Only animate if showingLoading is true AND the ref exists
      if (!showingLoading || !loadingRef.current) return;

      tl.to(loadingRef.current, {
        opacity: 1,
        width: 20,
        height: 20,
        marginRight: 8,
      });
    },
    { dependencies: [showingLoading] },
  );

  return (
    <button
      className={`
        cursor-pointer py-3 px-4 rounded-md text-lg font-semibold outline-none select-none transition-all duration-200 flex items-center
        disabled:pointer-events-none disabled:text-gray-400 disabled:bg-gray-100 disabled:border-gray-200
        ${buttonClasses[buttonType]?.[buttonColor]} ${className} ${
        loading ? 'pointer-events-none' : ''
      }`}
      aria-busy={loading || undefined}
      {...props}
    >
      {showingLoading && (
        <span
          key={`loading-${buttonColor}`}
          ref={loadingRef}
          className={`block border-3 border-t-transparent rounded-full animate-spin ${loaderColors[buttonColor]}`}
        ></span>
      )}
      {startIcon && <span className="mr-2">{startIcon}</span>}
      {text}
      {endIcon && <span className="ml-2">{endIcon}</span>}
    </button>
  );
};

export default CustomButton;
