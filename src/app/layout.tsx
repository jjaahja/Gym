import type { Metadata, Viewport } from "next";
import { Providers } from "@/components/providers";
import "./globals.css";

export const metadata: Metadata = {
  applicationName: "Gym",
  title: { default: "Gym", template: "%s · Gym" },
  description: "Wissenschaftsbasiertes Training für Muskelaufbau und Optik – planen, tracken, anpassen.",
  appleWebApp: { capable: true, title: "Gym", statusBarStyle: "black-translucent" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f5f6" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0b0d" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de" className="h-full antialiased">
      <body className="min-h-full">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
