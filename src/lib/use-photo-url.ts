"use client";

import { useEffect, useState } from "react";
import { getDb, type ProgressPhoto } from "@/lib/offline/db";
import { PHOTO_BUCKET } from "@/lib/offline/outbox";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

// Fotos von anderen Geräten: Datei erst bei Bedarf aus dem privaten Speicher laden und lokal behalten.

const inflight = new Map<string, Promise<Blob | null>>();

export function downloadPhoto(photo: Pick<ProgressPhoto, "id" | "storagePath">): Promise<Blob | null> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase || !photo.storagePath) return Promise.resolve(null);
  let job = inflight.get(photo.id);
  if (!job) {
    job = (async () => {
      const { data, error } = await supabase.storage.from(PHOTO_BUCKET).download(photo.storagePath!);
      if (error || !data) return null;
      // nur ergänzen, falls das Foto inzwischen nicht gelöscht wurde
      await getDb().photos.update(photo.id, { blob: data });
      return data;
    })().finally(() => inflight.delete(photo.id));
    inflight.set(photo.id, job);
  }
  return job;
}

/** Objekt-URL des Fotos (lokal oder nachgeladen); null, solange nicht verfügbar. */
export function usePhotoUrl(photo: ProgressPhoto | null | undefined): string | null {
  const [url, setUrl] = useState<{ id: string; url: string } | null>(null);
  const id = photo?.id;
  const blob = photo?.blob;
  const path = photo?.storagePath;
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    void (async () => {
      const data = blob ?? (await downloadPhoto({ id, storagePath: path ?? null }));
      if (!data || cancelled) return;
      objectUrl = URL.createObjectURL(data);
      setUrl({ id, url: objectUrl });
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [id, blob, path]);
  return url && url.id === id ? url.url : null;
}
