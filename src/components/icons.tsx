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

export function CalendarIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
      <path d="M8 3v4M16 3v4M3.5 10h17" />
      <circle cx="8.5" cy="14.5" r="0.6" fill="currentColor" />
      <circle cx="12" cy="14.5" r="0.6" fill="currentColor" />
      <circle cx="15.5" cy="14.5" r="0.6" fill="currentColor" />
    </Icon>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </Icon>
  );
}

export function ChevronRightIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M9 5l7 7-7 7" />
    </Icon>
  );
}

export function ChevronLeftIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M15 5l-7 7 7 7" />
    </Icon>
  );
}

export function PlayIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M8 5.5v13l10.5-6.5z" fill="currentColor" />
    </Icon>
  );
}

export function SwapIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M7 4L4 7l3 3M4 7h12a4 4 0 0 1 4 4" />
      <path d="M17 20l3-3-3-3M20 17H8a4 4 0 0 1-4-4" />
    </Icon>
  );
}

export function ClockIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </Icon>
  );
}

export function MoonIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" />
    </Icon>
  );
}

export function HeartPulseIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M19.5 12.6 12 20l-7.5-7.4A4.8 4.8 0 0 1 12 6.1a4.8 4.8 0 0 1 7.5 6.5z" />
      <path d="M3.5 12h4l1.5-2.5 2.5 5 1.5-2.5h7.5" />
    </Icon>
  );
}

export function PencilIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 20h4L19 9l-4-4L4 16v4z" />
      <path d="m13.5 6.5 4 4" />
    </Icon>
  );
}

export function TrashIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 7h16" />
      <path d="M10 11v6M14 11v6" />
      <path d="M6 7l1 13h10l1-13" />
      <path d="M9 7V4h6v3" />
    </Icon>
  );
}
