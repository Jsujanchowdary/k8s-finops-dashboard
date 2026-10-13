import { loadCluster } from "@/lib/data";
import { aiConfig } from "@/lib/ai/config";
import { answerQuestion, validateMessages } from "@/lib/ai/chat";
import { AiError } from "@/lib/ai/gemini";
import type { SnapshotCost } from "@/lib/ai/snapshot";
import { loadFinops } from "@/lib/do/billing";
import { buildFinopsView } from "@/lib/finops/view";
import { unavailableReason } from "@/lib/providers";
import { createLimiter } from "@/lib/logs/limiter";
import { isLocalRequest } from "@/lib/logs/params";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_BODY_CHARS = 80_000;
const MAX_AT_ONCE = 2;

// One limiter per server process, kept across dev hot reloads.
const globalState = globalThis as unknown as { __chatLimiter?: ReturnType<typeof createLimiter> };
const limiter = (globalState.__chatLimiter ??= createLimiter(MAX_AT_ONCE));

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const fail = (status: number, error: string) => json(status, { error });

/**
 * POST /api/chat  { messages: [{ role: "user" | "assistant", text }] }
 * Builds a snapshot of the cluster, asks Gemini, and returns a validated, structured answer.
 * The API key stays on the server. Nothing is stored here; the conversation lives in the browser tab.
 */
export async function POST(request: Request) {
  if (!isLocalRequest(request.headers)) return fail(403, "The assistant can only be used from this machine.");
  if (!(request.headers.get("content-type") ?? "").includes("application/json")) return fail(415, "Send JSON.");

  const config = aiConfig();
  if (!config.enabled) return fail(403, "The assistant is turned off (ENABLE_AI=false).");
  if (!config.apiKey) return fail(503, "Connect a Gemini API key in Settings first.");

  const raw = await request.text();
  if (raw.length > MAX_BODY_CHARS) return fail(413, "That request is too large.");
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return fail(400, "That was not valid JSON.");
  }
  const parsed = validateMessages(body);
  if (!parsed.ok) return fail(400, parsed.error);

  const release = limiter.acquire();
  if (!release) return fail(429, "The assistant is already answering other questions. Try again in a moment.");

  const started = Date.now();
  try {
    const cluster = await loadCluster();
    if (!cluster.ok) return fail(502, `The cluster is not reachable, so there is nothing to answer from: ${cluster.error}`);
    // The FinOps page's billing figures (cached for 15 minutes, never throws), so cost questions can be answered.
    const notHere = unavailableReason(cluster.connection.provider, "finops");
    const finops = notHere ? undefined : await loadFinops(cluster.connection.server);
    const cost: SnapshotCost =
      finops?.state === "ok"
        ? { state: "ok", view: buildFinopsView(finops.data, cluster) }
        : { state: "unavailable", reason: notHere ?? (finops?.state === "no-token" ? "no DigitalOcean API token is configured (DIGITALOCEAN_TOKEN)." : "this is not a DigitalOcean Kubernetes cluster.") };
    const { answer, meta } = await answerQuestion(cluster, parsed.turns, parsed.question, config, { signal: request.signal, cost });
    // Sizes and timing only. The question and the answer are never written to the log.
    console.info(`[ai] answered turns=${parsed.turns.length + 1} question=${parsed.question.length} snapshot=${meta.snapshotChars} model=${meta.model} tokens=${meta.inputTokens ?? "?"}/${meta.outputTokens ?? "?"} ${Date.now() - started}ms`);
    return json(200, { answer, meta });
  } catch (error) {
    if (error instanceof AiError) {
      // What Google said (never the question, the snapshot or the key) so a failure can be diagnosed from this log.
      console.warn(`[ai] failed code=${error.code}${error.upstream ? ` google=${error.upstream.status} "${error.upstream.message}"` : ""} ${Date.now() - started}ms`);
      return fail(error.status, error.message);
    }
    console.error("[ai] unexpected error", error instanceof Error ? error.message : error);
    return fail(500, "Something went wrong while answering. Check the dev server log.");
  } finally {
    release();
  }
}
