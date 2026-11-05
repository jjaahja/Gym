/**
 * Erlaubt nur app-interne Pfade als Weiterleitungsziel (Schutz vor Open Redirects
 * wie "//evil.com" oder "/\evil.com").
 */
export function safeNextPath(value: string | null | undefined, fallback = "/dashboard"): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) {
    return fallback;
  }
  return value;
}
