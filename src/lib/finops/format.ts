// Money as DigitalOcean bills it: US dollars.

const dollars = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "$1,234.56". Rounds to cents; tiny non-zero amounts show as "<$0.01" so they are not mistaken for free. */
export function usd(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  if (value !== 0 && Math.abs(value) < 0.005) return value < 0 ? "−<$0.01" : "<$0.01";
  return dollars.format(value);
}

/** Hourly rates are small, so they keep four decimals: "$0.1429". */
export function usdRate(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  if (value !== 0 && Math.abs(value) < 0.00005) return "<$0.0001";
  return `$${value.toFixed(4)}`;
}

/** Axis ticks: "$0", "$50", "$1.2K". */
export function usdShort(value: number): string {
  if (Math.abs(value) >= 1000) return `$${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)}K`;
  return `$${Number.isInteger(value) ? value : value.toFixed(value < 10 ? 2 : 0)}`;
}

/** "+12%" / "−8%". */
export function signedPercent(part: number, whole: number): string {
  if (!whole) return "—";
  const p = Math.round(((part - whole) / whole) * 100);
  return `${p > 0 ? "+" : p < 0 ? "−" : ""}${Math.abs(p)}%`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "2026-09" -> "Sep 2026" (or "September 2026"). */
export function periodLabel(period: string, long = false): string {
  const [y, m] = period.split("-").map(Number);
  return `${(long ? MONTHS_LONG : MONTHS)[m - 1] ?? "?"} ${y}`;
}

/** "2026-10-07" or an ISO time -> "7 Oct". */
export function dayLabel(dateOrIso: string): string {
  const d = new Date(dateOrIso.length === 10 ? `${dateOrIso}T00:00:00Z` : dateOrIso);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** "13 Oct, 04:10 UTC". */
export function utcTime(iso: string | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "—";
  return `${dayLabel(iso)}, ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")} UTC`;
}

/** Round axis maximum and step: 0, 50, 100, 150 rather than 0, 47, 94, 141. */
export function niceTicks(max: number, count = 4): number[] {
  if (!(max > 0)) return [0, 1];
  const raw = max / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ?? 10 * magnitude;
  const ticks: number[] = [];
  for (let v = 0; v < max + step * 0.999; v += step) ticks.push(Number(v.toFixed(10)));
  return ticks;
}
