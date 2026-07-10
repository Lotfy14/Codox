import {
  FieldError,
  SwitchButton,
  SwitchField,
  Text,
} from 'react-aria-components/Switch';
import type { SwitchFieldProps } from 'react-aria-components/Switch';
import type { ReactNode } from 'react';

export interface ToggleProps
  extends Omit<SwitchFieldProps, 'children' | 'className'> {
  className?: string;
  description?: ReactNode;
  errorMessage?: ReactNode;
  label: ReactNode;
}

/** A labelled on/off setting implemented with React Aria's switch pattern. */
export function Toggle({
  className,
  description,
  errorMessage,
  label,
  ...switchProps
}: ToggleProps) {
  const classes = ['ds-toggle', className].filter(Boolean).join(' ');

  return (
    <SwitchField {...switchProps} className={classes}>
      <SwitchButton className="ds-toggle__control">
        <span aria-hidden="true" className="ds-toggle__track">
          <span className="ds-toggle__thumb" />
        </span>
        <span className="ds-toggle__label">{label}</span>
      </SwitchButton>
      {description !== undefined ? (
        <Text className="ds-toggle__description" slot="description">
          {description}
        </Text>
      ) : null}
      {errorMessage !== undefined ? (
        <FieldError className="ds-toggle__error">{errorMessage}</FieldError>
      ) : null}
    </SwitchField>
  );
}
