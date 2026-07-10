import {
  Button as AriaButton,
  Dialog as AriaDialog,
  Heading,
  Modal,
  ModalOverlay,
} from 'react-aria-components/Modal';
import type { ModalOverlayProps } from 'react-aria-components/Modal';
import { useId } from 'react';
import type { ReactNode } from 'react';

export type DialogContent = ReactNode | ((close: () => void) => ReactNode);

export interface DialogProps
  extends Omit<
    ModalOverlayProps,
    'children' | 'className' | 'isDismissable' | 'isOpen' | 'onOpenChange'
  > {
  actions?: DialogContent;
  children?: DialogContent;
  className?: string;
  description?: ReactNode;
  dismissLabel?: string;
  isDismissable?: boolean;
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  overlayClassName?: string;
  role?: 'alertdialog' | 'dialog';
  title: ReactNode;
}

function renderDialogContent(
  content: DialogContent | undefined,
  close: () => void,
) {
  return typeof content === 'function' ? content(close) : content;
}

/** A controlled, focus-trapped modal dialog with an always-available close. */
export function Dialog({
  actions,
  children,
  className,
  description,
  dismissLabel = 'Close dialog',
  isDismissable = true,
  isOpen,
  onOpenChange,
  overlayClassName,
  role = 'dialog',
  title,
  ...overlayProps
}: DialogProps) {
  const descriptionId = useId();
  const hasDescription = description !== undefined && description !== null;
  const overlayClasses = ['ds-dialog__overlay', overlayClassName]
    .filter(Boolean)
    .join(' ');
  const dialogClasses = [
    'glass-panel',
    'ds-glass-panel',
    'ds-dialog',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <ModalOverlay
      {...overlayProps}
      className={overlayClasses}
      isDismissable={isDismissable}
      isOpen={isOpen}
      onOpenChange={onOpenChange}
    >
      <Modal className="ds-dialog__modal">
        <AriaDialog
          aria-describedby={hasDescription ? descriptionId : undefined}
          className={dialogClasses}
          role={role}
        >
          {({ close }) => (
            <>
              <header className="ds-dialog__header">
                <Heading className="ds-dialog__title" level={2} slot="title">
                  {title}
                </Heading>
                <AriaButton
                  aria-label={dismissLabel}
                  className="ds-dialog__close"
                  onPress={close}
                >
                  <span aria-hidden="true">×</span>
                </AriaButton>
              </header>
              {hasDescription ? (
                <p className="ds-dialog__description" id={descriptionId}>
                  {description}
                </p>
              ) : null}
              {children !== undefined ? (
                <div className="ds-dialog__body">
                  {renderDialogContent(children, close)}
                </div>
              ) : null}
              {actions !== undefined ? (
                <footer className="ds-dialog__actions">
                  {renderDialogContent(actions, close)}
                </footer>
              ) : null}
            </>
          )}
        </AriaDialog>
      </Modal>
    </ModalOverlay>
  );
}
