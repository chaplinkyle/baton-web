type BatonLogoProps = {
  className?: string;
};

export function BatonLogo({ className }: BatonLogoProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 44 44"
      aria-hidden="true"
      focusable="false"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect x="1" y="1" width="42" height="42" rx="13" fill="currentColor" />
      <path
        d="M10 28.5c3.8 4.1 8.1 6.1 12.9 6.1 4.3 0 8.2-1.5 11.7-4.6"
        fill="none"
        stroke="#8ebbad"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
      <g transform="rotate(-31 22 21)">
        <rect x="7.2" y="17.2" width="13.2" height="7.6" rx="3.8" fill="#8ebbad" />
        <rect x="22.1" y="17.2" width="14.7" height="7.6" rx="3.8" fill="#b5abfc" />
        <rect x="19.5" y="16.3" width="3.5" height="9.4" rx="1.75" fill="#f2efe9" />
      </g>
    </svg>
  );
}
