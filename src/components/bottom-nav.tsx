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
      className="fixed inset-x-0 bottom-0 z-20 border-t border-border/70 bg-surface/80 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl backdrop-saturate-150"
    >
      <ul className="mx-auto grid max-w-xl grid-cols-5">
        {ITEMS.map(({ href, label, Icon }) => {
          const active = activePath !== null && (activePath === href || activePath.startsWith(`${href}/`));
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-[3.25rem] flex-col items-center justify-center gap-0.5 pt-1.5 text-[0.625rem] font-medium tracking-normal transition-colors ${
                  active ? "text-accent" : "text-muted/90 hover:text-fg"
                }`}
              >
                <Icon className="size-[1.6rem]" strokeWidth={active ? 2.2 : 1.8} />
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
