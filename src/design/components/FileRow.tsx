import type { HTMLAttributes, ReactNode } from 'react';

export interface FileRowProps
  extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  children?: ReactNode;
  flagLabel: string;
  flagged?: boolean;
  isDisabled?: boolean;
  name: string;
  onRemove?: () => void;
  /** Shown before the size, e.g. "14 pages". */
  pageCountLabel?: string;
  removeLabel: string;
  size: number | string;
}

const fileSizeFormatter = new Intl.NumberFormat('en', {
  maximumFractionDigits: 1,
});

function formatFileSize(size: number | string) {
  if (typeof size === 'string') {
    return size;
  }

  const safeSize = Number.isFinite(size) ? Math.max(0, size) : 0;
  const units = ['B', 'KB', 'MB', 'GB', 'TB'] as const;
  let value = safeSize;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${fileSizeFormatter.format(value)} ${units[unitIndex]}`;
}

/** A solid PDF row: type badge, name, size, optional flag and remove. */
export function FileRow({
  children,
  className,
  flagLabel,
  flagged = false,
  isDisabled = false,
  name,
  onRemove,
  pageCountLabel,
  removeLabel,
  size,
  ...divProps
}: FileRowProps) {
  const classes = [
    'ds-file-row',
    flagged ? 'ds-file-row--flagged' : undefined,
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div {...divProps} className={classes} data-flagged={flagged || undefined}>
      <span aria-hidden="true" className="ds-file-row__file-type">
        PDF
      </span>
      <span className="ds-file-row__details">
        <span className="ds-file-row__name">{name}</span>
        <span className="ds-file-row__size">
          {pageCountLabel !== undefined
            ? `${pageCountLabel} · ${formatFileSize(size)}`
            : formatFileSize(size)}
        </span>
      </span>
      {flagged ? (
        <span className="ds-file-row__flag">{flagLabel}</span>
      ) : null}
      {children !== undefined ? (
        <div className="ds-file-row__extra">{children}</div>
      ) : null}
      {onRemove !== undefined ? (
        <button
          aria-label={removeLabel}
          className="ds-file-row__remove"
          disabled={isDisabled}
          onClick={onRemove}
          type="button"
        >
          <span aria-hidden="true">×</span>
        </button>
      ) : null}
    </div>
  );
}
