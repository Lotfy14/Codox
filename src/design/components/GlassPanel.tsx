import type { HTMLAttributes, ReactNode } from 'react';

export type GlassPanelElement =
  | 'article'
  | 'aside'
  | 'div'
  | 'main'
  | 'section';

export type GlassPanelPadding = 'none' | 'compact' | 'default' | 'spacious';

export interface GlassPanelProps extends Omit<HTMLAttributes<HTMLElement>, 'children'> {
  /** The semantic element used for the panel. */
  as?: GlassPanelElement;
  children: ReactNode;
  padding?: GlassPanelPadding;
}

/**
 * The shared, non-nestable glass card surface. Consumers are responsible for
 * choosing an element that reflects the panel's place in the document.
 */
export function GlassPanel({
  as: Element = 'div',
  children,
  className,
  padding = 'default',
  ...elementProps
}: GlassPanelProps) {
  const classes = [
    'glass-panel',
    'ds-glass-panel',
    `ds-glass-panel--padding-${padding}`,
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <Element
      {...elementProps}
      className={classes}
      data-padding={padding}
    >
      {children}
    </Element>
  );
}
