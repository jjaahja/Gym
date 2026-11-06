"use client";

import { useEffect, useRef } from "react";

// Bottom-Sheet für mobile Dialoge (natives <dialog>: Fokusfalle und Escape inklusive).

export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      aria-label={title}
      className="m-0 mt-auto max-h-[90dvh] w-full max-w-none overflow-y-auto rounded-t-3xl border-t border-border bg-surface p-0 text-fg backdrop:bg-black/60 sm:mx-auto sm:max-w-xl"
    >
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-surface px-4 py-3">
        <h2 className="text-lg font-semibold">{title}</h2>
        <button type="button" onClick={onClose} className="min-h-11 min-w-11 rounded-full text-2xl text-muted" aria-label="Schließen">
          ×
        </button>
      </div>
      <div className="px-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-4">{children}</div>
    </dialog>
  );
}
