import type { ComponentProps, FC } from 'react';

type InkeepLogoProps = Omit<ComponentProps<'img'>, 'src' | 'alt'> & {
  'aria-label'?: string;
};

export const InkeepLogo: FC<InkeepLogoProps> = ({
  className,
  'aria-label': ariaLabel = 'Multi-agent Platform Logo',
  ...props
}) => (
  <img
    src="/assets/logo.png"
    alt={ariaLabel}
    className={className}
    style={{ objectFit: 'contain' }}
    {...props}
  />
);
