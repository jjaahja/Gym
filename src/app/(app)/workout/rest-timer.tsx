"use client";

import { useEffect, useRef, useState } from "react";
import { useRestTimer } from "./ui-state";

function format(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Pausen-Timer über der Navigation – startet automatisch nach jedem Satz. */
export function RestTimer() {
  const { endsAt, totalSeconds, hint, extend, stop } = useRestTimer();
  const [now, setNow] = useState(() => Date.now());
  const notified = useRef<number | null>(null);

  useEffect(() => {
    if (!endsAt) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [endsAt]);

  const remaining = endsAt ? (endsAt - now) / 1000 : 0;
  const done = endsAt !== null && remaining <= 0;

  useEffect(() => {
    if (done && notified.current !== endsAt) {
      notified.current = endsAt;
      navigator.vibrate?.([200, 100, 200]);
    }
  }, [done, endsAt]);

  if (!endsAt) return null;
  const progress = totalSeconds > 0 ? Math.min(1, 1 - remaining / totalSeconds) : 1;

  return (
    <div
      role="timer"
      aria-live="polite"
      className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-20 mx-auto max-w-xl px-3 pb-2"
    >
      <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-lg">
        <div className="h-1 bg-surface-2">
          <div className="h-full bg-accent transition-[width] duration-200" style={{ width: `${progress * 100}%` }} />
        </div>
        <div className="flex items-center gap-3 px-3 py-1.5">
          <p className={`tabular w-16 shrink-0 text-xl font-bold ${done ? "text-accent" : ""}`}>{done ? "Los!" : format(remaining)}</p>
          <p className="min-w-0 flex-1 truncate text-xs text-muted">{done ? "Pause vorbei – nächster Satz" : hint}</p>
          {!done && (
            <button type="button" onClick={() => extend(15)} className="min-h-10 rounded-xl border border-border px-3 text-sm font-medium">
              +15 s
            </button>
          )}
          <button type="button" onClick={stop} className="min-h-10 rounded-xl bg-surface-2 px-3 text-sm font-medium">
            {done ? "OK" : "Weiter"}
          </button>
        </div>
      </div>
    </div>
  );
}
