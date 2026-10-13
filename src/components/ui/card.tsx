import type { ReactNode } from "react";
import { Meter } from "./meter";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-xl border border-border bg-surface ${className}`}>{children}</section>;
}

export function CardHeader({ title, subtitle, action }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <header className="flex items-start justify-between gap-4 border-b border-border px-4 py-3">
      <div className="min-w-0">
        <h2 className="truncate text-sm font-semibold">{title}</h2>
        {subtitle ? <p className="mt-0.5 text-xs text-muted">{subtitle}</p> : null}
      </div>
      {action}
    </header>
  );
}

export function CardBody({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`p-4 ${className}`}>{children}</div>;
}

/**
 * One KPI tile. Every tile has the same structure (label, value, optional meter, hint pinned to the
 * bottom) so a row of them lines up whatever the content.
 */
export function StatCard({
  label,
  value,
  hint,
  tone,
  meter,
  info,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "danger" | "warning" | "success";
  meter?: { value: number; max: number };
  /** Shown next to the label, e.g. a "how is this calculated?" button. */
  info?: ReactNode;
}) {
  const color = tone === "danger" ? "text-danger" : tone === "warning" ? "text-warning" : tone === "success" ? "text-success" : "";
  return (
    <Card className="flex min-h-32 flex-col px-4 py-3.5">
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-[11px] font-medium uppercase tracking-wider text-muted" title={label}>{label}</p>
        {info}
      </div>
      <p className={`mt-2 text-2xl font-semibold leading-none tabular-nums ${color}`}>{value}</p>
      {meter ? (
        <div className="mt-3">
          <Meter usage={meter.value} max={meter.max} height="h-1.5" label={label} />
        </div>
      ) : null}
      <p className="mt-auto pt-3 text-xs text-muted">{hint ?? "\u00A0"}</p>
    </Card>
  );
}
