// Balken mit eingezeichnetem Zielbereich (Richtwert min–max).

const de = (n: number) => n.toLocaleString("de-DE", { maximumFractionDigits: 1 });

export function VolumeBar({
  label,
  value,
  min,
  max,
  target,
  highlight = false,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  /** optionaler Sollwert (z. B. geplante Sätze) */
  target?: number;
  highlight?: boolean;
}) {
  const scale = Math.max(max * 1.2, value, target ?? 0) || 1;
  const pct = (n: number) => `${Math.min(100, (n / scale) * 100)}%`;
  const status = value < min - 0.5 ? "below" : value > max ? "above" : "ok";
  const barColor = status === "above" ? "bg-danger" : status === "ok" ? "bg-accent" : "bg-muted";

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className={highlight ? "font-semibold" : ""}>
          {label}
          {highlight && <span className="ml-1 text-accent" aria-label="Priorität">★</span>}
        </span>
        <span className="tabular text-muted">
          <span className="font-semibold text-fg">{de(value)}</span>
          {target !== undefined ? ` / ${de(target)}` : ""} · Ziel {min}–{max}
        </span>
      </div>
      <div
        className="relative mt-1 h-2.5 overflow-hidden rounded-full bg-surface-2"
        role="img"
        aria-label={`${label}: ${de(value)} Sätze, Zielbereich ${min} bis ${max}`}
      >
        <div className="absolute inset-y-0 bg-accent/20" style={{ left: pct(min), width: `calc(${pct(max)} - ${pct(min)})` }} />
        <div className={`absolute inset-y-0 left-0 rounded-full ${barColor}`} style={{ width: pct(value) }} />
        {target !== undefined && <div className="absolute inset-y-0 w-0.5 bg-fg/60" style={{ left: pct(target) }} />}
      </div>
    </div>
  );
}
