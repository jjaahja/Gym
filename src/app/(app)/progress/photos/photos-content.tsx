"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Sheet } from "@/components/sheet";
import { buttonStyles, Card, Segmented } from "@/components/ui";
import { getDb, type PhotoPose, type ProgressPhoto } from "@/lib/offline/db";
import { listMeasurements } from "@/lib/offline/measurements";
import { writeToOutbox } from "@/lib/offline/sink";
import { useLiveQuery } from "@/lib/offline/use-live-query";
import { addPhoto, comparisonPair, deletePhoto, measurementNear, POSES, spanLabel } from "@/lib/photos";
import { getCurrentUserId } from "@/lib/supabase/client";
import { formatWeight } from "@/lib/units";
import { usePhotoUrl } from "@/lib/use-photo-url";
import { useSettings } from "@/stores/settings";
import { Camera, type Shot } from "./camera";

const dateLabel = (day: string, withYear = false) =>
  new Date(`${day}T12:00:00`).toLocaleDateString("de-DE", { day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}) });

/** Fortschrittsfotos: aufnehmen (mit Vorlage), Vorher/Nachher vergleichen, ansehen und löschen. */
export function PhotosContent() {
  const photos = useLiveQuery<ProgressPhoto[] | null>(() => getDb().photos.orderBy("takenOn").reverse().toArray(), [], null);
  const measurements = useLiveQuery(() => listMeasurements(getDb()), [], []);
  const [pose, setPose] = useState<PhotoPose>("front");
  const [camera, setCamera] = useState(false);
  const [viewing, setViewing] = useState<ProgressPhoto | null>(null);
  const ofPose = useMemo(() => (photos ?? []).filter((p) => p.pose === pose), [photos, pose]);

  async function save(shot: Shot) {
    await addPhoto(getDb(), shot, { userId: await getCurrentUserId(), sink: writeToOutbox });
    setPose(shot.pose);
  }

  return (
    <div className="space-y-5">
      <header>
        <Link href="/progress" className="text-[1.0625rem] text-accent">
          ‹ Fortschritt
        </Link>
        <h1 className="mt-2 text-[2.125rem] font-bold leading-[1.15]">Fotos</h1>
        <p className="text-[0.9375rem] text-muted">Optische Veränderung sichtbar machen – gleiche Pose, gleiches Licht.</p>
      </header>

      <Segmented value={pose} onChange={setPose} options={POSES} />

      {photos == null ? (
        <Card className="h-64 animate-pulse">{null}</Card>
      ) : (
        <>
          <Comparison photos={ofPose} measurements={measurements} />
          <button type="button" className={`${buttonStyles.primary} w-full`} onClick={() => setCamera(true)}>
            Foto aufnehmen
          </button>
          {ofPose.length > 0 ? (
            <ul className="grid grid-cols-3 gap-1.5" aria-label="Alle Fotos dieser Pose">
              {ofPose.map((p) => (
                <li key={p.id}>
                  <Thumb photo={p} onOpen={() => setViewing(p)} />
                </li>
              ))}
            </ul>
          ) : (
            <Card>
              <p className="font-semibold">Noch keine Fotos ({POSES.find((p) => p.value === pose)!.label})</p>
              <p className="mt-1 text-[0.9375rem] text-muted">
                Tipp: alle 2–4 Wochen, morgens vor dem Essen, am selben Ort mit gleichem Licht. Die App blendet beim nächsten Mal
                dein letztes Foto als Vorlage ein.
              </p>
            </Card>
          )}
          <p className="px-4 text-[0.8125rem] text-muted">
            Deine Fotos sind privat: Sie liegen auf diesem Gerät und – mit Konto – in einem geschützten Speicher, auf den nur du
            Zugriff hast.
          </p>
        </>
      )}

      {camera && <Camera photos={photos ?? []} initialPose={pose} onDone={save} onClose={() => setCamera(false)} />}
      {viewing && <Viewer photo={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}

function Thumb({ photo, onOpen }: { photo: ProgressPhoto; onOpen: () => void }) {
  const url = usePhotoUrl(photo);
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Foto vom ${dateLabel(photo.takenOn, true)} öffnen`}
      className="relative block aspect-[3/4] w-full overflow-hidden rounded-xl bg-surface-2"
    >
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="size-full object-cover" />
      ) : (
        <span className="absolute inset-0 animate-pulse" />
      )}
      <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-2 pb-1.5 pt-4 text-left text-xs font-semibold text-white">
        {dateLabel(photo.takenOn)}
      </span>
    </button>
  );
}

function Viewer({ photo, onClose }: { photo: ProgressPhoto; onClose: () => void }) {
  const url = usePhotoUrl(photo);
  const [confirm, setConfirm] = useState(false);
  async function remove() {
    await deletePhoto(getDb(), photo, { userId: await getCurrentUserId(), sink: writeToOutbox });
    onClose();
  }
  return (
    <Sheet open onClose={onClose} title={dateLabel(photo.takenOn, true)}>
      <div className="overflow-hidden rounded-2xl bg-surface-2">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={`Fortschrittsfoto vom ${dateLabel(photo.takenOn, true)}`} className="aspect-[3/4] w-full object-cover" />
        ) : (
          <div className="aspect-[3/4] animate-pulse" />
        )}
      </div>
      {confirm ? (
        <div className="mt-4 space-y-2">
          <p className="text-[0.9375rem]">Foto endgültig löschen – auf allen Geräten?</p>
          <button type="button" className={`${buttonStyles.danger} w-full`} onClick={remove}>
            Löschen
          </button>
          <button type="button" className={`${buttonStyles.secondary} w-full`} onClick={() => setConfirm(false)}>
            Abbrechen
          </button>
        </div>
      ) : (
        <button type="button" className={`${buttonStyles.danger} mt-4 w-full`} onClick={() => setConfirm(true)}>
          Foto löschen
        </button>
      )}
    </Sheet>
  );
}

// ─────────────────────────── Vorher / Nachher ───────────────────────────

function Comparison({
  photos,
  measurements,
}: {
  photos: readonly ProgressPhoto[];
  measurements: readonly { measuredOn: string; bodyWeightKg: number | null }[];
}) {
  const unit = useSettings((s) => s.unitSystem);
  const defaults = comparisonPair(photos, photos[0]?.pose ?? "front");
  const [beforeId, setBeforeId] = useState<string | null>(null);
  const [afterId, setAfterId] = useState<string | null>(null);
  const [split, setSplit] = useState(50);
  const before = photos.find((p) => p.id === beforeId) ?? defaults?.before;
  const after = photos.find((p) => p.id === afterId) ?? defaults?.after;
  const beforeUrl = usePhotoUrl(before);
  const afterUrl = usePhotoUrl(after);
  if (!defaults || !before || !after) return null;

  const [first, second] = before.takenOn <= after.takenOn ? [before, after] : [after, before];
  const w1 = measurementNear(measurements, first.takenOn);
  const w2 = measurementNear(measurements, second.takenOn);
  const options = [...photos].sort((a, b) => a.takenOn.localeCompare(b.takenOn));
  const select = (label: string, value: string, onChange: (id: string) => void) => (
    <label className="block min-w-0 flex-1">
      <span className="mb-1 block text-xs text-muted">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="field">
        {options.map((p) => (
          <option key={p.id} value={p.id}>
            {dateLabel(p.takenOn, true)}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <Card className="space-y-3 p-3">
      <div className="flex items-baseline justify-between px-1">
        <h2 className="text-lg font-semibold">Vorher / Nachher</h2>
        <span className="text-sm text-muted">{spanLabel(first.takenOn, second.takenOn)}</span>
      </div>
      <div className="relative aspect-[3/4] w-full overflow-hidden rounded-xl bg-surface-2 select-none">
        {beforeUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={beforeUrl} alt={`Vorher (${dateLabel(before.takenOn, true)})`} className="absolute inset-0 size-full object-cover" />
        )}
        {afterUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={afterUrl}
            alt={`Nachher (${dateLabel(after.takenOn, true)})`}
            className="absolute inset-0 size-full object-cover"
            style={{ clipPath: `inset(0 0 0 ${split}%)` }}
          />
        )}
        <div aria-hidden="true" className="absolute inset-y-0 w-0.5 bg-white shadow-[0_0_4px_rgb(0_0_0/0.5)]" style={{ left: `${split}%` }}>
          <span className="absolute top-1/2 left-1/2 grid size-9 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white text-sm font-bold text-black shadow">
            ⇆
          </span>
        </div>
        <span className="absolute top-2 left-2 rounded-full bg-black/55 px-2 py-0.5 text-xs font-semibold text-white">{dateLabel(before.takenOn)}</span>
        <span className="absolute top-2 right-2 rounded-full bg-black/55 px-2 py-0.5 text-xs font-semibold text-white">{dateLabel(after.takenOn)}</span>
        <input
          type="range"
          min={0}
          max={100}
          value={split}
          onChange={(e) => setSplit(Number(e.target.value))}
          aria-label="Vergleichsregler: links vorher, rechts nachher"
          className="absolute inset-0 size-full cursor-ew-resize opacity-0"
        />
      </div>
      <div className="flex gap-2">
        {select("Vorher", before.id, setBeforeId)}
        {select("Nachher", after.id, setAfterId)}
      </div>
      {w1 && w2 && w1 !== w2 && (
        <p className="px-1 text-sm text-muted">
          Körpergewicht: {formatWeight(w1.bodyWeightKg!, unit)} → <strong className="text-fg">{formatWeight(w2.bodyWeightKg!, unit)}</strong>
        </p>
      )}
    </Card>
  );
}
