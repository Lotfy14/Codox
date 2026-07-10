import type { HTMLAttributes, ReactNode } from 'react';

export type BadgeTone =
  | 'danger'
  | 'neutral'
  | 'primary'
  | 'success'
  | 'warning';

export interface BadgeProps
  extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  children: ReactNode;
  tone?: BadgeTone;
}

/** A quiet, non-interactive label. Live updates need a separate status region. */
export function Badge({
  children,
  className,
  tone = 'neutral',
  ...spanProps
}: BadgeProps) {
  const classes = ['ds-badge', `ds-badge--${tone}`, className]
    .filter(Boolean)
    .join(' ');

  return (
    <span
      {...spanProps}
      className={classes}
      data-tone={tone}
    >
      {children}
    </span>
  );
}
