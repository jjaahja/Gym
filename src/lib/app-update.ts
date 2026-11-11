import { isAndroidApp } from "@/lib/health/health-connect";

// Updates der Android-App direkt aus der App (ab 1.2, Plugin „AppUpdate“).
// Die aktuelle Version steht in /downloads/version.json (scripts/release-apk.mjs), die APK daneben.
// Inhalte der App kommen ohnehin live von der Webseite – eine neue APK braucht es nur bei nativen Änderungen.

export const RELEASE_URL = "/downloads/version.json";

export interface Release {
  versionCode: number;
  versionName: string;
  /** Dateiname der APK neben version.json */
  file: string;
  sha256: string;
  size: number;
  date: string;
  notes: string[];
}

export type InstalledApp =
  | { kind: "browser" }
  /** Android-App ohne Update-Funktion (1.0, 1.1) */
  | { kind: "legacy" }
  | { kind: "app"; versionCode: number; versionName: string; canInstall: boolean };

export interface DownloadProgress {
  loaded: number;
  total: number;
}

interface AppUpdatePlugin {
  getInfo(): Promise<{ versionCode: number; versionName: string; canInstall: boolean }>;
  openInstallSettings(): Promise<void>;
  downloadAndInstall(options: { url: string; sha256: string }): Promise<{ started: boolean; versionCode: number }>;
  addListener(event: "downloadProgress", listener: (p: DownloadProgress) => void): Promise<{ remove: () => Promise<void> }>;
}

let registered: AppUpdatePlugin | null = null;
// Als Objekt zurückgeben – ein Plugin-Proxy direkt aus einer async-Funktion würde als Promise behandelt
async function appUpdate(): Promise<{ available: boolean; plugin: AppUpdatePlugin }> {
  const { Capacitor, registerPlugin } = await import("@capacitor/core");
  registered ??= registerPlugin<AppUpdatePlugin>("AppUpdate");
  return { available: Capacitor.isPluginAvailable("AppUpdate"), plugin: registered };
}

export async function installedApp(): Promise<InstalledApp> {
  if (!isAndroidApp()) return { kind: "browser" };
  const { available, plugin } = await appUpdate();
  if (!available) return { kind: "legacy" };
  return { kind: "app", ...(await plugin.getInfo()) };
}

export function isRelease(value: unknown): value is Release {
  const r = value as Partial<Release> | null;
  return (
    typeof r?.versionCode === "number" &&
    typeof r.versionName === "string" &&
    typeof r.file === "string" &&
    /^[\w.-]+\.apk$/.test(r.file) &&
    typeof r.sha256 === "string" &&
    /^[0-9a-f]{64}$/.test(r.sha256) &&
    Array.isArray(r.notes)
  );
}

export async function fetchLatest(fetcher: typeof fetch = fetch): Promise<Release | null> {
  const response = await fetcher(RELEASE_URL, { cache: "no-store" });
  if (!response.ok) return null;
  const data: unknown = await response.json();
  return isRelease(data) ? data : null;
}

/** Gibt es eine neuere Version als die installierte? */
export function updateAvailable(installed: InstalledApp | null, latest: Release | null): boolean {
  if (!installed || !latest) return false;
  if (installed.kind === "legacy") return true;
  return installed.kind === "app" && latest.versionCode > installed.versionCode;
}

export const apkUrl = (release: Release, origin: string) => new URL(`/downloads/${release.file}`, origin).toString();

export async function openInstallSettings(): Promise<void> {
  await (await appUpdate()).plugin.openInstallSettings();
}

/** Lädt die APK, prüft sie im nativen Teil und öffnet den Installer. */
export async function downloadAndInstall(release: Release, onProgress: (p: DownloadProgress) => void): Promise<void> {
  const { plugin } = await appUpdate();
  const handle = await plugin.addListener("downloadProgress", onProgress);
  try {
    await plugin.downloadAndInstall({ url: apkUrl(release, window.location.origin), sha256: release.sha256 });
  } finally {
    await handle.remove();
  }
}

/** Alte App ohne Update-Funktion: einmalig im Browser laden (andere Adresse → öffnet sich außerhalb der App). */
export const LEGACY_DOWNLOAD_URL = (release: Release) =>
  `https://raw.githubusercontent.com/jjaahja/Gym/claude/fitness-app-database-schema-5b8mbf/public/downloads/${release.file}`;
