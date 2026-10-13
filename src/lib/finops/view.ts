// Everything the FinOps page and the AI assistant know about cost, computed once from what DigitalOcean returned
// and the cluster as it is now. Both use this, so they always show the same numbers.

import type { LoadedCluster } from "@/lib/data";
import type { FinopsSource } from "@/lib/do/billing";
import { buildPvcViews } from "@/lib/k8s/views";
import { allocate, type Allocation } from "./allocation";
import type { Balance, InvoiceRef, SizePrice } from "./parse";
import { dailySeries, dayBreakdown, lastFullDay, previousPeriod, sameDaysComparison, summarizeSpend, type DayAmount, type LineCost, type SpendSummary } from "./spend";

export interface FinopsView {
  /** "2026-10" */
  period: string;
  previousPeriod: string;
  clusterName?: string;
  balance: Balance | null;
  /** Past invoices, newest first. */
  invoices: InvoiceRef[];
  lastMonth?: InvoiceRef;
  spend: SpendSummary | null;
  /** This cluster's invoice lines. */
  clusterLines: LineCost[];
  allocation: Allocation | null;
  sizes: SizePrice[];
  /** Spend per UTC day from Billing Insights (tax included): this month to the last full day, and all of last month. */
  daily: {
    current: DayAmount[];
    previous: DayAmount[];
    lastDay: string;
    /** What was billed on each day of this month, for clicking a day in the chart. */
    items: Record<string, { description: string; amount: number }[]>;
    /** This month so far against the same days last month. */
    sameDays: ReturnType<typeof sameDaysComparison>;
  } | null;
}

export function buildFinopsView(d: FinopsSource, cluster: LoadedCluster | null): FinopsView {
  const now = Date.parse(d.fetchedAt);
  const preview = d.invoices.ok ? d.invoices.value.preview : undefined;
  const period = preview?.period ?? d.fetchedAt.slice(0, 7);
  const prev = previousPeriod(period);
  const clusterName = d.clusterName.ok ? d.clusterName.value : undefined;
  const insights = d.insights.ok ? d.insights.value.current : [];
  const spend = d.items.ok ? summarizeSpend(d.items.value, { period, now, insights, clusterName }) : null;
  const invoices = d.invoices.ok ? d.invoices.value.invoices : [];
  const sizes = d.sizes.ok ? d.sizes.value : [];
  const clusterLines = spend ? spend.lines.filter((l) => (clusterName ? l.groupDescription === clusterName : l.product === "Kubernetes Clusters")) : [];

  const allocation =
    cluster && d.sizes.ok
      ? allocate({
          nodes: cluster.nodes,
          rows: cluster.rows,
          pvcs: buildPvcViews(cluster.bundle),
          loadBalancerServices: cluster.bundle.services
            .filter((s) => s.spec?.type === "LoadBalancer" && s.metadata?.uid)
            .map((s) => ({
              namespace: s.metadata?.namespace ?? "",
              name: s.metadata?.name ?? "",
              uid: s.metadata!.uid!,
              nameAnnotation: s.metadata?.annotations?.["service.beta.kubernetes.io/do-loadbalancer-name"],
            })),
          sizes,
          clusterLines,
          metricsAvailable: cluster.connection.metricsAvailable,
        })
      : null;

  const lastDay = spend?.lastFullDay ?? lastFullDay(now);
  const daily = d.insights.ok
    ? (() => {
        const current = dailySeries(d.insights.value.current, period, lastDay);
        const previous = dailySeries(d.insights.value.previous, prev);
        const points = d.insights.value.current;
        return { current, previous, lastDay, items: Object.fromEntries(current.map((c) => [c.date, dayBreakdown(points, c.date)])), sameDays: sameDaysComparison(current, previous) };
      })()
    : null;

  return {
    period,
    previousPeriod: prev,
    clusterName,
    balance: d.balance.ok ? d.balance.value : null,
    invoices,
    lastMonth: invoices.find((i) => i.period === prev),
    spend,
    clusterLines,
    allocation,
    sizes,
    daily,
  };
}
