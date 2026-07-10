import { useEffect, useRef, type ReactNode } from 'react'
import { Button } from './Button'

export interface AppShellProps {
  children: ReactNode
  className?: string
  header?: ReactNode
  isReviewTakeover?: boolean
  /** Use div only when demonstrating the shell inside another page landmark. */
  mainAs?: 'div' | 'main'
  navigation?: ReactNode
  onMinimizeReview?: () => void
}

export function AppShell({
  children,
  className,
  header,
  isReviewTakeover = false,
  mainAs: Main = 'main',
  navigation,
  onMinimizeReview,
}: AppShellProps) {
  const mainElement = useRef<HTMLElement | null>(null)
  const previousReviewTakeover = useRef(isReviewTakeover)

  useEffect(() => {
    if (previousReviewTakeover.current && !isReviewTakeover) {
      mainElement.current?.focus()
    }

    previousReviewTakeover.current = isReviewTakeover
  }, [isReviewTakeover])

  return (
    <div
      className={['ds-app-shell', className].filter(Boolean).join(' ')}
      data-review-takeover={isReviewTakeover || undefined}
    >
      {header ? <header className="ds-app-shell__header">{header}</header> : null}
      {!isReviewTakeover && navigation ? (
        <aside className="ds-app-shell__navigation">{navigation}</aside>
      ) : null}
      <Main
        className="ds-app-shell__main"
        ref={(element) => {
          mainElement.current = element
        }}
        tabIndex={-1}
      >
        {isReviewTakeover && onMinimizeReview ? (
          <div className="ds-app-shell__review-tools">
            <Button autoFocus onPress={onMinimizeReview} variant="quiet">
              Minimize review
            </Button>
          </div>
        ) : null}
        {children}
      </Main>
    </div>
  )
}
