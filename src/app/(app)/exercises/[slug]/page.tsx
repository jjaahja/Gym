import { Suspense } from "react";
import { Card, ComingSoon } from "@/components/ui";

// Mit Cache Components sind Route-Parameter Laufzeitdaten → hinter Suspense.
// Sobald der Übungskatalog existiert (Schritt 3), liefert generateStaticParams
// alle Slugs und die Seiten werden vorab statisch erzeugt.

export default function ExerciseDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  return (
    <Suspense fallback={<Card className="h-40 animate-pulse">{null}</Card>}>
      <ExerciseDetail params={params} />
    </Suspense>
  );
}

async function ExerciseDetail({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return (
    <>
      <p className="mb-1 text-sm text-muted">Übung</p>
      <h1 className="mb-5 text-2xl font-bold tracking-tight break-words">{slug}</h1>
      <ComingSoon
        step={3}
        title="Detailseite"
        items={["Ausführung als Text mit Bild/Video/GIF", "Beanspruchte Muskeln", "Wissenschaftliche Richtwerte"]}
      />
    </>
  );
}
