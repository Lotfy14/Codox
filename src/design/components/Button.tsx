import { Button as AriaButton } from 'react-aria-components/Button';
import type { ButtonProps as AriaButtonProps } from 'react-aria-components/Button';
import type { ReactNode } from 'react';

export type ButtonVariant =
  | 'danger'
  | 'primary'
  | 'quiet'
  | 'secondary';

export interface ButtonProps
  extends Omit<AriaButtonProps, 'children' | 'className' | 'isPending'> {
  children: ReactNode;
  className?: string;
  title?: string;
  /** Alias for isPending, matching the app's loading language. */
  isLoading?: boolean;
  /** The React Aria name for an in-flight action. */
  isPending?: boolean;
  loadingLabel?: ReactNode;
  variant?: ButtonVariant;
}

/** An action button whose pending state remains focusable but cannot re-fire. */
export function Button({
  children,
  className,
  isLoading = false,
  isPending = false,
  loadingLabel = 'Working…',
  variant = 'primary',
  ...buttonProps
}: ButtonProps) {
  const pending = isLoading || isPending;
  const classes = [
    'ds-button',
    `ds-button--${variant}`,
    pending ? 'ds-button--pending' : undefined,
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <AriaButton
      {...buttonProps}
      aria-busy={pending || undefined}
      className={classes}
      data-variant={variant}
      isPending={pending}
    >
      <span className="ds-button__content">
        {pending ? (
          <span aria-hidden="true" className="ds-button__spinner" />
        ) : null}
        <span className="ds-button__label">
          {pending ? loadingLabel : children}
        </span>
      </span>
    </AriaButton>
  );
}
