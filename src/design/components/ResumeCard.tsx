import type { HTMLAttributes } from 'react';

export interface ResumeCardProps
  extends Omit<HTMLAttributes<HTMLElement>, 'children'> {
  continueLabel?: string;
  fileName: string;
  flagsLeft: number;
  isDisabled?: boolean;
  onContinue?: () => void;
}

function normalizeFlagCount(flagsLeft: number) {
  return Number.isFinite(flagsLeft) ? Math.max(0, Math.floor(flagsLeft)) : 0;
}

/** A compact route back into a minimized review session. */
export function ResumeCard({
  className,
  continueLabel = 'Continue',
  fileName,
  flagsLeft,
  isDisabled = false,
  onContinue,
  ...articleProps
}: ResumeCardProps) {
  const safeFlagsLeft = normalizeFlagCount(flagsLeft);
  const flagSummary = `${safeFlagsLeft} ${safeFlagsLeft === 1 ? 'flag' : 'flags'} left`;
  const classes = ['ds-resume-card', className].filter(Boolean).join(' ');

  return (
    <article
      {...articleProps}
      aria-label={`Resume review for ${fileName}`}
      className={classes}
    >
      <span aria-hidden="true" className="ds-resume-card__icon">
        ↗
      </span>
      <span className="ds-resume-card__summary">
        <span className="ds-resume-card__file-name">{fileName}</span>
        <span className="ds-resume-card__flag-count">{flagSummary}</span>
      </span>
      <button
        aria-label={`${continueLabel} reviewing ${fileName}, ${flagSummary}`}
        className="ds-resume-card__continue"
        disabled={isDisabled}
        onClick={onContinue}
        type="button"
      >
        {continueLabel}
      </button>
    </article>
  );
}
