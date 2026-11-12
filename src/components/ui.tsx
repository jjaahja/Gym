import Link from "next/link";

// Gemeinsame UI-Bausteine im Stil von iOS (Human Interface Guidelines).

/** Großer Titel wie in iOS-Apps (34 pt, fett), optional mit Untertitel und Aktion rechts. */
export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: React.ReactNode }) {
  return (
    <header className="mb-5 flex items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-[2.125rem] font-bold leading-[1.15]">{title}</h1>
        {subtitle && <p className="mt-0.5 text-[0.9375rem] text-muted">{subtitle}</p>}
      </div>
      {action}
    </header>
  );
}

/** Fläche auf gruppiertem Hintergrund (wie eine iOS-Liste im Stil „inset grouped“). */
export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`rounded-[1.125rem] bg-surface p-4 shadow-card ${className}`}>{children}</section>;
}

const buttonBase =
  "inline-flex min-h-[3.125rem] items-center justify-center gap-2 rounded-[0.875rem] px-5 text-[1.0625rem] font-semibold transition-[opacity,transform] active:scale-[0.98] active:opacity-80 disabled:opacity-40 disabled:active:scale-100";

/** filled · tinted (grau, Akzentschrift) · destructive */
export const buttonStyles = {
  primary: `${buttonBase} bg-accent text-accent-fg`,
  secondary: `${buttonBase} bg-surface-2 text-accent`,
  danger: `${buttonBase} bg-surface-2 text-danger`,
};

/** Kleiner „Kapsel“-Knopf (z. B. Ausführung, Tauschen) */
export const pillStyles =
  "inline-flex min-h-9 items-center gap-1.5 rounded-full bg-surface-2 px-3.5 text-[0.9375rem] font-medium transition-opacity active:opacity-70";

export function ButtonLink({
  href,
  children,
  variant = "primary",
}: {
  href: string;
  children: React.ReactNode;
  variant?: keyof typeof buttonStyles;
}) {
  return (
    <Link href={href} className={buttonStyles[variant]}>
      {children}
    </Link>
  );
}

/** Segmented Control wie in iOS: grauer Hintergrund, gewähltes Segment als helle „Kapsel“. */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  columns = options.length,
  variant = "default",
}: {
  label?: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  columns?: number;
  /** „overlay“: auf dunklem Kamerabild (immer helle Schrift) */
  variant?: "default" | "overlay";
}) {
  const overlay = variant === "overlay";
  const buttons = (
    <div
      className={`grid gap-0.5 rounded-[0.6rem] p-0.5 ${overlay ? "bg-white/15" : "bg-surface-2"}`}
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={`min-h-9 rounded-[0.5rem] px-1 text-[0.8125rem] font-semibold leading-tight transition-colors ${
            overlay
              ? value === option.value
                ? "bg-white/35 text-white"
                : "text-white/80"
              : value === option.value
                ? "bg-thumb text-fg shadow-[0_1px_3px_rgb(0_0_0/0.12),0_1px_1px_rgb(0_0_0/0.04)]"
                : "text-fg/75 hover:text-fg"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
  if (!label) return buttons;
  return (
    <fieldset>
      <legend className="mb-2 text-[0.9375rem] font-medium">{label}</legend>
      {buttons}
    </fieldset>
  );
}

/** Überschrift über einer gruppierten Liste (klein, grau – wie in den iOS-Einstellungen). */
export function SectionLabel({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-1.5 px-4 text-[0.8125rem] font-normal uppercase tracking-wide text-muted">{children}</h2>;
}

/** Gruppierte Liste: Zeilen mit eingerückten Trennlinien. */
export function List({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <ul className={`overflow-hidden rounded-[1.125rem] bg-surface shadow-card [&>li+li]:before:absolute [&>li+li]:before:inset-x-0 [&>li+li]:before:top-0 [&>li+li]:before:ml-4 [&>li+li]:before:h-px [&>li+li]:before:bg-border [&>li]:relative ${className}`}>
      {children}
    </ul>
  );
}

/** Listenzeile; mit `href` als Link mit Pfeil. */
export function ListRow({
  title,
  detail,
  subtitle,
  href,
  onClick,
  icon,
  trailing,
}: {
  title: React.ReactNode;
  detail?: React.ReactNode;
  subtitle?: React.ReactNode;
  href?: string;
  onClick?: () => void;
  icon?: React.ReactNode;
  trailing?: React.ReactNode;
}) {
  const content = (
    <>
      {icon && <span className="grid size-[1.875rem] shrink-0 place-items-center rounded-[0.45rem] bg-accent text-accent-fg">{icon}</span>}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[1.0625rem]">{title}</span>
        {subtitle && <span className="block truncate text-[0.8125rem] text-muted">{subtitle}</span>}
      </span>
      {detail != null && <span className="shrink-0 text-[1.0625rem] text-muted">{detail}</span>}
      {trailing}
      {(href || onClick) && !trailing && (
        <span aria-hidden="true" className="shrink-0 text-xl leading-none text-muted/60">
          ›
        </span>
      )}
    </>
  );
  const row = "flex min-h-11 w-full items-center gap-3 px-4 py-2.5 text-left";
  return (
    <li>
      {href ? (
        <Link href={href} className={`${row} active:bg-surface-2`}>
          {content}
        </Link>
      ) : onClick ? (
        <button type="button" onClick={onClick} className={`${row} active:bg-surface-2`}>
          {content}
        </button>
      ) : (
        <div className={row}>{content}</div>
      )}
    </li>
  );
}

/** iOS-Schalter */
export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-[1.9375rem] w-[3.1875rem] shrink-0 rounded-full transition-colors disabled:opacity-40 ${checked ? "bg-good" : "bg-surface-2"}`}
    >
      <span
        aria-hidden="true"
        className={`absolute top-0.5 size-[1.6875rem] rounded-full bg-white shadow-[0_3px_8px_rgb(0_0_0/0.15),0_1px_1px_rgb(0_0_0/0.16)] transition-[left] ${checked ? "left-[1.375rem]" : "left-0.5"}`}
      />
    </button>
  );
}

/** iOS-Stepper: − Wert + (Wert wird angesagt, Knöpfe an den Grenzen deaktiviert). */
export function Stepper({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  format = String,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  format?: (value: number) => string;
}) {
  const btn = "grid h-9 w-11 place-items-center text-xl font-medium text-fg active:bg-fg/10 disabled:opacity-30";
  return (
    <div className="flex min-h-11 items-center justify-between gap-3">
      <span className="text-[1.0625rem]">{label}</span>
      <div className="flex items-center gap-2">
        <output aria-live="polite" aria-label={label} className="tabular min-w-12 text-right text-[1.0625rem] font-semibold">
          {format(value)}
        </output>
        <div className="flex items-center overflow-hidden rounded-[0.5rem] bg-surface-2">
          <button type="button" aria-label={`${label} verringern`} disabled={value - step < min} onClick={() => onChange(value - step)} className={btn}>
            −
          </button>
          <span aria-hidden="true" className="h-5 w-px bg-border" />
          <button type="button" aria-label={`${label} erhöhen`} disabled={value + step > max} onClick={() => onChange(value + step)} className={btn}>
            +
          </button>
        </div>
      </div>
    </div>
  );
}
