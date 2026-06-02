import type { FC } from 'react';
import type { IconComponentProps } from '@/components/ui/svg-icon';
import { LogoMark } from '@/icons';

/**
 * Square Multi-agent Platform brand mark, sized via the `size` prop. Used as a
 * compact brand icon (auth pages, cards). The mark renders in the brand red.
 */
export const InkeepIcon: FC<IconComponentProps> = ({
  size = 48,
  className,
  'aria-hidden': ariaHidden,
  'aria-label': ariaLabel,
}) => {
  const numericSize = typeof size === 'number' ? size : Number.parseFloat(String(size)) || 48;
  return (
    <LogoMark
      width={numericSize}
      height={numericSize}
      className={className}
      {...(ariaLabel ? { 'aria-label': ariaLabel } : {})}
      {...(ariaHidden ? { 'aria-hidden': ariaHidden } : {})}
    />
  );
};
