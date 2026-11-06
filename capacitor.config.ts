import type { CapacitorConfig } from "@capacitor/cli";

// Android-App als Hülle um die Web-App: lädt die veröffentlichte Version (Updates kommen ohne neue APK)
// und ergänzt nur die native Schnittstelle zu Health Connect. Siehe docs/09-health-connect-android.md.
const config: CapacitorConfig = {
  appId: "de.jjaahja.gym",
  appName: "Gym",
  // Nur Fallback-Seiten (Fehlerseite ohne Netz); die App selbst kommt von server.url
  webDir: "capacitor/www",
  server: {
    url: "https://gym-alpha-flax.vercel.app/dashboard",
    errorPath: "offline.html",
  },
  android: {
    backgroundColor: "#0b0b0d",
    allowMixedContent: false,
  },
};

export default config;
