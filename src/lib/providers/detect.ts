// Which cloud runs a cluster, from what any Kubernetes cluster exposes: its API server's address and its nodes'
// provider IDs. Pure, so it is tested for every cloud even where no test account exists.

export type ProviderId = "digitalocean" | "aws" | "azure" | "gcp" | "kubernetes";

export const PROVIDER_LABEL: Record<ProviderId, string> = {
  digitalocean: "DigitalOcean",
  aws: "AWS",
  azure: "Azure",
  gcp: "Google Cloud",
  kubernetes: "Kubernetes",
};

/** The managed Kubernetes product's name, for messages ("an EKS cluster"). */
export const PROVIDER_PRODUCT: Record<ProviderId, string> = {
  digitalocean: "DOKS",
  aws: "EKS",
  azure: "AKS",
  gcp: "GKE",
  kubernetes: "Kubernetes",
};

// Node .spec.providerID prefixes set by each cloud's controller.
const BY_PROVIDER_ID: [RegExp, ProviderId][] = [
  [/^digitalocean:\/\//, "digitalocean"],
  [/^aws:\/\//, "aws"],
  [/^azure:\/\//, "azure"],
  [/^gce:\/\//, "gcp"],
];

// API server host names of the managed services. GKE serves its API on a bare IP, so it is found through nodes.
const BY_HOST: [RegExp, ProviderId][] = [
  [/\.k8s\.ondigitalocean\.com$/i, "digitalocean"],
  [/\.eks\.amazonaws\.com(\.cn)?$/i, "aws"],
  [/\.azmk8s\.io$/i, "azure"],
  [/\.(gke\.goog|container\.googleapis\.com)$/i, "gcp"],
];

/** Nodes are the strongest signal (they say who runs the machines); the API host is the fallback. */
export function detectProvider(input: { server: string; providerIds: (string | undefined)[] }): ProviderId {
  for (const id of input.providerIds) {
    if (!id) continue;
    const hit = BY_PROVIDER_ID.find(([re]) => re.test(id));
    if (hit) return hit[1];
  }
  let host = "";
  try {
    host = new URL(input.server).hostname;
  } catch {
    host = "";
  }
  return BY_HOST.find(([re]) => re.test(host))?.[1] ?? "kubernetes";
}
