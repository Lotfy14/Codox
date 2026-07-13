import type { HTMLAttributes, ReactNode } from 'react';

export type StatusChipStatus =
  | 'checking'
  | 'idle'
  | 'quota-paused'
  | 'setup-required'
  | 'unreachable'
  | 'working'
  | 'wrong-key';

export type ProviderStatus = StatusChipStatus;

export interface StatusChipProps
  extends Omit<
    HTMLAttributes<HTMLSpanElement>,
    'aria-atomic' | 'aria-live' | 'children' | 'role'
  > {
  children?: ReactNode;
  status: StatusChipStatus;
}

const statusLabels: Readonly<Record<StatusChipStatus, string>> = {
  checking: 'Checking',
  idle: 'Not checked',
  'quota-paused': 'Resting until quota returns',
  'setup-required': 'Setup required',
  unreachable: "Can't reach",
  working: 'Working',
  'wrong-key': 'Wrong key',
};

/** A plain-language provider state that announces only complete status changes. */
export function StatusChip({
  children,
  className,
  status,
  ...spanProps
}: StatusChipProps) {
  const classes = ['ds-status-chip', `ds-status-chip--${status}`, className]
    .filter(Boolean)
    .join(' ');

  return (
    <span
      {...spanProps}
      aria-atomic="true"
      aria-live="polite"
      className={classes}
      data-status={status}
      role="status"
    >
      <span aria-hidden="true" className="ds-status-chip__indicator" />
      <span className="ds-status-chip__label">
        {children ?? statusLabels[status]}
      </span>
    </span>
  );
}
