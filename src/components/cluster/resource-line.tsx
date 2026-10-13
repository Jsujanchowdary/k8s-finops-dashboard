import { Meter } from "@/components/ui/meter";
import { formatBytes, formatCpu } from "@/lib/format";

export function fmt(kind: "cpu" | "memory", value: number | null | undefined): string {
  return kind === "cpu" ? formatCpu(value) : formatBytes(value);
}

/** A labelled meter: usage as the bar, request as a lighter marker, ceiling as `max`. */
export function ResourceLine({
  label,
  kind,
  usage,
  request,
  limit,
  max,
  maxLabel,
  colorize = true,
  bar = true,
}: {
  label: string;
  kind: "cpu" | "memory";
  usage: number | null;
  request: number;
  limit?: number;
  max: number;
  maxLabel?: string;
  colorize?: boolean;
  /** Hide the bar when there is nothing to compare usage with. */
  bar?: boolean;
}) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
        <span className="font-medium">{label}</span>
        <span className="tabular-nums text-muted">{usage === null ? "usage n/a" : `${fmt(kind, usage)} used`}</span>
      </div>
      {bar ? <Meter usage={usage} request={request} max={max} colorize={colorize} label={`${label} usage`} /> : null}
      <p className="mt-1 flex flex-wrap gap-x-3 text-[11px] tabular-nums text-muted">
        <span>{request ? `${fmt(kind, request)} requested` : "no request"}</span>
        <span>{limit ? `${fmt(kind, limit)} limit` : "no limit"}</span>
        {maxLabel ? <span>{maxLabel}</span> : null}
      </p>
    </div>
  );
}
