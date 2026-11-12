import type { GymDB, PhotoPose, ProgressPhoto } from "@/lib/offline/db";
import type { NewOutboxEntry } from "@/lib/offline/outbox";

// Fortschrittsfotos: lokal sofort (IndexedDB), Datei und Metadaten über die Outbox in den privaten Speicher.
// Reihenfolge: erst die Datei, dann die Zeile (andere Geräte sehen nie eine Zeile ohne Datei);
// beim Löschen umgekehrt.

export const POSES: readonly { value: PhotoPose; label: string; hint: string }[] = [
  { value: "front", label: "Vorne", hint: "Frontal, Arme leicht abgespreizt, entspannt stehen" },
  { value: "side", label: "Seite", hint: "Seitlich (links), Arme locker nach vorn" },
  { value: "back", label: "Hinten", hint: "Rücken zur Kamera, Arme leicht abgespreizt" },
];

/** Längste Kante nach dem Verkleinern – genug für Vergleiche, klein genug für schnelles Hochladen (meist < 500 KB). */
export const MAX_EDGE = 1600;
export const JPEG_QUALITY = 0.85;

export function scaledSize(width: number, height: number, maxEdge = MAX_EDGE): { width: number; height: number } {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

export const photoPath = (userId: string, id: string) => `${userId}/${id}.jpg`;

interface SyncOptions {
  userId: string | null;
  sink: (entry: NewOutboxEntry) => void;
  now?: Date;
  uuid?: () => string;
}

export async function addPhoto(
  db: GymDB,
  input: { blob: Blob; width: number; height: number; pose: PhotoPose; takenOn: string },
  options: SyncOptions,
): Promise<ProgressPhoto> {
  const id = (options.uuid ?? (() => crypto.randomUUID()))();
  const storagePath = options.userId ? photoPath(options.userId, id) : null;
  const photo: ProgressPhoto = {
    id,
    takenOn: input.takenOn,
    pose: input.pose,
    storagePath,
    width: input.width,
    height: input.height,
    blob: input.blob,
    createdAt: (options.now ?? new Date()).toISOString(),
  };
  await db.photos.put(photo);
  if (options.userId && storagePath) {
    options.sink({ table: "photo_files", op: "upsert", rowId: id, payload: { id, path: storagePath } });
    options.sink({
      table: "progress_photos",
      op: "upsert",
      rowId: id,
      payload: {
        id,
        user_id: options.userId,
        taken_on: photo.takenOn,
        pose: photo.pose,
        storage_path: storagePath,
        width: photo.width,
        height: photo.height,
        created_at: photo.createdAt,
      },
    });
  }
  return photo;
}

export async function deletePhoto(db: GymDB, photo: Pick<ProgressPhoto, "id" | "storagePath">, options: Omit<SyncOptions, "now" | "uuid">) {
  await db.photos.delete(photo.id);
  if (options.userId && photo.storagePath) {
    options.sink({ table: "progress_photos", op: "delete", rowId: photo.id, payload: { id: photo.id } });
    options.sink({ table: "photo_files", op: "delete", rowId: photo.id, payload: { id: photo.id, path: photo.storagePath } });
  }
}

/** Ältestes und neuestes Foto einer Pose (für den Vorher/Nachher-Vergleich). */
export function comparisonPair(photos: readonly ProgressPhoto[], pose: PhotoPose): { before: ProgressPhoto; after: ProgressPhoto } | null {
  const list = photos.filter((p) => p.pose === pose).sort((a, b) => a.takenOn.localeCompare(b.takenOn) || a.createdAt.localeCompare(b.createdAt));
  return list.length >= 2 ? { before: list[0], after: list.at(-1)! } : null;
}

/** Letztes Foto einer Pose – als halbtransparente Vorlage für die gleiche Haltung und den gleichen Abstand. */
export function latestOfPose(photos: readonly ProgressPhoto[], pose: PhotoPose): ProgressPhoto | null {
  return photos.filter((p) => p.pose === pose).sort((a, b) => b.takenOn.localeCompare(a.takenOn) || b.createdAt.localeCompare(a.createdAt))[0] ?? null;
}

/** Abstand in Tagen/Wochen, z. B. „nach 6 Wochen“. */
export function spanLabel(from: string, to: string): string {
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
  if (days < 14) return `nach ${days} ${days === 1 ? "Tag" : "Tagen"}`;
  if (days < 70) return `nach ${Math.round(days / 7)} Wochen`;
  return `nach ${Math.round(days / 30.4)} Monaten`;
}

// ─────────────────────────── Browser ───────────────────────────

/** Bild aus der Galerie verkleinern und als JPEG kodieren (Ausrichtung aus den EXIF-Daten). Läuft nur im Browser. */
export async function preparePhoto(file: Blob): Promise<{ blob: Blob; width: number; height: number }> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const size = scaledSize(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, size.width, size.height);
  bitmap.close();
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Bild konnte nicht gespeichert werden"))), "image/jpeg", JPEG_QUALITY),
  );
  return { blob, ...size };
}

/** Quellausschnitt für das Seitenverhältnis Breite/Höhe (mittig) – Vorschau und Foto zeigen denselben Ausschnitt. */
export function centerCrop(width: number, height: number, aspect = 3 / 4): { sx: number; sy: number; sw: number; sh: number } {
  if (width / height > aspect) {
    const sw = Math.round(height * aspect);
    return { sx: Math.round((width - sw) / 2), sy: 0, sw, sh: height };
  }
  const sh = Math.round(width / aspect);
  return { sx: 0, sy: Math.round((height - sh) / 2), sw: width, sh };
}

/** Kamerabild im Hochformat 3:4 aufnehmen (wie in der Vorschau, Frontkamera gespiegelt). */
export async function captureFrame(video: HTMLVideoElement, mirror: boolean): Promise<{ blob: Blob; width: number; height: number }> {
  const crop = centerCrop(video.videoWidth, video.videoHeight);
  const size = scaledSize(crop.sw, crop.sh);
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext("2d")!;
  if (mirror) {
    ctx.translate(size.width, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(video, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, size.width, size.height);
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Bild konnte nicht gespeichert werden"))), "image/jpeg", JPEG_QUALITY),
  );
  return { blob, ...size };
}

/** Körpermessung am nächsten zum Fototag (höchstens `maxDays` entfernt) – Gewicht neben dem Vergleich. */
export function measurementNear<T extends { measuredOn: string; bodyWeightKg: number | null }>(
  measurements: readonly T[],
  day: string,
  maxDays = 3,
): T | null {
  let best: T | null = null;
  let bestDiff = Infinity;
  for (const m of measurements) {
    if (m.bodyWeightKg == null) continue;
    const diff = Math.abs(Date.parse(m.measuredOn) - Date.parse(day)) / 86_400_000;
    if (diff <= maxDays && diff < bestDiff) {
      best = m;
      bestDiff = diff;
    }
  }
  return best;
}
