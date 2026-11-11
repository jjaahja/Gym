// Veröffentlicht die zuletzt gebaute Android-App als neueste Version für die Update-Funktion.
//
// Ablauf: cd android && ./gradlew assembleRelease (mit android/keystore.properties – Schlüssel liegt im Google Drive
// des Besitzers, siehe docs/09), dann:
//   node scripts/release-apk.mjs "Was ist neu 1" "Was ist neu 2"
// Kopiert die APK nach public/downloads/gym-<version>.apk (ältere werden entfernt) und schreibt version.json mit
// Version, Prüfsumme und Größe. Danach committen und veröffentlichen – die App bietet das Update an.
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const out = "android/app/build/outputs/apk/release";
const meta = JSON.parse(readFileSync(join(out, "output-metadata.json"), "utf8"));
const element = meta.elements?.[0];
if (!element?.outputFile || !element.versionCode || !element.versionName) throw new Error("Kein Release-Build gefunden");

const target = "public/downloads";
const previous = (() => {
  try {
    return JSON.parse(readFileSync(join(target, "version.json"), "utf8"));
  } catch {
    return null;
  }
})();
if (previous && element.versionCode <= previous.versionCode) {
  throw new Error(`versionCode ${element.versionCode} ist nicht höher als veröffentlicht (${previous.versionCode}) – in android/app/build.gradle erhöhen`);
}

const apk = readFileSync(join(out, element.outputFile));
const file = `gym-${element.versionName}.apk`;
mkdirSync(target, { recursive: true });
for (const f of readdirSync(target)) if (/^gym-.*\.apk$/.test(f) && f !== file) rmSync(join(target, f));
copyFileSync(join(out, element.outputFile), join(target, file));

const notes = process.argv.slice(2);
const release = {
  versionCode: element.versionCode,
  versionName: element.versionName,
  file,
  sha256: createHash("sha256").update(apk).digest("hex"),
  size: statSync(join(target, file)).size,
  date: new Date().toISOString().slice(0, 10),
  notes,
};
writeFileSync(join(target, "version.json"), `${JSON.stringify(release, null, 2)}\n`);
console.log(`Veröffentlicht: ${file} (versionCode ${release.versionCode}, ${(release.size / 1048576).toFixed(1)} MB)`);
