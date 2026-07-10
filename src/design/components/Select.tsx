import {
  Button as AriaButton,
  FieldError,
  Label,
  ListBox,
  ListBoxItem,
  Popover,
  Select as AriaSelect,
  SelectValue,
  Text,
} from 'react-aria-components/Select';
import type {
  Key,
  SelectProps as AriaSelectProps,
} from 'react-aria-components/Select';
import type { ReactNode } from 'react';

export interface SelectOption<K extends Key = string> {
  description?: string;
  id: K;
  isDisabled?: boolean;
  label: string;
}

export interface SelectProps<K extends Key = string>
  extends Omit<
    AriaSelectProps<SelectOption<K>>,
    | 'children'
    | 'className'
    | 'defaultValue'
    | 'defaultSelectedKey'
    | 'items'
    | 'onChange'
    | 'onSelectionChange'
    | 'selectedKey'
    | 'value'
  > {
  className?: string;
  defaultValue?: K | null;
  description?: ReactNode;
  errorMessage?: ReactNode;
  label: ReactNode;
  onChange?: (key: K | null) => void;
  options: readonly SelectOption<K>[];
  value?: K | null;
}

/** A single-selection listbox with full keyboard and typeahead support. */
export function Select<K extends Key = string>({
  className,
  defaultValue,
  description,
  errorMessage,
  label,
  onChange,
  options,
  value,
  ...selectProps
}: SelectProps<K>) {
  const classes = ['ds-select', className].filter(Boolean).join(' ');

  return (
    <AriaSelect
      {...selectProps}
      className={classes}
      defaultValue={defaultValue}
      onChange={(key) => onChange?.(key as K | null)}
      value={value}
    >
      <Label className="ds-select__label">{label}</Label>
      <AriaButton className="ds-select__trigger">
        <SelectValue<SelectOption<K>> className="ds-select__value" />
        <svg
          aria-hidden="true"
          className="ds-select__chevron"
          viewBox="0 0 16 16"
        >
          <path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" />
        </svg>
      </AriaButton>
      {description !== undefined ? (
        <Text className="ds-select__description" slot="description">
          {description}
        </Text>
      ) : null}
      {errorMessage !== undefined ? (
        <FieldError className="ds-select__error">{errorMessage}</FieldError>
      ) : null}
      <Popover className="ds-select__popover">
        <ListBox
          className="ds-select__listbox"
          items={options}
        >
          {(option) => (
            <ListBoxItem
              className="ds-select__option"
              id={option.id}
              isDisabled={option.isDisabled}
              textValue={option.label}
            >
              {({ isSelected }) => (
                <>
                  <span className="ds-select__option-content">
                    <span className="ds-select__option-label">
                      {option.label}
                    </span>
                    {option.description !== undefined ? (
                      <Text
                        className="ds-select__option-description"
                        slot="description"
                      >
                        {option.description}
                      </Text>
                    ) : null}
                  </span>
                  {isSelected ? (
                    <span
                      aria-hidden="true"
                      className="ds-select__checkmark"
                    >
                      ✓
                    </span>
                  ) : null}
                </>
              )}
            </ListBoxItem>
          )}
        </ListBox>
      </Popover>
    </AriaSelect>
  );
}
