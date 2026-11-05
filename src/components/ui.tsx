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

/** Platzhalter für Bereiche, die in einem späteren Roadmap-Schritt gebaut werden. */
export function ComingSoon({ step, title, items }: { step: number; title: string; items: string[] }) {
  return (
    <Card>
      <p className="text-xs font-semibold uppercase tracking-wide text-accent">Schritt {step}</p>
      <h2 className="mt-1 text-lg font-semibold">{title}</h2>
      <ul className="mt-3 space-y-2 text-sm text-muted">
        {items.map((item) => (
          <li key={item} className="flex gap-2">
            <span aria-hidden="true" className="mt-2 size-1.5 shrink-0 rounded-full bg-accent" />
            {item}
          </li>
        ))}
      </ul>
    </Card>
  );
}
