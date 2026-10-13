import "server-only";
import { CoreV1Api, VersionApi, type KubeConfig } from "@kubernetes/client-node";
import { describeConnectionError, statusOf } from "@/lib/clusters/errors";
import type { CheckState, ConnectionCheck } from "@/lib/clusters/types";
import { detectProvider } from "@/lib/providers/detect";
import { readOnlyClient, withTimeout } from "./readonly";

const TIMEOUT_MS = 10_000;

/**
 * Tries a connection before it is saved: the API server's version, then one item each of namespaces, nodes and pods
 * (the reads every page needs). Read-only, small, never throws.
 */
export async function checkConnection(kc: KubeConfig, server: string): Promise<ConnectionCheck> {
  const version = readOnlyClient(kc.makeApiClient(VersionApi));
  const core = readOnlyClient(kc.makeApiClient(CoreV1Api));
  const skipped = { namespaces: "skipped", nodes: "skipped", pods: "skipped" } as const;

  let gitVersion: string | undefined;
  try {
    gitVersion = (await withTimeout(version.getCode(), TIMEOUT_MS, "version")).gitVersion;
  } catch (error) {
    // /version is open to anyone on most clusters, so a failure here is about reaching the server or trusting it.
    return { ok: false, message: describeConnectionError(error), reads: { ...skipped } };
  }

  let firstError: unknown;
  const attempt = async <T>(label: string, fn: () => Promise<T>): Promise<{ state: CheckState; value?: T }> => {
    try {
      return { state: "ok", value: await withTimeout(fn(), TIMEOUT_MS, label) };
    } catch (error) {
      firstError ??= error;
      return { state: statusOf(error) === 403 ? "forbidden" : "error" };
    }
  };
  const [namespaces, nodes, pods] = await Promise.all([
    attempt("namespaces", () => core.listNamespace({ limit: 1 })),
    attempt("nodes", () => core.listNode({ limit: 1 })),
    attempt("pods", () => core.listPodForAllNamespaces({ limit: 1 })),
  ]);
  const reads = { namespaces: namespaces.state, nodes: nodes.state, pods: pods.state };
  const provider = detectProvider({ server, providerIds: (nodes.value?.items ?? []).map((n) => n.spec?.providerID) });
  const ok = Object.values(reads).every((s) => s === "ok");
  if (ok) return { ok, version: gitVersion, provider, reads };

  const missing = (Object.keys(reads) as (keyof typeof reads)[]).filter((k) => reads[k] === "forbidden");
  const message = missing.length
    ? `Connected, but these credentials may not list ${missing.join(", ")}. Apply deploy/read-only-rbac.yaml and use that ServiceAccount's token.`
    : describeConnectionError(firstError);
  return { ok, message, version: gitVersion, provider, reads };
}
