import { cookies } from "next/headers";
import { forgetClusterConfig, listClusters, selectedCluster } from "@/lib/clusters/registry";
import { addStoredCluster, removeStoredCluster } from "@/lib/clusters/store";
import { CLUSTER_COOKIE } from "@/lib/clusters/types";
import { parsePastedKubeconfig, validateTokenForm, type ConnectionInput } from "@/lib/clusters/validate";
import { checkConnection } from "@/lib/k8s/check";
import { forgetSource } from "@/lib/k8s";
import { kubeConfigFromInput } from "@/lib/k8s/kubeconfig";
import { isLocalRequest } from "@/lib/logs/params";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// A pasted kubeconfig is at most 64 000 characters; the rest is room for the JSON around it.
const MAX_BODY_CHARS = 80_000;
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const fail = (status: number, error: string) => json(status, { error });

async function remember(id: string | null) {
  const jar = await cookies();
  if (id) jar.set(CLUSTER_COOKIE, id, { path: "/", httpOnly: true, sameSite: "lax", maxAge: COOKIE_MAX_AGE });
  else jar.delete(CLUSTER_COOKIE);
}

/** The connection described by the request: the read-only token form, or a pasted kubeconfig. */
function connectionFrom(body: Record<string, unknown>): { ok: true; value: ConnectionInput } | { ok: false; error: string } {
  if (body.mode === "token") return validateTokenForm(body);
  if (body.mode === "kubeconfig") {
    if (typeof body.kubeconfig !== "string") return { ok: false, error: "Paste the kubeconfig's contents first." };
    return parsePastedKubeconfig(body.kubeconfig, typeof body.name === "string" ? body.name : undefined);
  }
  return { ok: false, error: "Choose how to connect: a read-only token or a kubeconfig." };
}

/** GET /api/clusters: every cluster (names and addresses only, never credentials) and which one this browser shows. */
export async function GET(request: Request) {
  if (!isLocalRequest(request.headers)) return fail(403, "Clusters can only be managed from this machine.");
  const selected = await selectedCluster();
  return json(200, { clusters: await listClusters(), selected: selected?.summary.id ?? null });
}

/**
 * POST /api/clusters
 *   { action: "select", id }                       which cluster this browser shows (a cookie with the id only)
 *   { action: "test" | "add", mode: "token", name, server, token, ca }
 *   { action: "test" | "add", mode: "kubeconfig", kubeconfig, name? }
 *   { action: "remove", id }                       a cluster added here (local kubeconfig contexts stay)
 * test and add try the connection first (read-only, one item of each kind); add saves it only if every read works.
 * Tokens, certificates and keys are never logged and never sent back.
 */
export async function POST(request: Request) {
  if (!(request.headers.get("content-type") ?? "").includes("application/json")) return fail(415, "Send JSON.");
  const raw = await request.text();
  if (raw.length > MAX_BODY_CHARS) return fail(413, "That request is too large.");
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return fail(400, "Send a JSON object.");
    body = parsed as Record<string, unknown>;
  } catch {
    return fail(400, "That was not valid JSON.");
  }
  const { action } = body;

  // Choosing among clusters already added changes nothing but this browser's cookie, so any viewer may do it.
  if (action === "select") {
    const id = typeof body.id === "string" ? body.id : "";
    if (!(await listClusters()).some((c) => c.id === id)) return fail(404, "That cluster is not known here.");
    await remember(id);
    return json(200, { ok: true, selected: id });
  }

  // Everything else reads or changes saved credentials: this machine only.
  if (!isLocalRequest(request.headers)) return fail(403, "Clusters can only be managed from this machine.");

  if (action === "remove") {
    const id = typeof body.id === "string" ? body.id : "";
    if (id.startsWith("local:")) return fail(400, "Clusters from this machine's kubeconfig are not saved here. Remove the context with kubectl instead.");
    if (!(await removeStoredCluster(id))) return fail(404, "That cluster is not saved here.");
    forgetClusterConfig(id);
    forgetSource(id);
    if ((await cookies()).get(CLUSTER_COOKIE)?.value === id) await remember(null);
    console.info(`[clusters] removed ${id}`);
    return json(200, { ok: true, clusters: await listClusters() });
  }

  if (action !== "test" && action !== "add") return fail(400, "Unknown action.");
  const input = connectionFrom(body);
  if (!input.ok) return fail(400, input.error);
  const host = new URL(input.value.server).host;

  const check = await checkConnection(kubeConfigFromInput(input.value), input.value.server);
  console.info(`[clusters] ${action} ${host} ok=${check.ok} provider=${check.provider ?? "?"} reads=${Object.entries(check.reads).map(([k, v]) => `${k}:${v}`).join(",")}`);
  if (action === "test") return json(200, { check });
  if (!check.ok) return json(400, { error: check.message ?? "The connection did not work, so it was not saved.", check });

  try {
    const saved = await addStoredCluster(input.value, check.provider ?? "kubernetes");
    await remember(saved.id);
    console.info(`[clusters] added ${saved.id} ${host} provider=${saved.provider}`);
    return json(200, { ok: true, check, id: saved.id, clusters: await listClusters() });
  } catch (error) {
    return fail(400, error instanceof Error ? error.message : "The cluster could not be saved.");
  }
}
