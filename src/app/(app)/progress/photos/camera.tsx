"use client";

import { useEffect, useRef, useState } from "react";
import { Segmented } from "@/components/ui";
import type { PhotoPose, ProgressPhoto } from "@/lib/offline/db";
import { captureFrame, latestOfPose, POSES, preparePhoto } from "@/lib/photos";
import { usePhotoUrl } from "@/lib/use-photo-url";

export interface Shot {
  blob: Blob;
  width: number;
  height: number;
  pose: PhotoPose;
  takenOn: string;
}

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const TIMERS = [
  { value: "0", label: "Sofort" },
  { value: "3", label: "3 s" },
  { value: "10", label: "10 s" },
] as const;

/**
 * Kamera im Vollbild: Pose wählen, letztes Foto derselben Pose halbtransparent als Vorlage (gleiche Haltung, gleicher
 * Abstand), Selbstauslöser zum Abstellen des Handys. Ohne Kamera(-Freigabe): Foto aus der Galerie.
 */
export function Camera({
  photos,
  initialPose,
  onDone,
  onClose,
}: {
  photos: readonly ProgressPhoto[];
  initialPose: PhotoPose;
  onDone: (shot: Shot) => Promise<void> | void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [pose, setPose] = useState<PhotoPose>(initialPose);
  const [facing, setFacing] = useState<"user" | "environment">("user");
  const [timer, setTimer] = useState<(typeof TIMERS)[number]["value"]>("10");
  const [ghost, setGhost] = useState(true);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [review, setReview] = useState<{ blob: Blob; width: number; height: number; url: string } | null>(null);
  const [takenOn, setTakenOn] = useState(today);
  const [saving, setSaving] = useState(false);
  const template = latestOfPose(photos, pose);
  const templateUrl = usePhotoUrl(template);

  // Kamera starten (und beim Wechsel neu)
  useEffect(() => {
    if (review) return;
    let stream: MediaStream | null = null;
    let cancelled = false;
    void (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("Keine Kamera verfügbar");
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
        if (cancelled) return;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play().catch(() => {});
        }
        setCameraError(null);
      } catch (err) {
        if (!cancelled)
          setCameraError(
            err instanceof DOMException && err.name === "NotAllowedError"
              ? "Kamera nicht freigegeben. Du kannst ein Foto aus der Galerie wählen."
              : "Kamera nicht verfügbar. Du kannst ein Foto aus der Galerie wählen.",
          );
      }
    })();
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [facing, review]);

  // Selbstauslöser
  const tick = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopCountdown = () => {
    if (tick.current) clearInterval(tick.current);
    tick.current = null;
    setCountdown(null);
  };
  function startCountdown(seconds: number) {
    let left = seconds;
    setCountdown(left);
    tick.current = setInterval(() => {
      left -= 1;
      if (left > 0) {
        if (left <= 3) navigator.vibrate?.(60);
        setCountdown(left);
        return;
      }
      stopCountdown();
      void shoot();
    }, 1000);
  }
  useEffect(() => () => void (tick.current && clearInterval(tick.current)), []);

  async function shoot() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const shot = await captureFrame(video, facing === "user");
    navigator.vibrate?.(150);
    setReview({ ...shot, url: URL.createObjectURL(shot.blob) });
  }

  async function fromFile(file: File | undefined) {
    if (!file) return;
    const shot = await preparePhoto(file);
    // Datum aus der Datei, falls sie älter ist (z. B. Fotos aus der Galerie nachtragen)
    const modified = new Date(file.lastModified);
    if (file.lastModified && modified < new Date()) {
      setTakenOn(`${modified.getFullYear()}-${String(modified.getMonth() + 1).padStart(2, "0")}-${String(modified.getDate()).padStart(2, "0")}`);
    }
    setReview({ ...shot, url: URL.createObjectURL(shot.blob) });
  }

  async function accept() {
    if (!review) return;
    setSaving(true);
    try {
      await onDone({ blob: review.blob, width: review.width, height: review.height, pose, takenOn });
      URL.revokeObjectURL(review.url);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  const hint = POSES.find((p) => p.value === pose)!.hint;

  return (
    <div role="dialog" aria-modal="true" aria-label="Fortschrittsfoto aufnehmen" className="fixed inset-0 z-50 flex flex-col bg-black text-white">
      <div className="flex items-center justify-between px-4 pt-[max(env(safe-area-inset-top),0.75rem)] pb-2">
        <button type="button" onClick={onClose} className="min-h-11 text-[1.0625rem]">
          Abbrechen
        </button>
        <span className="text-[1.0625rem] font-semibold">{review ? "Vorschau" : "Foto"}</span>
        {!review && !cameraError ? (
          <button
            type="button"
            onClick={() => setFacing((f) => (f === "user" ? "environment" : "user"))}
            className="min-h-11 text-[1.0625rem]"
            aria-label="Kamera wechseln"
          >
            ⟲ Kamera
          </button>
        ) : (
          <span className="w-16" />
        )}
      </div>

      <div className="px-4">
        <Segmented variant="overlay" value={pose} onChange={setPose} options={POSES} />
      </div>
      <p className="px-4 pt-2 text-center text-[0.8125rem] text-white/75">{hint}</p>

      <div className="relative mx-4 mt-3 flex-1 overflow-hidden rounded-2xl bg-neutral-900">
        <div className="absolute inset-0 m-auto aspect-[3/4] max-h-full max-w-full">
          {review ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={review.url} alt="Aufgenommenes Foto" className="size-full object-cover" />
          ) : (
            <>
              <video
                ref={videoRef}
                playsInline
                muted
                autoPlay
                className={`size-full object-cover ${facing === "user" ? "-scale-x-100" : ""}`}
              />
              {ghost && templateUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={templateUrl} alt="" aria-hidden="true" className="pointer-events-none absolute inset-0 size-full object-cover opacity-35" />
              )}
              {/* Hilfslinien für gleichen Abstand: Kopf oben, Füße unten, Körpermitte */}
              <div aria-hidden="true" className="pointer-events-none absolute inset-0">
                <div className="absolute inset-x-6 top-[8%] border-t border-dashed border-white/50" />
                <div className="absolute inset-x-6 bottom-[6%] border-t border-dashed border-white/50" />
                <div className="absolute inset-y-6 left-1/2 border-l border-dashed border-white/30" />
                <span className="absolute left-7 top-[8%] mt-1 text-[11px] text-white/70">Kopf</span>
                <span className="absolute bottom-[6%] left-7 mb-1 text-[11px] text-white/70">Füße</span>
              </div>
              {countdown != null && (
                <div className="absolute inset-0 grid place-items-center bg-black/30 text-8xl font-bold tabular" aria-live="assertive">
                  {countdown}
                </div>
              )}
              {cameraError && (
                <div className="absolute inset-0 grid place-items-center p-6 text-center text-[0.9375rem]" role="status">
                  {cameraError}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <div className="space-y-3 px-4 pt-3 pb-[max(env(safe-area-inset-bottom),1rem)]">
        {review ? (
          <>
            <label className="flex items-center justify-between gap-3 text-[0.9375rem]">
              Aufgenommen am
              <input
                type="date"
                value={takenOn}
                max={today()}
                onChange={(e) => e.target.value && setTakenOn(e.target.value)}
                className="min-h-10 rounded-lg bg-white/15 px-3 text-white [color-scheme:dark]"
              />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                className="min-h-[3.125rem] rounded-[0.875rem] bg-white/15 text-[1.0625rem] font-semibold"
                onClick={() => {
                  URL.revokeObjectURL(review.url);
                  setReview(null);
                }}
              >
                Neu aufnehmen
              </button>
              <button
                type="button"
                disabled={saving}
                className="min-h-[3.125rem] rounded-[0.875rem] bg-white text-[1.0625rem] font-semibold text-black disabled:opacity-50"
                onClick={accept}
              >
                Foto verwenden
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center justify-between gap-3 text-[0.8125rem]">
              <div className="min-w-0 flex-1">
                <Segmented variant="overlay" value={timer} onChange={setTimer} options={TIMERS} />
              </div>
              {templateUrl && (
                <button
                  type="button"
                  aria-pressed={ghost}
                  onClick={() => setGhost((g) => !g)}
                  className={`min-h-9 shrink-0 rounded-full px-3 font-semibold ${ghost ? "bg-white text-black" : "bg-white/15"}`}
                >
                  Vorlage
                </button>
              )}
            </div>
            <div className="flex items-center justify-between">
              <button type="button" onClick={() => fileRef.current?.click()} className="min-h-11 w-24 text-left text-[0.9375rem]">
                Galerie
              </button>
              <button
                type="button"
                aria-label={countdown != null ? "Selbstauslöser abbrechen" : "Foto aufnehmen"}
                disabled={Boolean(cameraError)}
                onClick={() => (countdown != null ? stopCountdown() : timer === "0" ? void shoot() : startCountdown(Number(timer)))}
                className="grid size-[4.5rem] place-items-center rounded-full border-4 border-white disabled:opacity-30"
              >
                <span className={`block transition-all ${countdown != null ? "size-7 rounded-md bg-red-500" : "size-14 rounded-full bg-white"}`} />
              </button>
              <span className="w-24" />
            </div>
          </>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          aria-label="Foto aus der Galerie wählen"
          onChange={(e) => {
            void fromFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </div>
    </div>
  );
}
