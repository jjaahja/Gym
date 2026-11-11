import { Suspense } from "react";
import { BottomNav, NavBar } from "@/components/bottom-nav";
import { UpdateBanner } from "@/components/app-update";
import { OfflineBanner } from "@/components/status-banners";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-xl flex-col">
      <div className="sticky top-0 z-10 pt-[env(safe-area-inset-top)]">
        {!isSupabaseConfigured && (
          <div className="bg-accent-soft px-4 py-2 text-sm">
            <strong>Demo-Modus:</strong> Kein Supabase-Projekt verbunden. Trainings bleiben nur auf diesem Gerät.
          </div>
        )}
        <OfflineBanner />
        <UpdateBanner />
      </div>
      <main className="flex-1 px-4 pb-28 pt-6">{children}</main>
      <Suspense fallback={<NavBar activePath={null} />}>
        <BottomNav />
      </Suspense>
    </div>
  );
}
