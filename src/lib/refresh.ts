// Choices for how often the dashboard re-reads the cluster. Pure helpers so they can be tested.

export const REFRESH_PRESETS = [0, 2, 5, 10, 30, 60] as const;

const MIN_SECONDS = 2; // below this a refresh can start before the last one finished
const MAX_SECONDS = 3600;

/** Returns a valid number of seconds (0 = off, otherwise 2 to 3600), or undefined for anything else. */
export function parseRefreshSeconds(raw: string | number | null | undefined): number | undefined {
  if (raw === null || raw === undefined || raw === "") return undefined;
  if (typeof raw === "string" && !/^\d{1,4}$/.test(raw)) return undefined; // plain digits only
  const value = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isInteger(value)) return undefined;
  if (value === 0) return 0;
  return value >= MIN_SECONDS && value <= MAX_SECONDS ? value : undefined;
}

/** The presets plus any extra valid values (for example the one set in .env.local), sorted, 0 first. */
export function refreshOptions(...extra: (number | undefined)[]): number[] {
  const all = new Set<number>(REFRESH_PRESETS);
  for (const value of extra) if (value !== undefined && parseRefreshSeconds(value) !== undefined) all.add(value);
  return [...all].sort((a, b) => a - b);
}

export function refreshLabel(seconds: number): string {
  if (seconds === 0) return "Off";
  if (seconds % 60 === 0) return `${seconds / 60} min`;
  return `${seconds}s`;
}
