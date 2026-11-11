import { create } from "zustand";
import {
  downloadAndInstall,
  fetchLatest,
  installedApp,
  openInstallSettings,
  updateAvailable,
  type DownloadProgress,
  type InstalledApp,
  type Release,
} from "./app-update";

// Zustand der App-Updates für Banner und Profilkarte.

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

interface AppUpdateState {
  installed: InstalledApp | null;
  latest: Release | null;
  checkedAt: number | null;
  checking: boolean;
  /** waiting-permission: Nutzer ist in den Einstellungen, um die Installation zu erlauben */
  phase: "idle" | "waiting-permission" | "downloading" | "installing" | "error";
  progress: DownloadProgress | null;
  error: string | null;
  available(): boolean;
  check(force?: boolean): Promise<void>;
  install(): Promise<void>;
  allowInstall(): Promise<void>;
}

const friendly = (err: unknown) => {
  const text = err instanceof Error ? err.message : String(err);
  if (text.includes("INSTALL_NOT_ALLOWED")) return "Installation noch nicht erlaubt.";
  if (/Prüfsumme|gültige|neuer/.test(text)) return text;
  return "Update fehlgeschlagen – bitte später erneut versuchen.";
};

export const useAppUpdate = create<AppUpdateState>((set, get) => ({
  installed: null,
  latest: null,
  checkedAt: null,
  checking: false,
  phase: "idle",
  progress: null,
  error: null,

  available: () => updateAvailable(get().installed, get().latest),

  async check(force = false) {
    const { checking, checkedAt } = get();
    if (checking || (!force && checkedAt && Date.now() - checkedAt < CHECK_INTERVAL_MS)) return;
    set({ checking: true });
    try {
      const [installed, latest] = await Promise.all([installedApp(), fetchLatest().catch(() => null)]);
      set({ installed, latest, checkedAt: Date.now() });
      // Aus den Einstellungen zurück: Erlaubnis da → weiter
      if (get().phase === "waiting-permission" && installed.kind === "app" && installed.canInstall) {
        set({ phase: "idle" });
        await get().install();
      }
    } finally {
      set({ checking: false });
    }
  },

  async install() {
    const { installed, latest } = get();
    if (!latest || installed?.kind !== "app") return;
    if (!installed.canInstall) {
      set({ phase: "error", error: "Installation noch nicht erlaubt." });
      return;
    }
    set({ phase: "downloading", progress: { loaded: 0, total: latest.size }, error: null });
    try {
      await downloadAndInstall(latest, (progress) => set({ progress }));
      // Der System-Installer ist offen; nach dem Update startet die App neu
      set({ phase: "installing" });
    } catch (err) {
      set({ phase: "error", error: friendly(err) });
    }
  },

  async allowInstall() {
    set({ phase: "waiting-permission", error: null });
    try {
      await openInstallSettings();
    } catch (err) {
      set({ phase: "error", error: friendly(err) });
    }
  },
}));
