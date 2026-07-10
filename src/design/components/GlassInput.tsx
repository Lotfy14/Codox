import {
  FieldError,
  Input as AriaInput,
  Label,
  Text,
  TextField,
} from 'react-aria-components/TextField';
import type {
  InputProps as AriaInputProps,
  TextFieldProps as AriaTextFieldProps,
} from 'react-aria-components/TextField';
import type { ReactNode, Ref } from 'react';

export type GlassInputStatus = 'default' | 'error' | 'success';

type NativeInputProps = Omit<
  AriaInputProps,
  | 'className'
  | 'defaultValue'
  | 'disabled'
  | 'form'
  | 'inputMode'
  | 'maxLength'
  | 'minLength'
  | 'name'
  | 'onChange'
  | 'placeholder'
  | 'readOnly'
  | 'required'
  | 'spellCheck'
  | 'type'
  | 'value'
>;

export interface GlassInputProps
  extends Omit<
    AriaTextFieldProps,
    'children' | 'className' | 'isInvalid'
  > {
  className?: string;
  description?: ReactNode;
  errorMessage?: ReactNode;
  inputClassName?: string;
  /** Additional native-only props. Value and field semantics belong on GlassInput. */
  inputProps?: NativeInputProps;
  inputRef?: Ref<HTMLInputElement>;
  isInvalid?: boolean;
  label: ReactNode;
  status?: GlassInputStatus;
  successMessage?: ReactNode;
}

/** A labelled glass text field with linked help, error, and success text. */
export function GlassInput({
  className,
  description,
  errorMessage,
  inputClassName,
  inputProps,
  inputRef,
  isInvalid: isInvalidProp = false,
  label,
  status = 'default',
  successMessage,
  ...textFieldProps
}: GlassInputProps) {
  const isInvalid = isInvalidProp || status === 'error';
  const resolvedStatus: GlassInputStatus = isInvalid ? 'error' : status;
  const hasDescription =
    description !== undefined ||
    (resolvedStatus === 'success' && successMessage !== undefined);
  const rootClasses = [
    'ds-glass-input',
    `ds-glass-input--${resolvedStatus}`,
    className,
  ]
    .filter(Boolean)
    .join(' ');
  const controlClasses = ['glass-input', 'ds-glass-input__control', inputClassName]
    .filter(Boolean)
    .join(' ');

  return (
    <TextField
      {...textFieldProps}
      className={rootClasses}
      data-status={resolvedStatus}
      isInvalid={isInvalid}
    >
      <Label className="ds-glass-input__label">{label}</Label>
      <AriaInput
        {...inputProps}
        ref={inputRef}
        className={controlClasses}
      />
      {hasDescription ? (
        <Text className="ds-glass-input__description" slot="description">
          {description !== undefined ? (
            <span className="ds-glass-input__help">{description}</span>
          ) : null}
          {resolvedStatus === 'success' && successMessage !== undefined ? (
            <span
              aria-live="polite"
              className="ds-glass-input__success"
            >
              {successMessage}
            </span>
          ) : null}
        </Text>
      ) : null}
      {errorMessage !== undefined ? (
        <FieldError className="ds-glass-input__error">
          {errorMessage}
        </FieldError>
      ) : null}
    </TextField>
  );
}
