import type { ReactNode } from "react";
import type { Health } from "@/lib/k8s/types";

export type Tone = "success" | "warning" | "danger" | "info" | "neutral" | "accent";

const TONES: Record<Tone, string> = {
  success: "bg-success/15 text-success ring-success/30",
  warning: "bg-warning/15 text-warning ring-warning/30",
  danger: "bg-danger/15 text-danger ring-danger/30",
  info: "bg-info/15 text-info ring-info/30",
  accent: "bg-accent/15 text-accent ring-accent/30",
  neutral: "bg-surface-2 text-muted ring-border",
};

export function Badge({ tone = "neutral", children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${TONES[tone]}`}>
      {children}
    </span>
  );
}

export function healthTone(health: Health): Tone {
  return health === "healthy" ? "success" : health === "warning" ? "warning" : health === "critical" ? "danger" : "neutral";
}

export function StatusBadge({ status, health }: { status: string; health: Health }) {
  return (
    <Badge tone={healthTone(health)}>
      <HealthDot health={health} />
      {status}
    </Badge>
  );
}

const DOT: Record<Health, string> = {
  healthy: "bg-success",
  warning: "bg-warning",
  critical: "bg-danger",
  unknown: "bg-muted",
};

/**
 * `pulse` adds a slow halo (every 2 s) so a problem catches the eye; use it only for warning or critical.
 * Nothing moves for people whose system asks for reduced motion.
 */
export function HealthDot({ health, className = "", pulse = false }: { health: Health; className?: string; pulse?: boolean }) {
  if (!pulse) return <span aria-hidden className={`inline-block size-1.5 shrink-0 rounded-full ${DOT[health]} ${className}`} />;
  return (
    <span aria-hidden className={`relative inline-flex size-1.5 shrink-0 ${className}`}>
      <span className={`absolute inset-0 animate-ping rounded-full opacity-60 motion-reduce:hidden ${DOT[health]}`} style={{ animationDuration: "2s" }} />
      <span className={`relative inline-block size-full rounded-full ${DOT[health]}`} />
    </span>
  );
}
