import { EVIDENCE_LABELS, formatGuidelineMessage, type Guideline } from "@/lib/science";

// Wissenschaftlich fundierte Hinweise direkt im Kontext (Planerstellung, Tracker).

export function ScienceHint({ guideline, children }: { guideline?: Guideline; children?: React.ReactNode }) {
  return (
    <aside className="rounded-xl bg-accent-soft px-4 py-3 text-sm">
      <p className="flex items-center justify-between gap-2 text-xs font-semibold uppercase tracking-wide text-accent">
        <span>Wissenschaft</span>
        {guideline && <span className="font-medium normal-case tracking-normal text-muted">{EVIDENCE_LABELS[guideline.evidenceGrade]}</span>}
      </p>
      {guideline && <p className="mt-1 font-semibold">{formatGuidelineMessage(guideline)}</p>}
      {guideline && <p className="mt-1 text-muted">{guideline.rationale}</p>}
      {children && <div className="mt-1 text-muted">{children}</div>}
      {guideline && guideline.sources.length > 0 && (
        <p className="mt-2 text-xs text-muted">
          Quellen:{" "}
          {guideline.sources.map((s, i) => (
            <span key={s.key}>
              {i > 0 && ", "}
              {s.doi ? (
                <a className="underline" href={`https://doi.org/${s.doi}`} target="_blank" rel="noreferrer">
                  {s.citation}
                </a>
              ) : (
                s.citation
              )}
            </span>
          ))}
        </p>
      )}
    </aside>
  );
}
