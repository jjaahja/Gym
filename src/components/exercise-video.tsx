"use client";

import { useState, useSyncExternalStore } from "react";
import { EXERCISE_VIDEOS } from "@/data/catalog/videos";
import { PlayIcon } from "./icons";

// Ausführungsvideo mit Zwei-Klick-Lösung: Erst nach dem Tippen wird YouTube geladen (youtube-nocookie.com).
// Vorher gehen keine Daten an Google – auch kein Vorschaubild. Die Zustimmung kann pro Gerät gemerkt werden.

const CONSENT_KEY = "gym-video-consent";

function rememberedConsent(): boolean {
  try {
    return localStorage.getItem(CONSENT_KEY) === "yes";
  } catch {
    return false;
  }
}

const listeners = new Set<() => void>();
const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};

/** Gemerkte Zustimmung – auf dem Server immer „nein“, damit das vorgerenderte HTML gleich bleibt. */
function useConsent(): boolean {
  return useSyncExternalStore(subscribe, rememberedConsent, () => false);
}

export function hasVideo(slug: string): boolean {
  return slug in EXERCISE_VIDEOS;
}

export function ExerciseVideo({ slug, exerciseName }: { slug: string; exerciseName: string }) {
  const video = EXERCISE_VIDEOS[slug];
  const [loaded, setLoaded] = useState(false);
  const [remember, setRemember] = useState(false);
  const consented = useConsent();

  if (!video) {
    return (
      <div className="flex aspect-video items-center justify-center rounded-2xl border border-dashed border-border bg-surface text-sm text-muted">
        Für diese Übung gibt es noch kein Video.
      </div>
    );
  }

  // Mit gemerkter Zustimmung direkt einbetten (ohne Autoplay), sonst erst nach dem Tippen (mit Autoplay)
  const show = loaded || consented;
  const start = () => {
    if (remember) {
      try {
        localStorage.setItem(CONSENT_KEY, "yes");
        listeners.forEach((l) => l());
      } catch {
        // ohne Speicher: Zustimmung gilt nur jetzt
      }
    }
    setLoaded(true);
  };

  return (
    <figure className="overflow-hidden rounded-2xl border border-border bg-black">
      {show ? (
        <iframe
          className="aspect-video w-full"
          src={`https://www.youtube-nocookie.com/embed/${video.youtubeId}?${loaded ? "autoplay=1&" : ""}rel=0&playsinline=1&hl=de`}
          title={`Ausführung: ${exerciseName} (${video.channel})`}
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          referrerPolicy="strict-origin-when-cross-origin"
          allowFullScreen
        />
      ) : (
        <div className="flex aspect-video flex-col items-center justify-center gap-3 bg-gradient-to-br from-surface-2 to-surface p-4 text-center">
          <button
            type="button"
            onClick={start}
            className="flex size-16 items-center justify-center rounded-full bg-accent text-accent-fg shadow-lg transition-transform active:scale-95"
            aria-label={`Video zur Ausführung von ${exerciseName} abspielen`}
          >
            <PlayIcon className="size-7 translate-x-0.5" />
          </button>
          <p className="text-xs text-muted">
            Beim Abspielen wird YouTube geladen – dabei werden Daten an Google übertragen.
          </p>
          {!consented && (
            <label className="flex items-center gap-2 text-xs text-muted">
              <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
              Für alle Videos merken
            </label>
          )}
        </div>
      )}
      <figcaption className="flex items-center justify-between gap-2 bg-surface px-3 py-2 text-xs text-muted">
        <span className="min-w-0 truncate">
          {video.channel} · <span className="text-fg">{video.title}</span>
        </span>
        <a
          href={`https://www.youtube.com/watch?v=${video.youtubeId}`}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 font-medium text-accent"
        >
          YouTube
        </a>
      </figcaption>
    </figure>
  );
}
