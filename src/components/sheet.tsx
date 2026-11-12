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
      className="m-0 mt-auto max-h-[92dvh] w-full max-w-none overflow-y-auto rounded-t-[1.25rem] bg-bg p-0 text-fg backdrop:bg-black/40 sm:mx-auto sm:max-w-xl"
    >
      {/* iOS-Sheet: Griff, zentrierter Titel, „Fertig“ */}
      <div className="sticky top-0 z-10 bg-bg/85 px-4 pb-2 pt-2 backdrop-blur-xl">
        <div aria-hidden="true" className="mx-auto mb-2 h-[5px] w-9 rounded-full bg-muted/40" />
        <div className="relative flex min-h-9 items-center justify-center">
          <h2 className="max-w-[70%] truncate text-[1.0625rem] font-semibold">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="absolute right-0 min-h-11 px-1 text-[1.0625rem] font-semibold text-accent"
            aria-label="Schließen"
          >
            Fertig
          </button>
        </div>
      </div>
      <div className="px-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-2">{children}</div>
    </dialog>
  );
}
