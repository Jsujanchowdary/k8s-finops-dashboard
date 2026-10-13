import "server-only";
import { KubeConfig } from "@kubernetes/client-node";
import type { ConnectionInput } from "@/lib/clusters/validate";

// The server and context that @kubernetes/client-node invents when there is no kubeconfig and the dashboard is not
// running inside a cluster. It points nowhere, so it is not offered as a cluster.
const PLACEHOLDER_CONTEXT = "loaded-context";
const PLACEHOLDER_SERVER = "http://localhost:8080";
export const IN_CLUSTER_CONTEXT = "inClusterContext";

let local: KubeConfig | null | undefined;

/**
 * This machine's kubeconfig, the one kubectl uses (KUBECONFIG or ~/.kube/config), or the pod's own ServiceAccount
 * when the dashboard runs inside a cluster. null when there is neither, or the file cannot be read.
 */
export function localKubeConfig(): KubeConfig | null {
  if (local === undefined) {
    try {
      const kc = new KubeConfig();
      kc.loadFromDefault();
      const placeholder = kc.getCurrentContext() === PLACEHOLDER_CONTEXT && kc.getCurrentCluster()?.server === PLACEHOLDER_SERVER;
      local = placeholder || kc.getContexts().length === 0 ? null : kc;
    } catch (error) {
      console.warn(`[clusters] the local kubeconfig could not be read: ${error instanceof Error ? error.message : String(error)}`);
      local = null;
    }
  }
  return local;
}

/** A copy of the local kubeconfig pointed at one of its contexts, so each context has its own clients. */
export function kubeConfigForContext(context: string): KubeConfig | undefined {
  const base = localKubeConfig();
  if (!base?.getContextObject(context)) return undefined;
  const kc = new KubeConfig();
  kc.loadFromOptions({ clusters: base.getClusters(), users: base.getUsers(), contexts: base.getContexts(), currentContext: context });
  return kc;
}

/**
 * A kubeconfig made only from credentials saved in the dashboard: a token or a client certificate, and the CA.
 * Nothing in it can read a file or run a program, and TLS is always verified.
 */
export function kubeConfigFromInput(input: ConnectionInput): KubeConfig {
  const kc = new KubeConfig();
  kc.loadFromOptions({
    clusters: [{ name: input.name, server: input.server, caData: input.caData, tlsServerName: input.tlsServerName, skipTLSVerify: false }],
    users: [input.token ? { name: "dashboard-reader", token: input.token } : { name: "dashboard-reader", certData: input.certData, keyData: input.keyData }],
    contexts: [{ name: input.name, cluster: input.name, user: "dashboard-reader" }],
    currentContext: input.name,
  });
  return kc;
}
