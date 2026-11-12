import type { Metadata } from "next";
import { PhotosContent } from "./photos-content";

export const metadata: Metadata = { title: "Fortschrittsfotos" };

export default function PhotosPage() {
  return <PhotosContent />;
}
