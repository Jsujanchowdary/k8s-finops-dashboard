import { getSetting } from "@/lib/settings/store";

/** The default auto-refresh, from the Settings page or .env.local. Each browser can still pick its own. */
export function getRefreshSeconds(): number {
  const raw = Number(getSetting("NEXT_PUBLIC_REFRESH_SECONDS") ?? "30");
  return Number.isFinite(raw) && raw >= 0 ? raw : 30;
}

/** Live pod logs are on unless ENABLE_LOGS=false. */
export function logsEnabled(): boolean {
  return process.env.ENABLE_LOGS !== "false";
}
