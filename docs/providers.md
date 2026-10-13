# Clouds (providers)

Everything read from Kubernetes (overview, namespaces, pods, nodes, Helm, certificates, access, logs, the assistant)
works on any cluster. Only two features need a cloud's own API: **FinOps** (billing, cost per namespace) and
**node pools** (pool sizes and autoscaling limits). They exist for DigitalOcean today; AWS, Azure and Google Cloud are
planned, and this page is for whoever adds them.

## Connecting a cluster (any cloud)

1. `kubectl apply -f deploy/read-only-rbac.yaml` on the cluster (with your own admin kubeconfig).
2. Run the three commands in that file's header to print the API server, the token and the CA.
3. Settings → Clusters → *Read-only token*, paste them, *Test*, then *Add cluster*.

Why not the cloud's kubeconfig? `aws eks update-kubeconfig`, `az aks get-credentials` (with kubelogin),
`gcloud container clusters get-credentials` and `doctl kubernetes cluster kubeconfig save` all write a kubeconfig that
runs a program (`aws`, `kubelogin`, `gke-gcloud-auth-plugin`, `doctl`) with *your* login to get a short-lived token.
A server has neither the program nor your login, so the dashboard refuses those kubeconfigs with a message naming the
cloud (`src/lib/clusters/validate.ts`, `execMessage`). A ServiceAccount token is a plain bearer token and works on every
cloud. Notes per cloud:

| Cloud | API server looks like | Notes |
|---|---|---|
| DigitalOcean (DOKS) | `https://<id>.k8s.ondigitalocean.com` | Nothing special. |
| AWS (EKS) | `https://<id>.gr7.<region>.eks.amazonaws.com` | ServiceAccount tokens work without touching `aws-auth` or access entries. A private-only endpoint is reachable only from inside the VPC. |
| Azure (AKS) | `https://<name>-<hash>.hcp.<region>.azmk8s.io:443` | With "local accounts disabled" (Entra ID only), ServiceAccount tokens still work for in-cluster RBAC. |
| Google (GKE) | `https://<public IP>` | The API server is a bare IP, so the cloud is detected from the nodes (`gce://`). Authorised networks must include the dashboard's address. |

## How the cloud is detected

`src/lib/providers/detect.ts`, pure and tested: node `spec.providerID` prefixes first (`digitalocean://`, `aws://`,
`azure://`, `gce://`), then the API server's host name. Anything else is plain `kubernetes`.

## Adding FinOps or node pools for a cloud

`src/lib/providers/index.ts` lists, per cloud, whether each feature is `available`, `planned` or `none`, with the
read-only credentials and APIs it will need. The FinOps page, the node pools card and the assistant ask
`unavailableReason(provider, feature)` and show its message when the feature is not available.

To add one (AWS as the example):

1. **Credentials.** Add the setting(s) to `src/lib/settings/env-file.ts` (`SETTING_KEYS`, validation) and a card in
   `components/settings/settings-form.tsx` with a *Connect* that tries the credentials before saving, like
   `checkDigitalOceanToken`. Read-only permissions only:
   - AWS: `ce:GetCostAndUsage`, `eks:DescribeCluster`, `eks:ListNodegroups`, `eks:DescribeNodegroup`.
   - Azure: *Cost Management Reader* and *Reader* on the subscription.
   - Google: `roles/container.viewer`; costs come from the BigQuery billing export (there is no per-cluster cost API).
2. **Client.** One file under `src/lib/<cloud>/` (like `src/lib/do/billing.ts`) that makes GET (or the cloud's
   read-only query) requests only, with a cache, and never throws (it returns a state such as `no-token`).
3. **Mapping.** Turn the cloud's answer into the shapes the pages already use: `NodePoolsResult`
   (`src/lib/do/node-pools-core.ts`) for node pools, and the FinOps view (`src/lib/finops/view.ts`) for costs.
   Per-namespace allocation (`src/lib/finops/allocation.ts`) only needs node prices and the cluster's pods, so it can
   be reused once a cloud gives a price per node.
4. **Switch it on.** Set the feature to `available` in `PROVIDERS`, and pick the loader by provider where
   `loadNodePools` / `loadFinops` are called (`src/lib/data.ts`, `src/app/finops/page.tsx`, `src/app/api/chat/route.ts`).
5. **Guard tests.** Extend `src/lib/k8s/guard.test.ts` so the new credentials are used in one file and only read
   requests are made, as it does for DigitalOcean.

Test without an account the way the DigitalOcean code is tested: sample API answers in `src/test/` and a fake `fetch`.
