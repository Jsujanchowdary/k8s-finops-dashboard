export function formatCpu(cores: number | undefined | null): string {
  if (cores === undefined || cores === null) return "—";
  if (cores === 0) return "0";
  // Under half a millicore would round to "0m", which reads as idle; it is not.
  if (cores < 0.0005) return "<1m";
  if (cores < 1) return `${Math.round(cores * 1000)}m`;
  return `${Number.isInteger(cores) ? cores : cores.toFixed(2)}`;
}

const UNITS = ["B", "Ki", "Mi", "Gi", "Ti", "Pi"] as const;

export function formatBytes(bytes: number | undefined | null): string {
  if (bytes === undefined || bytes === null) return "—";
  if (bytes === 0) return "0";
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = value >= 100 || unit === 0 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded}${UNITS[unit]}`;
}

/** kubectl-style short age: 45s, 12m, 3h, 5d, 7mo. */
export function formatAge(from: string | Date | undefined | null, now: number = Date.now()): string {
  if (!from) return "—";
  const ms = now - new Date(from).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 60) return `${d}d`;
  return `${Math.floor(d / 30)}mo`;
}

export function formatPercent(part: number, whole: number): string {
  if (!whole) return "—";
  return `${Math.round((part / whole) * 100)}%`;
}

export function percent(part: number, whole: number): number {
  if (!whole) return 0;
  return Math.max(0, Math.min(100, (part / whole) * 100));
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "17 Nov 2026", in UTC so the server and the browser agree. */
export function formatDay(iso: string | undefined | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "—";
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** "in 34 days", "tomorrow", "today", "3 days ago". */
export function relativeDays(days: number | null): string {
  if (days === null) return "—";
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  return days > 0 ? `in ${days} days` : `${-days} days ago`;
}
