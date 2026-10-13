import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import { maskSecret, SECRET_KEYS, SETTING_KEYS, updateEnvText, type SettingKey } from "./env-file";

/**
 * The one place the editable settings (DigitalOcean token, Gemini key, default auto-refresh) are read and saved.
 *
 * Read: a value saved from the Settings page in this server process wins; otherwise the environment (.env.local,
 * loaded at start). The environment is looked up by a computed name on purpose: Next.js replaces literal
 * `process.env.NEXT_PUBLIC_…` reads with the value at build time, which a saved change could never update.
 *
 * Save: .env.local is rewritten (other lines kept) through a temporary file and a rename, readable by this user
 * only, and the new values take effect at once without a restart.
 */

type Overrides = Map<SettingKey, string | null>;
const globalState = globalThis as unknown as { __dashboardSettings?: Overrides };
// Kept across dev hot reloads, like the other per-process state.
const overrides: Overrides = (globalState.__dashboardSettings ??= new Map());

const envFile = () => path.join(process.cwd(), ".env.local");

export function getSetting(key: SettingKey): string | undefined {
  if (overrides.has(key)) return overrides.get(key) ?? undefined;
  const value = process.env[key as string];
  return value?.trim() || undefined;
}

export interface SettingStatus {
  key: SettingKey;
  set: boolean;
  /** For secrets, only the last characters; for other settings, the value. */
  shown?: string;
  /** Changed from the Settings page since the server started, or read from the environment. */
  source: "settings page" | "environment" | "not set";
}

export function settingsStatus(): SettingStatus[] {
  return SETTING_KEYS.map((key) => {
    const value = getSetting(key);
    return {
      key,
      set: value !== undefined,
      shown: value === undefined ? undefined : SECRET_KEYS.has(key) ? maskSecret(value) : value,
      source: value === undefined ? "not set" : overrides.has(key) ? "settings page" : "environment",
    };
  });
}

/** Writes the given settings (null removes one) to .env.local and applies them to this server at once. */
export async function saveSettings(updates: Partial<Record<SettingKey, string | null>>): Promise<void> {
  const file = envFile();
  let text = "";
  try {
    text = await fs.readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const next = updateEnvText(text, updates);
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temp, next, { mode: 0o600 });
  await fs.rename(temp, file);
  await fs.chmod(file, 0o600).catch(() => {});
  for (const [key, value] of Object.entries(updates) as [SettingKey, string | null][]) overrides.set(key, value);
}
