// The only file that talks to Google. One POST to the Interactions API with the key in a header.
// `store: false` asks Google not to keep the conversation, and the key is scrubbed from anything that is reported back.

import { ANSWER_SCHEMA } from "./answer";

export const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com";
// Date-stamped API revision the Interactions API documentation asks callers to send.
const API_REVISION = "2026-05-20";
const DEFAULT_TIMEOUT_MS = 90_000;

export type AiErrorCode = "auth" | "model" | "quota" | "rejected" | "unavailable" | "timeout" | "network" | "empty" | "invalid";

export class AiError extends Error {
  constructor(
    readonly code: AiErrorCode,
    message: string,
    /** HTTP status to answer the browser with. */
    readonly status: number,
    /** What Google itself answered, when it answered: its HTTP status and (scrubbed) message. For the server log. */
    readonly upstream?: { status: number; message: string },
  ) {
    super(message);
    this.name = "AiError";
  }
}

export interface AskOptions {
  apiKey: string;
  model: string;
  /** Tried in order when `model` is overloaded or does not exist. */
  fallbackModels?: string[];
  system: string;
  input: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  maxOutputTokens?: number;
  /** For tests. */
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  /** Pause before the one retry after a Google-side failure. */
  retryDelayMs?: number;
}

export interface AskResult {
  text: string;
  /** The model that actually answered (a fallback when the first choice was busy). */
  model: string;
  usage?: { inputTokens?: number; outputTokens?: number };
}

const scrub = (text: string, key: string) => (key ? text.split(key).join("[key]") : text);

/** The model's text from an Interactions response. Falls back to the older generateContent shape. */
export function extractText(body: unknown): string {
  const b = (body ?? {}) as Record<string, unknown>;
  const parts: string[] = [];
  const steps = Array.isArray(b.steps) ? b.steps : [];
  for (const step of steps as Record<string, unknown>[]) {
    if (step?.type !== "model_output") continue;
    for (const item of (Array.isArray(step.content) ? step.content : []) as Record<string, unknown>[]) {
      if (typeof item?.text === "string" && (item.type === undefined || item.type === "text")) parts.push(item.text);
    }
  }
  if (parts.length) return parts.join("");
  if (typeof b.output_text === "string") return b.output_text;
  const candidates = Array.isArray(b.candidates) ? (b.candidates as Record<string, unknown>[]) : [];
  const legacy = (candidates[0]?.content as { parts?: Record<string, unknown>[] } | undefined)?.parts ?? [];
  return legacy.filter((p) => typeof p.text === "string" && !p.thought).map((p) => p.text as string).join("");
}

/** Parses the JSON the model wrote, tolerating a code fence or a sentence around it. */
export function parseJsonText(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
    throw new AiError("invalid", "The model did not return a readable answer. Try asking again.", 502);
  }
}

function usageOf(body: unknown): AskResult["usage"] {
  const u = ((body ?? {}) as { usage?: Record<string, unknown> }).usage;
  if (!u) return undefined;
  const n = (v: unknown) => (typeof v === "number" ? v : undefined);
  return { inputTokens: n(u.total_input_tokens), outputTokens: n(u.total_output_tokens) };
}

function httpError(status: number, body: unknown, key: string, model: string): AiError {
  const detail = scrub(String(((body as { error?: { message?: unknown } })?.error?.message as string | undefined) ?? "").replace(/\s+/g, " ").slice(0, 300).replace(/[.\s]+$/, ""), key);
  const upstream = { status, message: detail };
  const why = detail ? `: ${detail}` : "";
  if (status === 401 || status === 403) return new AiError("auth", `Gemini rejected the API key (HTTP ${status}${why}). Check GEMINI_API_KEY, and that the key is allowed to use the Gemini API.`, 502, upstream);
  if (status === 404) return new AiError("model", `Gemini does not know the model "${model}" (HTTP 404${why}). Set GEMINI_MODEL to a model your key can use.`, 502, upstream);
  if (status === 429) return new AiError("quota", `Gemini's rate limit or quota was reached (HTTP 429${why}). Wait a moment and ask again.`, 429, upstream);
  if (status >= 500) return new AiError("unavailable", `Gemini reported a problem on its side (HTTP ${status}${why}). Try again shortly.`, 502, upstream);
  return new AiError("rejected", `Gemini rejected the request (HTTP ${status}${why}).`, 502, upstream);
}

const RETRYABLE = new Set([500, 502, 503, 504]);
const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (ms <= 0 || signal?.aborted) return resolve();
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => (clearTimeout(timer), resolve()), { once: true });
  });

/**
 * Asks the chosen model. If Google fails on its side (a brief overload is common) it waits a moment and asks once
 * more, and if that model stays busy or is unknown it moves on to the next one in `fallbackModels`.
 * Problems with the key or the request itself are reported at once, since another model would not help.
 */
