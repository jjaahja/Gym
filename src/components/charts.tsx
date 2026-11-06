"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { columnPath, nearestIndex, niceTicks } from "@/lib/chart-scale";

// SVG-Diagramme nach der Dataviz-Spezifikation: eine Achse, 2px-Linie, Marker ≥ 8px mit 2px Flächenring,
// Säulen ≤ 24px mit 4px gerundetem Datenende, Haarlinien-Raster, Fadenkreuz + Tooltip,
// Tastaturbedienung und Tabellenansicht. Eine Serie → keine Legende (der Titel benennt sie).

type Format = (value: number) => string;

const MARGIN = { top: 12, right: 12, bottom: 26, left: 40 };
const MIN_LABEL_GAP = 56;

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/** Tastatur: Pfeile wandern durch die Punkte, Pos1/Ende springen, Esc schließt. */
function useActiveIndex(count: number) {
  const [active, setActive] = useState<number | null>(null);
  const onKeyDown = (e: KeyboardEvent) => {
    if (count === 0) return;
    const current = active ?? count - 1;
    const next =
      e.key === "ArrowLeft" ? Math.max(0, current - 1)
      : e.key === "ArrowRight" ? Math.min(count - 1, current + 1)
      : e.key === "Home" ? 0
      : e.key === "End" ? count - 1
      : e.key === "Escape" ? null
      : undefined;
    if (next === undefined) return;
    e.preventDefault();
    setActive(next);
  };
  return { active: active != null && active < count ? active : null, setActive, onKeyDown };
}

/** x-Beschriftungen gierig von links, letzte immer – keine Überlappung. */
function axisLabelIndices(positions: readonly number[]): number[] {
  if (positions.length === 0) return [];
  const last = positions.length - 1;
  const picked: number[] = [];
  for (let i = 0; i < last; i++) {
    const prev = picked.at(-1);
    if ((prev === undefined || positions[i] - positions[prev] >= MIN_LABEL_GAP) && positions[last] - positions[i] >= MIN_LABEL_GAP)
      picked.push(i);
  }
  return [...picked, last];
}

function Tooltip({ x, width, children }: { x: number; width: number; children: ReactNode }) {
  const right = x > width / 2;
  return (
    <div
      className="pointer-events-none absolute top-1 z-10 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm shadow-lg"
      style={right ? { right: width - x + 10 } : { left: x + 10 }}
    >
      {children}
    </div>
  );
}

function SeriesKey() {
  return <span aria-hidden="true" className="mt-[0.55em] inline-block h-0.5 w-3 shrink-0 rounded-full bg-chart-1" />;
}

function ChartFrame({
  title,
  description,
  table,
  legend,
  children,
}: {
  title: string;
  description?: string;
  table: ReactNode;
  legend?: ReactNode;
  children: ReactNode;
}) {
  const [showTable, setShowTable] = useState(false);
  return (
    <figure>
      <div className="flex items-start justify-between gap-3">
        <figcaption>
          <span className="block font-semibold">{title}</span>
          {description && <span className="block text-sm text-muted">{description}</span>}
        </figcaption>
        <button
          type="button"
          className="min-h-10 shrink-0 rounded-lg px-2 text-sm font-medium text-accent"
          aria-pressed={showTable}
          onClick={() => setShowTable((v) => !v)}
        >
          {showTable ? "Diagramm" : "Tabelle"}
        </button>
      </div>
      <div className="mt-2">{showTable ? table : children}</div>
      {!showTable && legend}
    </figure>
  );
}

