/**
 * Card-style radio choices — one labeled option per card with a hint line.
 * Promoted from the AI-export dialog so every settings surface shares the
 * same accessible radiogroup (`ds-choice*` styles in components.css).
 */
export interface ChoiceOption<V extends string> {
  hint: string
  label: string
  value: V
}

export interface ChoiceGroupProps<V extends string> {
  legend: string
  onChange: (value: V) => void
  options: readonly ChoiceOption<V>[]
  value: V
}

export function ChoiceGroup<V extends string>({
  legend,
  onChange,
  options,
  value,
}: ChoiceGroupProps<V>) {
  return (
    <div className="ds-choice-group">
      <p className="ds-choice-group__legend" id={`legend-${legend}`}>
        {legend}
      </p>
      <div aria-label={legend} className="ds-choice-group__options" role="radiogroup">
        {options.map((option) => (
          <button
            aria-checked={value === option.value}
            className="ds-choice"
            key={option.value}
            onClick={() => onChange(option.value)}
            role="radio"
            type="button"
          >
            <span className="ds-choice__label">{option.label}</span>
            <span className="ds-choice__hint">{option.hint}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
