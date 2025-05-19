import React, { useCallback, forwardRef, useRef, useState } from 'react';
import {
  useController,
  useFormContext,
  type FieldValues,
  type Path,
  type UseControllerProps,
  type UseFormReturn,
} from 'react-hook-form';
import CustomInput from './CustomInput';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';

interface RHFInputProps<TFieldValues extends FieldValues>
  extends React.InputHTMLAttributes<HTMLInputElement> {
  name: Path<TFieldValues>;
  label: string;
  control?: UseFormReturn<TFieldValues>['control'];
  rules?: UseControllerProps<TFieldValues>['rules'];
  enableIconPointerEvents?: boolean;
  focusColor?: string;
  icon?: React.ReactNode;
  instructions?: string;
  optionalLabel?: boolean;
  onIconClick?: () => void;
}

const InputForm = function <TFieldValues extends FieldValues>(
  { name, control, rules, instructions = '', ...props }: RHFInputProps<TFieldValues>,
  ref: React.Ref<HTMLInputElement>,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const contextForm = useFormContext() as UseFormReturn<TFieldValues> | null;
  const localInputRef = useRef<HTMLInputElement>(null);
  const [showedError, setShowedError] = useState<string | undefined>(undefined);
  const formControl = control ?? contextForm?.control;
  const {
    field: { value, ref: controllerRef, ...controllerProps },
    fieldState: { error },
  } = useController({
    name,
    control: formControl,
    rules,
  });

  const combinedRef = useCallback(
    (element: HTMLInputElement) => {
      if (ref) {
        if (typeof ref === 'function') ref(element);
        else ref.current = element;
      }
      controllerRef(element);
      localInputRef.current = element;
    },
    [ref, controllerRef],
  );

  useGSAP(
    () => {
      const timeline = gsap.timeline({ defaults: { duration: 0.2, ease: 'power1.inOut' } });
      timeline
        .to('p', {
          y: -9,
          opacity: 0,
        })
        .add(() => {
          setShowedError(error?.message);
        })
        .to('p', {
          y: 0,
          opacity: 1,
        });
    },
    { scope: containerRef, dependencies: [error] },
  );

  return (
    <div ref={containerRef} className="w-fit flex flex-col">
      <CustomInput
        {...props}
        {...controllerProps}
        ref={combinedRef}
        value={value}
        error={Boolean(error)}
      />
      <p
        role="alert"
        className={`ml-1.5 mt-[3px] text-xs ${showedError ? 'text-red-600' : 'text-' + (props.focusColor ?? 'midnight')}`}
      >
        {showedError ?? instructions}&nbsp;
      </p>
    </div>
  );
};

const CustomInputForm = forwardRef(InputForm) as <TFieldValues extends FieldValues = FieldValues>(
  props: RHFInputProps<TFieldValues> & {
    ref?: React.Ref<HTMLInputElement>;
  },
) => ReturnType<typeof InputForm>;

export default CustomInputForm;