export async function askGemini(opts: AskOptions): Promise<AskResult> {
  const models = [opts.model, ...(opts.fallbackModels ?? []).filter((m) => m !== opts.model)];
  const failures: AiError[] = [];
  for (const [i, model] of models.entries()) {
    try {
      return await askModel({ ...opts, model });
    } catch (error) {
      if (!(error instanceof AiError) || !error.upstream) throw error;
      const busy = RETRYABLE.has(error.upstream.status) || error.upstream.status === 429;
      const missing = error.upstream.status === 404 && i > 0; // an unknown fallback is skipped; an unknown first choice is reported
      if (!busy && !missing) throw error;
      failures.push(error);
    }
  }
  const last = failures[failures.length - 1];
  if (failures.length === 1) throw last;
  const tried = failures.map((f, i) => `${models[i]}: HTTP ${f.upstream?.status}`).join(", ");
  throw new AiError(last.code, `Gemini is busy or unavailable right now (${tried}${last.upstream?.message ? `; ${last.upstream.message}` : ""}). Try again in a minute.`, last.status, last.upstream);
}

async function askModel(opts: AskOptions): Promise<AskResult> {
  try {
    return await askOnce(opts);
  } catch (error) {
    if (error instanceof AiError && error.upstream && RETRYABLE.has(error.upstream.status) && !opts.signal?.aborted) {
      await sleep(opts.retryDelayMs ?? 1500, opts.signal);
      return askOnce(opts);
    }
    throw error;
  }
}

async function askOnce(opts: AskOptions): Promise<AskResult> {
  const doFetch = opts.fetchImpl ?? fetch;
  const url = `${opts.baseUrl ?? GEMINI_BASE_URL}/v1beta/interactions`;
  const timeout = AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;

  let response: Response;
  try {
    response = await doFetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": opts.apiKey, "Api-Revision": API_REVISION },
      body: JSON.stringify({
        model: opts.model,
        input: opts.input,
        system_instruction: opts.system,
        generation_config: { max_output_tokens: opts.maxOutputTokens ?? 8192 },
        response_format: { type: "text", mime_type: "application/json", schema: ANSWER_SCHEMA },
        store: false,
      }),
      signal,
    });
  } catch (error) {
    if (timeout.aborted) throw new AiError("timeout", "Gemini took too long to answer. Try a narrower question.", 504);
    if (opts.signal?.aborted) throw new AiError("network", "The request was cancelled.", 499);
    throw new AiError("network", `Could not reach Gemini: ${scrub(error instanceof Error ? error.message : "network error", opts.apiKey)}.`, 502);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  if (!response.ok) throw httpError(response.status, body, opts.apiKey, opts.model);

  const text = extractText(body);
  if (!text.trim()) {
    const status = (body as { status?: unknown })?.status;
    throw new AiError("empty", `Gemini returned no answer${typeof status === "string" ? ` (status ${status})` : ""}. Try asking again.`, 502);
  }
  return { text, model: opts.model, usage: usageOf(body) };
}

export type KeyCheck = { ok: true; model: string } | { ok: false; reason: "invalid-key" | "model-not-found" | "quota" | "unreachable"; message: string };

/**
 * Tries a key before it is saved: one GET for the configured model's record. Nothing about the cluster is sent.
 * Never throws, and the key never appears in what it returns.
 */
export async function checkGeminiKey(apiKey: string, model: string, options: { baseUrl?: string; fetchImpl?: typeof fetch; timeoutMs?: number } = {}): Promise<KeyCheck> {
  const doFetch = options.fetchImpl ?? fetch;
  const url = `${options.baseUrl ?? GEMINI_BASE_URL}/v1beta/models/${encodeURIComponent(model)}`;
  let response: Response;
  try {
    response = await doFetch(url, { method: "GET", headers: { "x-goog-api-key": apiKey }, signal: AbortSignal.timeout(options.timeoutMs ?? 10_000), cache: "no-store" });
  } catch (error) {
    return { ok: false, reason: "unreachable", message: scrub(`Could not reach Google: ${error instanceof Error ? error.message : String(error)}`, apiKey) };
  }
  if (response.ok) return { ok: true, model };
  if (response.status === 404) return { ok: false, reason: "model-not-found", message: `The key works, but Google has no model “${model}”. Set GEMINI_MODEL to a model from Google's list.` };
  if (response.status === 429) return { ok: false, reason: "quota", message: "The key is valid but over its quota right now. It is saved; try the assistant again later." };
  return { ok: false, reason: "invalid-key", message: "Google rejected this key. Create one at aistudio.google.com/apikey and paste it again." };
}
