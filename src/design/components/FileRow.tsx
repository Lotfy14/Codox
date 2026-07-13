import type { HTMLAttributes, ReactNode } from 'react';
import type { SelectOption } from './Select';
import { Select } from './Select';

export type FileAnswerSource = 'inside' | 'key-file' | 'none';

type FileAnswerSourceSelection = 'batch-default' | FileAnswerSource;

export interface FileRowProps
  extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  answerSource?: FileAnswerSource;
  answerSourceLabel: string;
  answerSourceOptionLabels: Record<FileAnswerSourceSelection, string>;
  children?: ReactNode;
  flagLabel: string;
  flagged?: boolean;
  isDisabled?: boolean;
  name: string;
  onAnswerSourceChange?: (answerSource: FileAnswerSource | undefined) => void;
  onRemove?: () => void;
  /** Shown before the size, e.g. "14 pages". */
  pageCountLabel?: string;
  removeLabel: string;
  size: number | string;
  /** Compact trigger text per selection, e.g. "Answers: inside". */
  answerSourceValueLabels?: Record<FileAnswerSourceSelection, string>;
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

function toAnswerSource(selection: FileAnswerSourceSelection | null) {
  return selection === 'inside' ||
    selection === 'key-file' ||
    selection === 'none'
    ? selection
    : undefined;
}

/** A solid PDF row with an accessible per-file answer declaration override. */
export function FileRow({
  answerSource,
  answerSourceLabel,
  answerSourceOptionLabels,
  answerSourceValueLabels,
  children,
  className,
  flagLabel,
  flagged = false,
  isDisabled = false,
  name,
  onAnswerSourceChange,
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

  const selectAnswerSource = (selection: FileAnswerSourceSelection | null) => {
    const nextAnswerSource = toAnswerSource(selection);
    onAnswerSourceChange?.(nextAnswerSource);
  };
  const answerSourceOptions: readonly SelectOption<FileAnswerSourceSelection>[] = [
    { id: 'batch-default', label: answerSourceOptionLabels['batch-default'] },
    { id: 'inside', label: answerSourceOptionLabels.inside },
    { id: 'key-file', label: answerSourceOptionLabels['key-file'] },
    { id: 'none', label: answerSourceOptionLabels.none },
  ];

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
      <Select<FileAnswerSourceSelection>
        aria-label={`${answerSourceLabel} for ${name}`}
        className="ds-file-row__answer-source ds-select--pill"
        isDisabled={isDisabled}
        label={answerSourceLabel}
        onChange={selectAnswerSource}
        options={answerSourceOptions}
        value={answerSource ?? 'batch-default'}
        valueLabel={answerSourceValueLabels?.[answerSource ?? 'batch-default']}
      />
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
