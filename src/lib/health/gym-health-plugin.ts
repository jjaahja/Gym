// Eigenes Android-Plugin „GymHealth“ – einmal registriert, von Trainings-Export und Lese-Funktionen gemeinsam genutzt
// (Capacitor warnt bei doppelter Registrierung).

let registered: unknown = null;

/** Als Objekt zurückgeben – ein Plugin-Proxy direkt aus einer async-Funktion würde als Promise behandelt. */
export async function gymHealthPlugin<T>(): Promise<{ available: boolean; plugin: T }> {
  const { Capacitor, registerPlugin } = await import("@capacitor/core");
  registered ??= registerPlugin("GymHealth");
  return { available: Capacitor.isPluginAvailable("GymHealth"), plugin: registered as T };
}
