import type { HTMLAttributes } from 'react';

export interface ProgressBarProps
  extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  label?: string;
  max?: number;
  showFraction?: boolean;
  value: number;
}

const numberFormatter = new Intl.NumberFormat('en', {
  maximumFractionDigits: 2,
});

function normalizeMaximum(max: number) {
  return Number.isFinite(max) && max > 0 ? max : 100;
}

function normalizeValue(value: number, max: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(Math.max(value, 0), max);
}

/** A determinate progress bar. Its value should advance only on real work. */
export function ProgressBar({
  className,
  label,
  max = 100,
  showFraction = true,
  value,
  ...divProps
}: ProgressBarProps) {
  const safeMax = normalizeMaximum(max);
  const safeValue = normalizeValue(value, safeMax);
  const ratio = safeValue / safeMax;
  const percent = Math.round(ratio * 100);
  const fraction = `${numberFormatter.format(safeValue)}/${numberFormatter.format(safeMax)}`;
  const visibleValue = showFraction ? `${fraction} · ${percent}%` : `${percent}%`;
  const classes = ['ds-progress-bar', className].filter(Boolean).join(' ');

  return (
    <div
      {...divProps}
      className={classes}
      data-complete={safeValue === safeMax || undefined}
    >
      {label !== undefined ? (
        <span className="ds-progress-bar__label">{label}</span>
      ) : null}
      <div
        aria-label={label ?? 'Progress'}
        aria-valuemax={safeMax}
        aria-valuemin={0}
        aria-valuenow={safeValue}
        aria-valuetext={`${fraction}, ${percent}%`}
        className="ds-progress-bar__track"
        role="progressbar"
      >
        <span
          aria-hidden="true"
          className="ds-progress-bar__fill"
          style={{ transform: `scaleX(${ratio})` }}
        />
        <span aria-hidden="true" className="ds-progress-bar__value">
          {visibleValue}
        </span>
      </div>
    </div>
  );
}
