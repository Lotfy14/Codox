import type { HTMLAttributes, ReactNode } from 'react';
import type { SelectOption } from './Select';
import { Select } from './Select';

export type FileAnswerSource = 'inside' | 'key-file' | 'none';

type FileAnswerSourceSelection = 'batch-default' | FileAnswerSource;

export interface FileRowProps
  extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  answerSource?: FileAnswerSource;
  answerSourceLabel?: string;
  children?: ReactNode;
  flagLabel?: string;
  flagged?: boolean;
  isDisabled?: boolean;
  name: string;
  onAnswerSourceChange?: (answerSource: FileAnswerSource | undefined) => void;
  onRemove?: () => void;
  removeLabel?: string;
  size: number | string;
}

const answerSourceOptions: readonly SelectOption<FileAnswerSourceSelection>[] = [
  { id: 'batch-default', label: 'Use batch default' },
  { id: 'inside', label: 'Inside this PDF' },
  { id: 'key-file', label: 'Separate key file' },
  { id: 'none', label: 'No answers provided' },
];

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
  answerSourceLabel = 'Answers',
  children,
  className,
  flagLabel = 'Needs attention',
  flagged = false,
  isDisabled = false,
  name,
  onAnswerSourceChange,
  onRemove,
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

  return (
    <div {...divProps} className={classes} data-flagged={flagged || undefined}>
      <span aria-hidden="true" className="ds-file-row__file-type">
        PDF
      </span>
      <span className="ds-file-row__details">
        <span className="ds-file-row__name">{name}</span>
        <span className="ds-file-row__size">{formatFileSize(size)}</span>
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
      />
      {children !== undefined ? (
        <div className="ds-file-row__extra">{children}</div>
      ) : null}
      {onRemove !== undefined ? (
        <button
          aria-label={removeLabel ?? `Remove ${name}`}
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
