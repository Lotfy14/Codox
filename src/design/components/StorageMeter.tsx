import type { HTMLAttributes } from 'react';

export interface StorageMeterProps
  extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  /** 'percent' shows only the percentage beside the label (sidebar foot). */
  detail?: 'full' | 'percent';
  formatValue?: (value: number) => string;
  label: string;
  total: number;
  used: number;
}

const storageNumberFormatter = new Intl.NumberFormat('en', {
  maximumFractionDigits: 1,
});

function formatBytes(bytes: number) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'] as const;
  let value = Math.max(0, bytes);
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${storageNumberFormatter.format(value)} ${units[unitIndex]}`;
}

function normalizeStorageValue(value: number) {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

/** A determinate meter for the app's locally used storage. */
export function StorageMeter({
  className,
  detail = 'full',
  formatValue = formatBytes,
  label,
  total,
  used,
  ...divProps
}: StorageMeterProps) {
  const safeTotal = normalizeStorageValue(total);
  const meterMaximum = safeTotal > 0 ? safeTotal : 1;
  const safeUsed = Math.min(normalizeStorageValue(used), safeTotal);
  const ratio = safeTotal > 0 ? safeUsed / safeTotal : 0;
  const percent = Math.round(ratio * 100);
  const usedText = formatValue(safeUsed);
  const totalText = formatValue(safeTotal);
  const valueText = `${usedText} of ${totalText} used, ${percent}%`;
  const classes = ['ds-storage-meter', className].filter(Boolean).join(' ');

  return (
    <div {...divProps} className={classes}>
      <span className="ds-storage-meter__header">
        <span className="ds-storage-meter__label">{label}</span>
        <span aria-hidden="true" className="ds-storage-meter__value">
          {detail === 'percent'
            ? `${percent}%`
            : `${usedText} of ${totalText} · ${percent}%`}
        </span>
      </span>
      <div
        aria-label={label}
        aria-valuemax={meterMaximum}
        aria-valuemin={0}
        aria-valuenow={safeUsed}
        aria-valuetext={valueText}
        className="ds-storage-meter__track"
        role="meter"
      >
        <span
          aria-hidden="true"
          className="ds-storage-meter__fill"
          style={{ transform: `scaleX(${ratio})` }}
        />
      </div>
    </div>
  );
}
