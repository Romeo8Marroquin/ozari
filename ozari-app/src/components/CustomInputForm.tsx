import React from 'react';
import { Controller, useFormContext, type FieldValues, type Path } from 'react-hook-form';
import CustomInput from './CustomInput';
import useRequiredPatterns from '../contexts/RequiredFieldsContext';
import AnimatedMessage from './AnimatedMessage';

interface CustomInputFormProps<T extends FieldValues>
  extends React.InputHTMLAttributes<HTMLInputElement> {
  name: Path<T>;
  label: string;
  enableIconPointerEvents?: boolean;
  focusColor?: string;
  icon?: React.ReactNode;
  instructions?: string;
  optionalLabel?: boolean;
  ref?: React.RefObject<HTMLInputElement | null>;
  onIconClick?: () => void;
}

const CustomInputForm = function <T extends FieldValues>({
  name,
  instructions = '',
  focusColor,
  ref,
  ...props
}: CustomInputFormProps<T>) {
  const { control } = useFormContext<T>();
  const requiredPatterns = useRequiredPatterns();
  const isRequired = requiredPatterns.some((pattern) => pattern.test(name));

  return (
    <Controller
      name={name}
      control={control}
      render={({ field, fieldState: { error } }) => {
        const combinedRef = (element: HTMLInputElement | null) => {
          field.ref(element);
          if (typeof ref === 'object' && ref !== null) ref.current = element;
        };
        return (
          <div className="w-full flex flex-col">
            <CustomInput
              {...props}
              {...field}
              focusColor={focusColor}
              error={Boolean(error)}
              ref={combinedRef}
              isRequired={isRequired}
            />
            <AnimatedMessage
              errorMessage={error?.message}
              focusColor={focusColor}
              instructions={instructions}
            />
          </div>
        );
      }}
    />
  );
};

export default CustomInputForm;
