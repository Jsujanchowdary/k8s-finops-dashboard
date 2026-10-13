// The settings the dashboard can change from its Settings page, how each is validated, and how .env.local is
// rewritten to hold them. Pure: no file access here, so every rule is tested directly.

import { parseRefreshSeconds } from "@/lib/refresh";

export const SETTING_KEYS = ["DIGITALOCEAN_TOKEN", "GEMINI_API_KEY", "NEXT_PUBLIC_REFRESH_SECONDS"] as const;
export type SettingKey = (typeof SETTING_KEYS)[number];

export const SECRET_KEYS: ReadonlySet<SettingKey> = new Set(["DIGITALOCEAN_TOKEN", "GEMINI_API_KEY"]);

export function isSettingKey(key: unknown): key is SettingKey {
  return typeof key === "string" && (SETTING_KEYS as readonly string[]).includes(key);
}

// API keys are letters, digits, "_" and "-". Anything else (spaces, quotes, "=", line breaks) is refused, so a value can
// never break out of its line in .env.local or add another setting.
const API_KEY = /^[A-Za-z0-9_-]{20,256}$/;

export function validateSetting(key: SettingKey, raw: string): { ok: true; value: string } | { ok: false; error: string } {
  const value = raw.trim();
  if (key === "NEXT_PUBLIC_REFRESH_SECONDS") {
    const seconds = parseRefreshSeconds(value);
    return seconds === undefined ? { ok: false, error: "Auto-refresh must be 0 (off) or a whole number of seconds from 2 to 3600." } : { ok: true, value: String(seconds) };
  }
  if (!value) return { ok: false, error: "Paste a value first." };
  if (!API_KEY.test(value)) return { ok: false, error: "That does not look like an API key: use only letters, digits, “_” and “-”, at least 20 characters, with no spaces or quotes." };
  if (key === "DIGITALOCEAN_TOKEN" && !/^do[opr]_v1_/.test(value)) return { ok: false, error: "DigitalOcean personal access tokens start with “dop_v1_”." };
  return { ok: true, value };
}

/** "…a3f2": enough to recognise a key, never enough to use it. */
export function maskSecret(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value.length <= 8 ? "…" : `…${value.slice(-4)}`;
}

const lineFor = (key: string) => new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=`);

/**
 * Sets (string) or removes (null) settings in the text of a .env file, keeping everything else (comments, other
 * settings, blank lines) as it was. A setting already present is changed in place; a duplicate is dropped; a new one
 * is added at the end. Commented-out lines ("# KEY=") are left alone.
 */
export function updateEnvText(text: string, updates: Partial<Record<SettingKey, string | null>>): string {
  const lines = text === "" ? [] : text.replace(/\r\n/g, "\n").split("\n");
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  for (const [key, value] of Object.entries(updates) as [SettingKey, string | null][]) {
    if (value !== null && /[\r\n]/.test(value)) throw new Error(`Refusing a line break in ${key}.`);
    const match = lineFor(key);
    let placed = false;
    for (let i = 0; i < lines.length; i += 1) {
      if (!match.test(lines[i])) continue;
      if (value !== null && !placed) {
        lines[i] = `${key}=${value}`;
        placed = true;
      } else {
        lines.splice(i, 1);
        i -= 1;
      }
    }
    if (value !== null && !placed) lines.push(`${key}=${value}`);
  }
  return lines.length ? `${lines.join("\n")}\n` : "";
}
