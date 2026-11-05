import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Gym – Muskelaufbau & Optik",
    short_name: "Gym",
    description: "Wissenschaftsbasiertes Training: planen, tracken, automatisch anpassen.",
    lang: "de",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0b0b0d",
    theme_color: "#0b0b0d",
    categories: ["health", "fitness", "sports"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
