// DigitalOcean billing answers shaped exactly like the real API's, for the FinOps tests.
// Amounts follow a real month: a Droplet outside the cluster with daily backups, and a DOKS node pool that was resized
// from an 8 GB to a 16 GB node on the 7th. The invoice was last generated at 2026-10-13T00:00Z.

export const NOW = Date.parse("2026-10-13T06:00:00Z");
export const CLUSTER_ID = "2527c9f4-cb99-445f-a085-e48f17aab7cb";
export const TEAM_URN = "do:team:2383b506-3ce5-4552-b51f-fe432dc29d93";

const item = (product: string, description: string, amount: string, duration: string, start: string, end: string, extra: Record<string, unknown> = {}) => ({
  product,
  description,
  amount,
  duration,
  duration_unit: "Hours",
  start_time: start,
  end_time: end,
  category: "iaas",
  ...extra,
});
const k8s = { group_description: "wldd", project_name: "WLDD" };

export const PREVIEW_ITEMS = {
  invoice_items: [
    item("Taxes", "GST India (18.00%)", "16.65", "0", "2026-10-01T00:00:00Z", "2026-10-31T23:59:59Z"),
    item("Volume Snapshots", "pre-migration-2026-10-07-redis (blr1) 0.08GB Volume Snapshot", "0.01", "137", "2026-10-07T06:32:16Z", "2026-10-13T00:00:00Z"),
    item("Uptime Health Check", "infisical  (Free 288 hours)", "0.00", "288", "2026-10-01T00:00:00Z", "2026-10-13T00:00:00Z", { category: "saas" }),
    item("Spaces Bandwidth", "Spaces Bandwidth Allowance - cdn (0.04GiB @ $0/GiB)", "0.00", "0", "2026-10-07T00:00:00Z", "2026-10-13T00:00:00Z"),
    item("Spaces Subscription", "Spaces ($5/mo 250GiB storage & 1TiB bandwidth)", "0.97", "131", "2026-10-07T13:21:24Z", "2026-10-13T00:00:00Z"),
    // Backups are charged once a day; the "12" is days, although the unit says hours.
    item("Droplet Backups", "server-001 (Daily Backup Services)", "12.34", "12", "2026-10-01T20:27:41Z", "2026-10-12T20:14:55Z", { project_name: "Transition" }),
    item("Kubernetes Clusters", "pvc-ac1ad37a-ab36-4f9d-bc2d-0c7579e71c9a (blr1) - 1.00GB Volume", "0.04", "288", "2026-10-01T00:00:00Z", "2026-10-13T00:00:00Z", k8s),
    item("Kubernetes Clusters", "pvc-e5a8e9e2-16fc-4437-8716-bb65b313619b (blr1) - 10.00GB Volume", "0.43", "288", "2026-10-01T00:00:00Z", "2026-10-13T00:00:00Z", k8s),
    item("Kubernetes Clusters", "pvc-fef5ad56-1793-40c9-be22-82f180a6e396 (blr1) - 8.00GB Volume", "0.34", "288", "2026-10-01T00:00:00Z", "2026-10-13T00:00:00Z", k8s),
    item("Kubernetes Clusters", "ac4cbf573411d41a59dd915f5fc2f933 (blr1) (small) (nodes: 1) Public Load Balancer", "6.43", "288", "2026-10-01T00:00:00Z", "2026-10-13T00:00:00Z", k8s),
    item("Kubernetes Clusters", "1 node - 8 GB / 4 vCPU / 160 GB SSD", "10.82", "151", "2026-10-01T00:00:00Z", "2026-10-07T07:25:26Z", k8s),
    item("Kubernetes Clusters", "1 node - 16 GB / 8 vCPU / 320 GB SSD", "19.62", "137", "2026-10-07T06:39:27Z", "2026-10-13T00:00:00Z", k8s),
    item("Droplets", "server-001 (s-8vcpu-16gb)", "41.14", "288", "2026-10-01T00:00:00Z", "2026-10-13T00:00:00Z", { project_name: "Transition" }),
  ],
  links: {},
  meta: { total: 13 },
};

const point = (date: string, description: string, amount: string, extra: Record<string, unknown> = {}) => ({ usage_team_urn: TEAM_URN, start_date: date, total_amount: amount, region: "global", description, sku: "x", ...extra });

/** Two days of October: the 1st (old node) and the 12th (the last full day: new node, daily backup). */
export const INSIGHTS_CURRENT = {
  current_page: "1",
  total_pages: "1",
  total_items: "8",
  data_points: [
    point("2026-10-01", "server-001 (s-8vcpu-16gb)", "3.43"),
    point("2026-10-01", "1 node - 8 GB / 4 vCPU / 160 GB SSD", "1.71", { group_description: "wldd" }),
    point("2026-10-01", "GST India (18.00%)", "1.23"),
    point("2026-10-12", "server-001 (s-8vcpu-16gb)", "3.43"),
    point("2026-10-12", "server-001 (Daily Backup Services)", "1.03"),
    point("2026-10-12", "1 node - 16 GB / 8 vCPU / 320 GB SSD", "3.43", { group_description: "wldd" }),
    point("2026-10-12", "1 node - 8 GB / 4 vCPU / 160 GB SSD", "0", { group_description: "wldd" }),
    point("2026-10-12", "GST India (18.00%)", "1.56"),
  ],
};

export const BALANCE = { month_to_date_balance: "-0.50", account_balance: "-112.01", month_to_date_usage: "111.51", generated_at: "2026-10-13T04:10:49Z" };

export const INVOICES = {
  invoice_preview: { invoice_uuid: "a91115bb-4a3e-4eb2-b67b-5d842e0132ce", amount: "109.16", invoice_period: "2026-10", updated_at: "2026-10-13T04:10:49Z", account_urn: TEAM_URN },
  invoices: [
    { invoice_uuid: "618221c2-4b23-4057-968b-98f64a9ef588", amount: "137.99", invoice_period: "2026-09" },
    { invoice_uuid: "11111111-4b23-4057-968b-98f64a9ef588", amount: "0.00", invoice_period: "2026-08" },
  ],
  meta: { total: 2 },
};

export const SIZES = {
  sizes: [
    { slug: "s-4vcpu-8gb", memory: 8192, vcpus: 4, disk: 160, transfer: 5, price_monthly: 48, price_hourly: 0.07143 },
    { slug: "s-8vcpu-16gb", memory: 16384, vcpus: 8, disk: 320, transfer: 6, price_monthly: 96, price_hourly: 0.14286 },
  ],
  meta: { total: 2 },
};

export const CLUSTER = { kubernetes_cluster: { id: CLUSTER_ID, name: "wldd", region: "blr1" } };
