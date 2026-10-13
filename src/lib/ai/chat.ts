// One question, start to finish: check the request, build the snapshot, ask Gemini, validate the answer.

import type { LoadedCluster } from "@/lib/data";
import { type Answer, normalizeAnswer } from "./answer";
import { AiError, askGemini, parseJsonText } from "./gemini";
import { buildInput, SYSTEM_PROMPT, type Turn } from "./prompt";
import type { AiConfig } from "./config";
import { buildSnapshot, type SnapshotCost } from "./snapshot";

const MAX_MESSAGES = 16;
const MAX_MESSAGE_CHARS = 4000;

export function validateMessages(body: unknown): { ok: true; turns: Turn[]; question: string } | { ok: false; error: string } {
  const messages = (body as { messages?: unknown })?.messages;
  if (!Array.isArray(messages) || messages.length === 0) return { ok: false, error: "Send at least one message." };
  if (messages.length > MAX_MESSAGES) return { ok: false, error: "This conversation is too long. Start a new chat." };
  const turns: Turn[] = [];
  for (const m of messages as Record<string, unknown>[]) {
    if ((m?.role !== "user" && m?.role !== "assistant") || typeof m.text !== "string") return { ok: false, error: "Each message needs a role and text." };
    if (m.text.length > MAX_MESSAGE_CHARS) return { ok: false, error: `A message is longer than ${MAX_MESSAGE_CHARS} characters.` };
    turns.push({ role: m.role, text: m.text });
  }
  const last = turns[turns.length - 1];
  if (last.role !== "user" || !last.text.trim()) return { ok: false, error: "The last message must be a question." };
  return { ok: true, turns: turns.slice(0, -1), question: last.text.trim() };
}

export interface ChatMeta {
  /** The model that answered. */
  model: string;
  /** Set when the model asked for was busy and another one answered instead. */
  fellBackFrom?: string;
  snapshotAt: string;
  counts: ReturnType<typeof buildSnapshot>["counts"];
  inputTokens?: number;
  outputTokens?: number;
  unverifiedReferences: number;
  snapshotChars: number;
}

export interface ChatDeps {
  /** Billing figures for the snapshot (the FinOps page's), or why there are none. Left out: no cost section. */
  cost?: SnapshotCost;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  signal?: AbortSignal;
  now?: number;
  retryDelayMs?: number;
}

export async function answerQuestion(cluster: LoadedCluster, turns: Turn[], question: string, config: AiConfig, deps: ChatDeps = {}): Promise<{ answer: Answer; meta: ChatMeta }> {
  if (!config.apiKey) throw new AiError("auth", "GEMINI_API_KEY is not set.", 503);
  const snapshot = buildSnapshot(cluster, deps.now, deps.cost);
  const result = await askGemini({
    apiKey: config.apiKey,
    model: config.model,
    fallbackModels: config.fallbackModels,
    system: SYSTEM_PROMPT,
    input: buildInput(snapshot.text, turns, question),
    signal: deps.signal,
    fetchImpl: deps.fetchImpl,
    baseUrl: deps.baseUrl,
    retryDelayMs: deps.retryDelayMs,
  });
  const normalized = normalizeAnswer(parseJsonText(result.text), snapshot.index);
  if (!normalized) throw new AiError("invalid", "The model's answer was empty or in the wrong shape. Try asking again.", 502);
  return {
    answer: normalized.answer,
    meta: {
      model: result.model,
      fellBackFrom: result.model !== config.model ? config.model : undefined,
      snapshotAt: snapshot.generatedAt,
      counts: snapshot.counts,
      inputTokens: result.usage?.inputTokens,
      outputTokens: result.usage?.outputTokens,
      unverifiedReferences: normalized.droppedReferences,
      snapshotChars: snapshot.text.length,
    },
  };
}
