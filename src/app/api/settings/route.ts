import { aiConfig } from "@/lib/ai/config";
import { checkGeminiKey } from "@/lib/ai/gemini";
import { checkDigitalOceanToken, forgetFinops } from "@/lib/do/billing";
import { forgetNodePools } from "@/lib/do/node-pools";
import { selectedCluster } from "@/lib/clusters/registry";
import { isLocalRequest } from "@/lib/logs/params";
import { isSettingKey, validateSetting, type SettingKey } from "@/lib/settings/env-file";
import { getSetting, saveSettings, settingsStatus } from "@/lib/settings/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY_CHARS = 2_000;

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const fail = (status: number, error: string) => json(status, { error });

/**
 * The API server the DigitalOcean token is checked against: the selected cluster when it runs on DigitalOcean,
 * otherwise the first DigitalOcean cluster the dashboard knows.
 */
async function clusterServer(): Promise<string> {
  try {
    const selected = await selectedCluster();
    if (!selected) return "";
    if (selected.summary.provider === "digitalocean") return selected.summary.server;
    return selected.all.find((c) => c.provider === "digitalocean")?.server ?? selected.summary.server;
  } catch {
    return "";
  }
}

/** GET /api/settings: what is set (secrets masked to their last characters). */
export async function GET(request: Request) {
  if (!isLocalRequest(request.headers)) return fail(403, "Settings can only be read from this machine.");
  return json(200, { settings: settingsStatus() });
}

/**
 * POST /api/settings  { action: "connect", key, value } | { action: "test", key } | { action: "remove", key }
 * connect: checks the value, then saves it to .env.local and applies it at once (a token or key that DigitalOcean or
 * Google refuses is not saved). test: checks what is saved now. remove: deletes the setting.
 * Values are never logged and secrets are never sent back.
 */
export async function POST(request: Request) {
  if (!isLocalRequest(request.headers)) return fail(403, "Settings can only be changed from this machine.");
  if (!(request.headers.get("content-type") ?? "").includes("application/json")) return fail(415, "Send JSON.");
  const raw = await request.text();
  if (raw.length > MAX_BODY_CHARS) return fail(413, "That request is too large.");
  let body: { action?: unknown; key?: unknown; value?: unknown };
  try {
    body = JSON.parse(raw);
  } catch {
    return fail(400, "That was not valid JSON.");
  }
  const { action, key } = body;
  if (!isSettingKey(key)) return fail(400, "Unknown setting.");
  if (action !== "connect" && action !== "test" && action !== "remove") return fail(400, "Unknown action.");

  const done = async (extra: Record<string, unknown> = {}) => json(200, { ok: true, settings: settingsStatus(), ...extra });
  const forgetCaches = (k: SettingKey) => {
    if (k === "DIGITALOCEAN_TOKEN") {
      forgetFinops();
      forgetNodePools();
    }
  };

  if (action === "remove") {
    await saveSettings({ [key]: null });
    forgetCaches(key);
    console.info(`[settings] removed ${key}`);
    return done();
  }

  // The value to check: the new one (connect) or the saved one (test).
  let value: string;
  if (action === "connect") {
    if (typeof body.value !== "string") return fail(400, "Send the value to save.");
    const valid = validateSetting(key, body.value);
    if (!valid.ok) return fail(400, valid.error);
    value = valid.value;
  } else {
    const saved = getSetting(key);
    if (!saved) return fail(400, "Nothing is saved for this yet.");
    value = saved;
  }

  if (key === "DIGITALOCEAN_TOKEN") {
    const check = await checkDigitalOceanToken(value, await clusterServer());
    if (!check.valid) return json(400, { error: check.message, check });
    if (action === "connect") {
      await saveSettings({ [key]: value });
      forgetCaches(key);
      console.info(`[settings] saved ${key} kubernetes=${check.scopes.kubernetes} billing=${check.scopes.billing} sizes=${check.scopes.sizes}`);
    }
    return done({ check });
  }

  if (key === "GEMINI_API_KEY") {
    const model = aiConfig().model;
    const check = await checkGeminiKey(value, model);
    // A key Google refuses, or one that could not be checked at all, is not saved.
    if (!check.ok && (check.reason === "invalid-key" || check.reason === "unreachable")) return json(400, { error: check.message, check });
    if (action === "connect") {
      await saveSettings({ [key]: value });
      console.info(`[settings] saved ${key} ${check.ok ? "ok" : check.reason}`);
    }
    return done({ check });
  }

  // Default auto-refresh: nothing to check beyond the value itself.
  if (action === "connect") {
    await saveSettings({ [key]: value });
    console.info(`[settings] saved ${key}`);
  }
  return done();
}
