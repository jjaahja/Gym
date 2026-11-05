// Schlanke Strich-Icons (24×24, currentColor), damit keine Icon-Bibliothek nötig ist.

type IconProps = React.SVGProps<SVGSVGElement>;

function Icon({ children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={24}
      height={24}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

export function PlanIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="4" y="4" width="16" height="17" rx="2" />
      <path d="M8 2v4M16 2v4M4 10h16M8 14h3M8 17h6" />
    </Icon>
  );
}

export function DumbbellIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M7 7v10M17 7v10M4 9.5v5M20 9.5v5M7 12h10" />
    </Icon>
  );
}

export function LibraryIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M8 8h8M8 12h8M8 16h5" />
    </Icon>
  );
}

export function ChartIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 20h16" />
      <path d="M5 16l4.5-5 3.5 3 6-7" />
      <path d="M15 7h4v4" />
    </Icon>
  );
}

export function UserIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4.5 21a7.5 7.5 0 0 1 15 0" />
    </Icon>
  );
}

export function CloudOffIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 3l18 18" />
      <path d="M8.5 6.2A6 6 0 0 1 17.7 10H18a4 4 0 0 1 2.3 7.3M17 18H7a4.5 4.5 0 0 1-1.6-8.7" />
    </Icon>
  );
}
