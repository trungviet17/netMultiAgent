import type { FC } from 'react';
import type { IconComponentProps } from '@/components/ui/svg-icon';

export const InkeepIcon: FC<IconComponentProps> = ({
  size = 48,
  className,
  'aria-hidden': ariaHidden,
  'aria-label': ariaLabel,
}) => {
  const numericSize = typeof size === 'number' ? size : Number.parseFloat(String(size)) || 48;
  return (
    <img
      src="/assets/logo.png"
      alt={ariaLabel ?? 'Multi-agent Platform Logo'}
      width={numericSize * 2}
      height={numericSize}
      className={className}
      aria-hidden={ariaHidden}
      style={{ objectFit: 'contain', width: 'auto', height: numericSize }}
    />
  );
};
