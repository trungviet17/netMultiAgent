import type { ComponentProps, FC } from 'react';

const BRAND_RED = '#dc2626';

/**
 * The Multi-agent Platform brand mark: a stylized "M" formed by connected
 * agent nodes inside a network ring. Always rendered in the brand red so it
 * stays on-brand in both light and dark themes.
 */
export const LogoMark: FC<ComponentProps<'svg'>> = ({ className, ...props }) => (
  <svg
    viewBox="0 0 64 64"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    role="img"
    aria-label="netMultiAgent Platform"
    className={className}
    {...props}
  >
    <g stroke={BRAND_RED} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="32" cy="32" r="28" strokeWidth="2" />
      <g strokeWidth="1.6" opacity="0.85">
        <line x1="16" y1="22" x2="12.2" y2="12.2" />
        <line x1="48" y1="22" x2="51.8" y2="12.2" />
        <line x1="16" y1="44" x2="12.2" y2="51.8" />
        <line x1="48" y1="44" x2="51.8" y2="51.8" />
        <line x1="32" y1="38" x2="32" y2="60" />
        <line x1="16" y1="22" x2="32" y2="4" />
        <line x1="48" y1="22" x2="32" y2="4" />
      </g>
      <polyline points="16,44 16,22 32,38 48,22 48,44" strokeWidth="4" />
    </g>
    <g fill={BRAND_RED}>
      <circle cx="32" cy="4" r="3" />
      <circle cx="51.8" cy="12.2" r="2.4" />
      <circle cx="60" cy="32" r="2.4" />
      <circle cx="51.8" cy="51.8" r="2.4" />
      <circle cx="32" cy="60" r="3" />
      <circle cx="12.2" cy="51.8" r="2.4" />
      <circle cx="4" cy="32" r="2.4" />
      <circle cx="12.2" cy="12.2" r="2.4" />
      <circle cx="16" cy="44" r="3.4" />
      <circle cx="16" cy="22" r="3.4" />
      <circle cx="32" cy="38" r="3.8" />
      <circle cx="48" cy="22" r="3.4" />
      <circle cx="48" cy="44" r="3.4" />
    </g>
  </svg>
);

type InkeepLogoProps = ComponentProps<'svg'> & {
  'aria-label'?: string;
};

/**
 * Full Multi-agent Platform lockup: brand mark + wordmark. The "Multi-agent"
 * wordmark uses `currentColor` so it adapts to the surrounding theme (dark text
 * in light mode, white in dark mode), while the mark and "PLATFORM" subtitle
 * stay in the brand red. Sized via `className` width; height scales to match.
 */
export const InkeepLogo: FC<InkeepLogoProps> = ({
  className,
  'aria-label': ariaLabel = 'netMultiAgent Platform',
  ...props
}) => (
  <svg
    viewBox="0 0 252 64"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    role="img"
    aria-label={ariaLabel}
    className={className}
    {...props}
  >
    <g transform="translate(3 4) scale(0.875)">
      <g stroke={BRAND_RED} strokeLinecap="round" strokeLinejoin="round">
        <circle cx="32" cy="32" r="28" strokeWidth="2" />
        <g strokeWidth="1.6" opacity="0.85">
          <line x1="16" y1="22" x2="12.2" y2="12.2" />
          <line x1="48" y1="22" x2="51.8" y2="12.2" />
          <line x1="16" y1="44" x2="12.2" y2="51.8" />
          <line x1="48" y1="44" x2="51.8" y2="51.8" />
          <line x1="32" y1="38" x2="32" y2="60" />
          <line x1="16" y1="22" x2="32" y2="4" />
          <line x1="48" y1="22" x2="32" y2="4" />
        </g>
        <polyline points="16,44 16,22 32,38 48,22 48,44" strokeWidth="4" />
      </g>
      <g fill={BRAND_RED}>
        <circle cx="32" cy="4" r="3" />
        <circle cx="51.8" cy="12.2" r="2.4" />
        <circle cx="60" cy="32" r="2.4" />
        <circle cx="51.8" cy="51.8" r="2.4" />
        <circle cx="32" cy="60" r="3" />
        <circle cx="12.2" cy="51.8" r="2.4" />
        <circle cx="4" cy="32" r="2.4" />
        <circle cx="12.2" cy="12.2" r="2.4" />
        <circle cx="16" cy="44" r="3.4" />
        <circle cx="16" cy="22" r="3.4" />
        <circle cx="32" cy="38" r="3.8" />
        <circle cx="48" cy="22" r="3.4" />
        <circle cx="48" cy="44" r="3.4" />
      </g>
    </g>
    <text
      x="70"
      y="30"
      fontFamily="inherit"
      fontSize="29"
      fontWeight="700"
      letterSpacing="-1"
      fill="currentColor"
    >
      <tspan fill={BRAND_RED}>net</tspan>MultiAgent
    </text>
    <text
      x="71"
      y="51"
      fontFamily="inherit"
      fontSize="17"
      fontWeight="500"
      letterSpacing="4"
      fill={BRAND_RED}
    >
      PLATFORM
    </text>
  </svg>
);
