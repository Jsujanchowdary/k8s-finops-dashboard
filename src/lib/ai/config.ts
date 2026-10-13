// Assistant settings, read from the server's environment. The key never leaves the server.

import { getSetting } from "@/lib/settings/store";

export interface AiConfig {
  /** False when ENABLE_AI=false. */
  enabled: boolean;
  apiKey?: string;
  model: string;
  /** Tried in order when `model` is overloaded or unavailable. */
  fallbackModels: string[];
}

export const DEFAULT_MODEL = "gemini-3.8-flash";
// Lighter models from Google's current model list, used when the main one is busy.
export const DEFAULT_FALLBACKS = ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite"];

/** With no argument: the server's settings (the key may have been saved from the Settings page). Tests pass their own. */
export function aiConfig(given?: Record<string, string | undefined>): AiConfig {
  const env = given ?? process.env;
  const key = given ? env.GEMINI_API_KEY : getSetting("GEMINI_API_KEY");
  return {
    enabled: env.ENABLE_AI !== "false",
    apiKey: key?.trim() || undefined,
    model: env.GEMINI_MODEL?.trim() || DEFAULT_MODEL,
    // Not set: use the defaults. Set but empty: no fallback.
    fallbackModels: env.GEMINI_FALLBACK_MODELS === undefined ? DEFAULT_FALLBACKS : env.GEMINI_FALLBACK_MODELS.split(",").map((m) => m.trim()).filter(Boolean),
  };
}
