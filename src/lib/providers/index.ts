// What the dashboard can do for each cloud beyond Kubernetes itself (billing, node pools), and what is still to be
// built. Everything Kubernetes (pods, nodes, Helm, certificates, access, logs, the assistant) works on every cloud.
// docs/providers.md explains how to add the cloud-specific parts for AWS, Azure and Google Cloud.

import { PROVIDER_LABEL, type ProviderId } from "./detect";

export { detectProvider, PROVIDER_LABEL, PROVIDER_PRODUCT, type ProviderId } from "./detect";

export type FeatureState = "available" | "planned" | "none";

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  /** Spend, invoices and cost per namespace (the FinOps page). */
  finops: FeatureState;
  /** Node pool sizes and autoscaling limits. */
  nodePools: FeatureState;
  /** The read-only credentials the cloud-specific parts will need, for the planned ones. */
  credentials?: string;
  /** The cloud's read-only APIs those parts will call. */
  apis?: string;
}

export const PROVIDERS: Record<ProviderId, ProviderInfo> = {
  digitalocean: {
    id: "digitalocean",
    label: PROVIDER_LABEL.digitalocean,
    finops: "available",
    nodePools: "available",
    credentials: "A DigitalOcean API token with kubernetes:read, billing:read and sizes:read (Settings).",
    apis: "GET /v2/kubernetes/clusters/{id}, /node_pools, /v2/customers/my/*, /v2/billing/*, /v2/sizes",
  },
  aws: {
    id: "aws",
    label: PROVIDER_LABEL.aws,
    finops: "planned",
    nodePools: "planned",
    credentials: "An IAM user or role with ce:GetCostAndUsage, eks:DescribeCluster, eks:ListNodegroups and eks:DescribeNodegroup (read-only).",
    apis: "Cost Explorer GetCostAndUsage; EKS DescribeCluster, ListNodegroups, DescribeNodegroup",
  },
  azure: {
    id: "azure",
    label: PROVIDER_LABEL.azure,
    finops: "planned",
    nodePools: "planned",
    credentials: "A service principal with the Cost Management Reader and Reader roles on the cluster's subscription.",
    apis: "Microsoft.CostManagement/query; Microsoft.ContainerService/managedClusters/agentPools (GET)",
  },
  gcp: {
    id: "gcp",
    label: PROVIDER_LABEL.gcp,
    finops: "planned",
    nodePools: "planned",
    credentials: "A service account with roles/container.viewer, and BigQuery read access to the billing export.",
    apis: "GKE projects.locations.clusters.nodePools.list; BigQuery billing export (Cloud Billing has no per-cluster cost API)",
  },
  kubernetes: {
    id: "kubernetes",
    label: PROVIDER_LABEL.kubernetes,
    finops: "none",
    nodePools: "none",
  },
};

/** Why a cloud-specific page has nothing to show for this cluster, or undefined when it can. */
export function unavailableReason(provider: ProviderId | undefined, feature: "finops" | "nodePools"): string | undefined {
  const info = PROVIDERS[provider ?? "kubernetes"];
  const what = feature === "finops" ? "Billing and cost per namespace" : "Node pools and autoscaling";
  if (info[feature] === "available") return undefined;
  if (info[feature] === "planned") return `${what} are not available for ${info.label} clusters yet. Everything read from Kubernetes works. (Planned: ${info.apis}.)`;
  return `${what} come from the cloud's own API, and this cluster's cloud was not recognised, so there is nothing to read.`;
}
