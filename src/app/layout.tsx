import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { Providers } from "@/components/providers";
import "./globals.css";

// Android & Co. (auf Apple-Geräten gilt die Systemschrift SF Pro)
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

// Akzentthema und Erscheinungsbild vor dem ersten Zeichnen setzen (kein Aufblitzen der Standardfarbe)
const THEME_SCRIPT = `try{var s=(JSON.parse(localStorage.getItem("gym-settings")||"{}").state)||{};var d=document.documentElement;if(s.accent)d.dataset.accent=s.accent;if(s.appearance&&s.appearance!=="system")d.dataset.theme=s.appearance}catch(e){}`;

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
    { media: "(prefers-color-scheme: light)", color: "#f2f2f7" },
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de" className={`h-full antialiased ${inter.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-full">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
