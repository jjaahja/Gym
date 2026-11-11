import { createServerClient } from "@supabase/ssr";
import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { isSupabaseConfigured, SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "@/lib/supabase/config";

// Läuft vor jeder Seite: erneuert die Supabase-Session und leitet nicht angemeldete
// Nutzer zum Login. Die eigentliche Datensicherheit liegt in der DB (Row Level Security).

// /datenschutz: Health Connect verlinkt die Seite ohne Anmeldung
// /api/calendar: Kalender-Abo – Kalender-Apps senden keine Anmeldung, der geheime Token im Link schützt
const PUBLIC_PATHS = ["/login", "/auth", "/offline", "/datenschutz", "/api/calendar"];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function redirectWithCookies(url: URL, source: NextResponse): NextResponse {
  const response = NextResponse.redirect(url);
  source.cookies.getAll().forEach((cookie) => response.cookies.set(cookie));
  const cacheControl = source.headers.get("Cache-Control");
  if (cacheControl) response.headers.set("Cache-Control", cacheControl);
  return response;
}

export async function proxy(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.next();

  let response = NextResponse.next({ request });

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        // Antworten mit Auth-Cookies dürfen nicht von CDNs gecacht werden
        Object.entries(headers ?? {}).forEach(([key, value]) => response.headers.set(key, value));
      },
    },
  });

  const { data, error } = await supabase.auth.getClaims();

  // Supabase kurz nicht erreichbar: nicht ausloggen, die App-Shell darf laden.
  if (error && isAuthRetryableFetchError(error)) return response;

  const signedIn = Boolean(data?.claims);
  const { pathname, search } = request.nextUrl;

  if (!signedIn && !isPublic(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    url.searchParams.set("next", `${pathname}${search}`);
    return redirectWithCookies(url, response);
  }

  if (signedIn && pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return redirectWithCookies(url, response);
  }

  return response;
}

export const config = {
  matcher: [
    // Alles außer statischen Dateien, Service Worker, Manifest und Icons
    // downloads/: Android-App und version.json – ohne Anmeldung (Download-Manager und Update-Prüfung)
    "/((?!_next/static|_next/image|sw\\.js|manifest\\.webmanifest|icons/|downloads/|icon\\.svg|apple-icon\\.png|.*\\.(?:png|jpg|jpeg|svg|webp|ico)$).*)",
  ],
};