function DataTable({ caption, head, rows }: { caption: string; head: [string, string]; rows: [string, string][] }) {
  return (
    <div className="max-h-72 overflow-y-auto rounded-xl border border-border">
      <table className="w-full text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="sticky top-0 bg-surface-2 text-left text-muted">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">{head[0]}</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">{head[1]}</th>
          </tr>
        </thead>
        <tbody className="tabular divide-y divide-border">
          {rows.map(([a, b], i) => (
            <tr key={i}>
              <td className="px-3 py-2">{a}</td>
              <td className="px-3 py-2 text-right">{b}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function YAxis({ ticks, sy, width, format }: { ticks: number[]; sy: (v: number) => number; width: number; format: Format }) {
  return (
    <g aria-hidden="true">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={MARGIN.left} x2={width - MARGIN.right} y1={sy(t)} y2={sy(t)} stroke="var(--chart-grid)" strokeWidth={1} shapeRendering="crispEdges" />
          <text x={MARGIN.left - 6} y={sy(t)} dy="0.32em" textAnchor="end" className="tabular fill-muted text-[11px]">
            {format(t)}
          </text>
        </g>
      ))}
    </g>
  );
}

// ─────────────────────────── Linie (Verlauf über die Zeit) ───────────────────────────

export interface LinePoint {
  /** Zeitpunkt in ms */
  x: number;
  y: number;
  /** Zusatzzeile im Tooltip, z. B. „80 kg × 8“ */
  note?: string;
}

export function LineChart({
  title,
  description,
  points,
  formatValue,
  formatTick = formatValue,
  formatDate,
  formatDateShort,
  height = 200,
  valueLabel = "Wert",
}: {
  title: string;
  description?: string;
  points: readonly LinePoint[];
  formatValue: Format;
  formatTick?: Format;
  formatDate: (ms: number) => string;
  formatDateShort: (ms: number) => string;
  height?: number;
  valueLabel?: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const { active, setActive, onKeyDown } = useActiveIndex(points.length);
  const descId = useId();

  const innerW = Math.max(0, width - MARGIN.left - MARGIN.right);
  const innerH = height - MARGIN.top - MARGIN.bottom;
  const ys = points.map((p) => p.y);
  const scale = niceTicks(Math.min(...ys), Math.max(...ys), 4);
  const xMin = points[0]?.x ?? 0;
  const xMax = points.at(-1)?.x ?? 0;
  const sx = (x: number) => MARGIN.left + (xMax === xMin ? innerW / 2 : ((x - xMin) / (xMax - xMin)) * innerW);
  const sy = (y: number) => MARGIN.top + innerH - ((y - scale.min) / (scale.max - scale.min)) * innerH;
  const positions = points.map((p) => sx(p.x));
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(" ");
  const showAllMarkers = points.length <= 24;
  const first = points[0];
  const last = points.at(-1);
  const summary =
    first && last
      ? `${title}: ${points.length} Werte von ${formatDate(first.x)} (${formatValue(first.y)}) bis ${formatDate(last.x)} (${formatValue(last.y)}).`
      : `${title}: keine Daten.`;

  const onPointer = (e: PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (points.length) setActive(nearestIndex(positions, e.clientX - rect.left));
  };

  const activePoint = active != null ? points[active] : null;

  return (
    <ChartFrame
      title={title}
      description={description}
      table={
        <DataTable
          caption={title}
          head={["Datum", valueLabel]}
          rows={[...points].reverse().map((p) => [formatDate(p.x), formatValue(p.y)])}
        />
      }
    >
      <div
        ref={ref}
        className="relative rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-accent"
        style={{ height }}
        tabIndex={0}
        role="group"
        aria-label={`${title}. Pfeiltasten wählen einzelne Werte.`}
        aria-describedby={descId}
        onKeyDown={onKeyDown}
        onFocus={() => active == null && setActive(points.length - 1)}
        onBlur={() => setActive(null)}
      >
        <p id={descId} className="sr-only">{summary}</p>
        {width > 0 && (
          <svg
            width={width}
            height={height}
            role="img"
            aria-label={summary}
            className="block select-none"
            style={{ touchAction: "pan-y" }}
            onPointerMove={onPointer}
            onPointerDown={onPointer}
            onPointerLeave={() => setActive(null)}
          >
            <YAxis ticks={scale.ticks} sy={sy} width={width} format={formatTick} />
            <g aria-hidden="true">
              {axisLabelIndices(positions).map((i, k, all) => (
                <text
                  key={i}
                  x={positions[i]}
                  y={height - 6}
                  textAnchor={all.length > 1 && k === 0 ? "start" : k === all.length - 1 && all.length > 1 ? "end" : "middle"}
                  className="fill-muted text-[11px]"
                >
                  {formatDateShort(points[i].x)}
                </text>
              ))}
            </g>
            {activePoint && (
              <line
                x1={sx(activePoint.x)}
                x2={sx(activePoint.x)}
                y1={MARGIN.top}
                y2={MARGIN.top + innerH}
                stroke="var(--chart-ref)"
                strokeWidth={1}
                shapeRendering="crispEdges"
              />
            )}
            <path d={path} fill="none" stroke="var(--chart-1)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            {points.map((p, i) =>
              showAllMarkers || i === active || i === points.length - 1 ? (
                <circle
                  key={i}
                  cx={sx(p.x)}
                  cy={sy(p.y)}
                  r={i === active ? 5.5 : 4}
                  fill="var(--chart-1)"
                  stroke="var(--surface)"
                  strokeWidth={2}
                />
              ) : null,
            )}
          </svg>
        )}
        {activePoint && (
          <Tooltip x={sx(activePoint.x)} width={width}>
            <div className="flex gap-2">
              <SeriesKey />
              <div>
                <p className="tabular font-semibold">{formatValue(activePoint.y)}</p>
                <p className="text-xs text-muted">{formatDate(activePoint.x)}</p>
                {activePoint.note && <p className="text-xs text-muted">{activePoint.note}</p>}
              </div>
            </div>
          </Tooltip>
        )}
        <p className="sr-only" aria-live="polite">
          {activePoint ? `${formatDate(activePoint.x)}: ${formatValue(activePoint.y)}` : ""}
        </p>
      </div>
    </ChartFrame>
  );
}

// ─────────────────────────── Säulen (Wochenwerte) ───────────────────────────

export interface Column {
  key: string;
  /** Achsenbeschriftung (kurz) */
  label: string;
  /** Tooltip/Tabelle */
  fullLabel: string;
  value: number;
}

export function ColumnChart({
  title,
  description,
  columns,
  formatValue,
  formatTick = formatValue,
  band,
  reference,
  height = 200,
  valueLabel = "Wert",
  categoryLabel = "Zeitraum",
}: {
  title: string;
  description?: string;
  columns: readonly Column[];
  formatValue: Format;
  formatTick?: Format;
  /** Zielbereich (Richtwert) als hinterlegtes Band */
  band?: { min: number; max: number; label: string };
  /** Referenzlinie, z. B. geplante Sätze */
  reference?: { value: number; label: string };
  height?: number;
  valueLabel?: string;
  categoryLabel?: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const { active, setActive, onKeyDown } = useActiveIndex(columns.length);
  const descId = useId();

  const innerW = Math.max(0, width - MARGIN.left - MARGIN.right);
  const innerH = height - MARGIN.top - MARGIN.bottom;
  const top = Math.max(...columns.map((c) => c.value), band?.max ?? 0, reference?.value ?? 0, 1);
  const scale = niceTicks(0, top, 4);
  const sy = (y: number) => MARGIN.top + innerH - (y / scale.max) * innerH;
  const baseline = sy(0);
  const slot = columns.length ? innerW / columns.length : 0;
  const barW = Math.max(2, Math.min(24, slot * 0.62, slot - 2));
  const center = (i: number) => MARGIN.left + slot * i + slot / 2;
  // Beschriftung nur, wo Platz ist – die jüngste Säule immer
  const labelEvery = slot >= 34 ? 1 : Math.ceil(34 / Math.max(slot, 1));
  const summary = `${title}: ${columns.map((c) => `${c.fullLabel} ${formatValue(c.value)}`).join(", ")}.`;
  const activeColumn = active != null ? columns[active] : null;

  return (
    <ChartFrame
      title={title}
      description={description}
      table={
        <DataTable
          caption={title}
          head={[categoryLabel, valueLabel]}
          rows={[...columns].reverse().map((c) => [c.fullLabel, formatValue(c.value)])}
        />
      }
      legend={
        (band || reference) && (
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
            {band && (
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden="true" className="inline-block size-3 rounded-sm bg-chart-band" />
                {band.label}
              </span>
            )}
            {reference && (
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden="true" className="inline-block h-0.5 w-3 rounded-full bg-chart-ref" />
                {reference.label}
              </span>
            )}
          </div>
        )
      }
    >
      <div
        ref={ref}
        className="relative rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-accent"
        style={{ height }}
        tabIndex={0}
        role="group"
        aria-label={`${title}. Pfeiltasten wählen einzelne Säulen.`}
        aria-describedby={descId}
        onKeyDown={onKeyDown}
        onFocus={() => active == null && setActive(columns.length - 1)}
        onBlur={() => setActive(null)}
      >
        <p id={descId} className="sr-only">{summary}</p>
        {width > 0 && (
          <svg
            width={width}
            height={height}
            role="img"
            aria-label={summary}
            className="block select-none"
            style={{ touchAction: "pan-y" }}
            onPointerLeave={() => setActive(null)}
          >
            {band && (
              <rect
                x={MARGIN.left}
                width={innerW}
                y={sy(band.max)}
                height={Math.max(0, sy(band.min) - sy(band.max))}
                fill="var(--chart-band)"
              />
            )}
            <YAxis ticks={scale.ticks} sy={sy} width={width} format={formatTick} />
            {columns.map((c, i) => {
              const x = center(i) - barW / 2;
              return (
                <g key={c.key}>
                  <path
                    d={columnPath(x, sy(c.value), barW, baseline)}
                    fill="var(--chart-1)"
                    stroke={i === active ? "var(--fg)" : "none"}
                    strokeWidth={i === active ? 1.5 : 0}
                  />
                  {/* Trefferfläche: ganze Spalte, größer als die Säule */}
                  <rect
                    x={MARGIN.left + slot * i}
                    y={MARGIN.top}
                    width={slot}
                    height={innerH}
                    fill="transparent"
                    onPointerEnter={() => setActive(i)}
                    onPointerDown={() => setActive(i)}
                  />
                </g>
              );
            })}
            {reference && (
              <line
                x1={MARGIN.left}
                x2={width - MARGIN.right}
                y1={sy(reference.value)}
                y2={sy(reference.value)}
                stroke="var(--chart-ref)"
                strokeWidth={1.5}
                pointerEvents="none"
              />
            )}
            <g aria-hidden="true">
              {columns.map((c, i) =>
                (columns.length - 1 - i) % labelEvery === 0 ? (
                  <text key={c.key} x={center(i)} y={height - 6} textAnchor="middle" className="fill-muted text-[11px]">
                    {c.label}
                  </text>
                ) : null,
              )}
            </g>
          </svg>
        )}
        {activeColumn && (
          <Tooltip x={center(active!)} width={width}>
            <div className="flex gap-2">
              <span aria-hidden="true" className="mt-[0.4em] inline-block size-2.5 shrink-0 rounded-sm bg-chart-1" />
              <div>
                <p className="tabular font-semibold">{formatValue(activeColumn.value)}</p>
                <p className="text-xs text-muted">{activeColumn.fullLabel}</p>
                {reference && <p className="text-xs text-muted">{reference.label}</p>}
              </div>
            </div>
          </Tooltip>
        )}
        <p className="sr-only" aria-live="polite">
          {activeColumn ? `${activeColumn.fullLabel}: ${formatValue(activeColumn.value)}` : ""}
        </p>
      </div>
    </ChartFrame>
  );
}

// ─────────────────────────── Kennzahl ───────────────────────────

export function StatTile({
  label,
  value,
  delta,
  hint,
}: {
  label: string;
  value: string;
  /** Veränderung; tone: ob die Richtung gut ist */
  delta?: { text: string; direction: "up" | "down" | "flat"; tone: "good" | "bad" | "neutral" };
  hint?: string;
}) {
  const toneClass = delta?.tone === "good" ? "text-good" : delta?.tone === "bad" ? "text-danger" : "text-muted";
  const arrow = delta?.direction === "up" ? "▲" : delta?.direction === "down" ? "▼" : "●";
  return (
    <div className="min-w-0 rounded-xl bg-surface-2 p-3">
      <p className="truncate text-xs text-muted">{label}</p>
      <p className="mt-0.5 truncate text-xl font-semibold">{value}</p>
      {delta && (
        <p className={`mt-0.5 truncate text-xs font-medium ${toneClass}`}>
          <span aria-hidden="true" className="mr-1 text-[10px]">{arrow}</span>
          {delta.text}
        </p>
      )}
      {hint && <p className="mt-0.5 truncate text-xs text-muted">{hint}</p>}
    </div>
  );
}
