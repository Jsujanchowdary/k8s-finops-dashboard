import type { ReactNode } from "react";

export function TableWrap({ children }: { children: ReactNode }) {
  return <div className="overflow-x-auto">{children}</div>;
}

/** `fixed` gives every column the width its <col> asks for, so separate tables line up with each other. */
export function Table({ children, fixed = false }: { children: ReactNode; fixed?: boolean }) {
  return <table className={`w-full border-collapse text-left text-sm ${fixed ? "min-w-[46rem] table-fixed" : ""}`}>{children}</table>;
}

export function Th({ children, className = "" }: { children?: ReactNode; className?: string }) {
  return <th scope="col" className={`whitespace-nowrap border-b border-border px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted ${className}`}>{children}</th>;
}

/** Cells stay on one line by default. Pass `wrap` for long free text such as messages, which then wraps inside the column. */
export function Td({ children, className = "", mono = false, wrap = false }: { children?: ReactNode; className?: string; mono?: boolean; wrap?: boolean }) {
  const lines = wrap ? "min-w-64 whitespace-normal break-words" : "whitespace-nowrap";
  return <td className={`${lines} border-b border-border/60 px-3 py-2 align-middle ${mono ? "font-mono text-xs" : ""} ${className}`}>{children}</td>;
}
