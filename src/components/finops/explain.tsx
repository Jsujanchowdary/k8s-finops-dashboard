"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Info, X } from "lucide-react";

/**
 * A small ⓘ button that opens "how is this calculated?" with the formula and the real numbers behind a figure.
 * Closes on a click outside, on Esc, or with its own button. The content is rendered by the server.
 */
export function Explain({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  // Opens toward whichever side has room, so a card in the right-hand column never pushes it off screen.
  const [side, setSide] = useState<"left" | "right">("left");
  const box = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span ref={box} className="relative inline-flex">
      <button
        ref={button}
        type="button"
        onClick={() => {
          if (!open && button.current) {
            const r = button.current.getBoundingClientRect();
            const width = Math.min(416, window.innerWidth - 32);
            setSide(r.left + width > window.innerWidth - 16 ? "right" : "left");
          }
          setOpen((o) => !o);
        }}
        aria-expanded={open}
        aria-controls={id}
        aria-label={`How is ${title} calculated?`}
        title="How is this calculated?"
        className={`grid size-5 place-items-center rounded-full transition-colors ${open ? "bg-accent/15 text-accent" : "text-muted hover:bg-surface-2 hover:text-text"}`}
      >
        <Info className="size-3.5" />
      </button>
      {open ? (
        <span
          id={id}
          role="dialog"
          aria-label={`How ${title} is calculated`}
          className={`absolute top-7 z-30 block w-[min(26rem,calc(100vw-2rem))] rounded-xl border border-border bg-surface p-3.5 text-left text-xs font-normal normal-case tracking-normal text-text shadow-xl ${side === "right" ? "right-0" : "left-0"}`}
        >
          <span className="mb-2 flex items-start justify-between gap-3">
            <span className="text-sm font-semibold">{title}</span>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="grid size-5 place-items-center rounded text-muted hover:text-text">
              <X className="size-3.5" />
            </button>
          </span>
          <span className="block space-y-2 leading-relaxed text-muted">{children}</span>
        </span>
      ) : null}
    </span>
  );
}

/** One step of a calculation: "label ……… value". */
export function Step({ label, value, strong = false }: { label: ReactNode; value: ReactNode; strong?: boolean }) {
  return (
    <span className={`flex items-baseline justify-between gap-3 ${strong ? "border-t border-border pt-1.5 font-medium text-text" : ""}`}>
      <span className="min-w-0">{label}</span>
      <span className="shrink-0 font-mono tabular-nums text-text">{value}</span>
    </span>
  );
}

/** A formula line in code font. */
export function Formula({ children }: { children: ReactNode }) {
  return <span className="block rounded-md bg-surface-2 px-2 py-1.5 font-mono text-[11px] text-text">{children}</span>;
}
