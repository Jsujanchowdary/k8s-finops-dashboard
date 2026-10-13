import { Badge, type Tone } from "@/components/ui/badge";

export function helmStatusTone(status: string): Tone {
  if (status === "deployed") return "success";
  if (status === "failed") return "danger";
  if (status.startsWith("pending") || status === "uninstalling") return "warning";
  return "neutral";
}

/** Helm's own release status (deployed, failed, superseded...). */
export function HelmStatusBadge({ status }: { status?: string }) {
  if (!status) return <span className="text-muted">—</span>;
  return <Badge tone={helmStatusTone(status)}>{status}</Badge>;
}
