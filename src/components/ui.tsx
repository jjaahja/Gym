import Link from "next/link";

// Kleine, gemeinsam genutzte UI-Bausteine.

export function PageHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <header className="mb-5">
      <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
      {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
    </header>
  );
}

export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-border bg-surface p-4 ${className}`}>{children}</section>;
}

const buttonBase =
  "inline-flex min-h-12 items-center justify-center rounded-xl px-5 text-base font-semibold transition-opacity active:opacity-80 disabled:opacity-40";

export const buttonStyles = {
  primary: `${buttonBase} bg-accent text-accent-fg`,
  secondary: `${buttonBase} border border-border bg-surface-2 text-fg`,
  danger: `${buttonBase} border border-border bg-surface text-danger`,
};

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

/** Umschalter (Segmented Control); bei `label` als Fieldset mit Legende. */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  columns = options.length,
}: {
  label?: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  columns?: number;
}) {
  const buttons = (
    <div className="grid gap-1 rounded-xl bg-surface-2 p-1" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={`min-h-11 rounded-lg px-1 text-sm font-semibold transition-colors ${
            value === option.value ? "bg-accent text-accent-fg shadow-sm" : "text-muted hover:text-fg"
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
      <legend className="mb-2 text-sm font-medium">{label}</legend>
      {buttons}
    </fieldset>
  );
}
