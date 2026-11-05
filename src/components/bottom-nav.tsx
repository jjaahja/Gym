"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChartIcon, DumbbellIcon, LibraryIcon, PlanIcon, UserIcon } from "./icons";

const ITEMS = [
  { href: "/dashboard", label: "Plan", Icon: PlanIcon },
  { href: "/workout", label: "Training", Icon: DumbbellIcon },
  { href: "/exercises", label: "Übungen", Icon: LibraryIcon },
  { href: "/progress", label: "Fortschritt", Icon: ChartIcon },
  { href: "/settings", label: "Profil", Icon: UserIcon },
] as const;

/** Navigation ohne Hervorhebung – statisch vorrenderbar, dient als Suspense-Fallback. */
export function NavBar({ activePath }: { activePath: string | null }) {
  return (
    <nav
      aria-label="Hauptnavigation"
      className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-surface/95 backdrop-blur pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="mx-auto grid max-w-xl grid-cols-5">
        {ITEMS.map(({ href, label, Icon }) => {
          const active = activePath !== null && (activePath === href || activePath.startsWith(`${href}/`));
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors ${
                  active ? "text-accent" : "text-muted hover:text-fg"
                }`}
              >
                <Icon className="size-6" />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Mit aktivem Menüpunkt. usePathname ist unter Cache Components Laufzeitdaten → in Suspense einbetten. */
export function BottomNav() {
  return <NavBar activePath={usePathname()} />;
}
