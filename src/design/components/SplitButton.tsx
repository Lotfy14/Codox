import { Button as AriaButton } from 'react-aria-components/Button';
import {
  Menu,
  MenuItem,
  MenuTrigger,
  Popover,
  Text,
} from 'react-aria-components/Menu';
import type { ReactNode } from 'react';
import type { ButtonVariant } from './Button';
import { Button } from './Button';

export interface SplitButtonItem {
  description?: string;
  id: string;
  label: string;
}

export interface SplitButtonProps {
  children: ReactNode;
  className?: string;
  isDisabled?: boolean;
  isPending?: boolean;
  items: readonly SplitButtonItem[];
  loadingLabel?: ReactNode;
  /** Accessible name for the chevron that opens the menu. */
  menuLabel: string;
  /** A menu item was chosen. */
  onAction: (id: string) => void;
  /** The primary (default) action. */
  onPress: () => void;
  variant?: ButtonVariant;
}

/**
 * A primary action with attached secondary choices: the wide half fires the
 * default, the chevron half opens an accessible menu of variants. One
 * pattern, styled entirely by `.ds-split-button` / `.ds-menu`.
 */
export function SplitButton({
  children,
  className,
  isDisabled = false,
  isPending = false,
  items,
  loadingLabel,
  menuLabel,
  onAction,
  onPress,
  variant = 'primary',
}: SplitButtonProps) {
  const classes = ['ds-split-button', className].filter(Boolean).join(' ');

  return (
    <div className={classes} data-variant={variant}>
      <Button
        className="ds-split-button__primary"
        isDisabled={isDisabled}
        isPending={isPending}
        loadingLabel={loadingLabel}
        onPress={onPress}
        variant={variant}
      >
        {children}
      </Button>
      <MenuTrigger>
        <AriaButton
          aria-label={menuLabel}
          className={`ds-button ds-button--${variant} ds-split-button__toggle`}
          isDisabled={isDisabled || isPending}
        >
          <svg aria-hidden="true" className="ds-split-button__chevron" viewBox="0 0 16 16">
            <path
              d="m4 6 4 4 4-4"
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="1.5"
            />
          </svg>
        </AriaButton>
        <Popover className="ds-menu__popover" placement="bottom end">
          <Menu
            className="ds-menu"
            onAction={(key) => onAction(String(key))}
          >
            {items.map((item) => (
              <MenuItem
                className="ds-menu__item"
                id={item.id}
                key={item.id}
                textValue={item.label}
              >
                <span className="ds-menu__item-label">{item.label}</span>
                {item.description !== undefined ? (
                  <Text className="ds-menu__item-description" slot="description">
                    {item.description}
                  </Text>
                ) : null}
              </MenuItem>
            ))}
          </Menu>
        </Popover>
      </MenuTrigger>
    </div>
  );
}
