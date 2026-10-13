import { Info } from "lucide-react";
import { Breakdown } from "@/components/finops/breakdown";
import { ColumnChart, CumulativeChart, type Column } from "@/components/finops/charts";
import { DailySpend } from "@/components/finops/daily-spend";
import { Explain, Formula, Step } from "@/components/finops/explain";
import { NamespaceCostTable } from "@/components/finops/namespace-costs";
import { CeilingCard, DropletsCard, MissingRequestsCard, Section, SnapshotsCard, TokenHelp, Unavailable, UnusedRequestsCard, UtilisationCard } from "@/components/finops/parts";
import { SectionNav } from "@/components/finops/section-nav";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader, StatCard } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { loadCluster } from "@/lib/data";
import { loadFinops } from "@/lib/do/billing";
import { monthly, otherDroplets, podsWithoutRequests, poolCeilings, snapshotsAndBackups } from "@/lib/finops/allocation";
import { dayLabel, periodLabel, signedPercent, usd, usdRate, utcTime } from "@/lib/finops/format";
import { cumulative, daysInPeriod, HOURS_CAP, monthWindow } from "@/lib/finops/spend";
import { buildFinopsView } from "@/lib/finops/view";
import { unavailableReason } from "@/lib/providers";

export const metadata = { title: "FinOps" };

export default async function FinopsPage() {
  const cluster = await loadCluster();
  const header = (
    <PageHeader
      title="FinOps"
      subtitle="What this DigitalOcean account spends, where it goes, and what the cluster costs per namespace. Billing is read from DigitalOcean; nothing is changed."
    />
  );
  // Billing is cloud-specific: only DigitalOcean is built so far.
  const notHere = cluster.connection.provider ? unavailableReason(cluster.connection.provider, "finops") : undefined;
  if (notHere) return <div className="space-y-4">{header}<Unavailable what="FinOps" message={notHere} /></div>;
  const finops = await loadFinops(cluster.connection.server);
  if (finops.state === "no-token") return <div className="space-y-4">{header}<TokenHelp /></div>;
  if (finops.state === "not-doks") {
    return <div className="space-y-4">{header}<Unavailable what="FinOps" message="The connected cluster is not a DigitalOcean Kubernetes cluster, so there is no DigitalOcean bill to read." /></div>;
  }

  const d = finops.data;
  // The same numbers the AI assistant is given.
  const view = buildFinopsView(d, cluster.ok ? cluster : null);
  const { period, previousPeriod: prev, clusterName, spend, lastMonth, sizes, allocation, balance } = view;
  const insights = view.daily;

  // ---- trends ----
  const lastDay = insights?.lastDay ?? "";
  const currentDaily = insights?.current ?? [];
  const previousDaily = insights?.previous ?? [];
  const resizeMarkers = (spend?.nodeChanges ?? []).map((c) => ({ key: c.at.slice(0, 10), text: "node resized" }));
  const dailyColumns: Column[] = Array.from({ length: daysInPeriod(period) }, (_, i) => {
    const date = `${period}-${String(i + 1).padStart(2, "0")}`;
    const value = currentDaily.find((x) => x.date === date)?.amount ?? null;
    return { key: date, label: String(i + 1), value, tooltip: { title: dayLabel(date), rows: [{ value: value === null ? "not billed yet" : usd(value), label: value === null ? "" : "that day" }] } };
  });
  const pastInvoices = d.invoices.ok ? [...d.invoices.value.invoices].slice(0, 11).reverse() : [];
  const monthColumns: Column[] = [
    ...pastInvoices.map((inv) => ({ key: inv.period, label: periodLabel(inv.period).slice(0, 3), value: inv.amount, cap: usd(inv.amount), tooltip: { title: periodLabel(inv.period, true), rows: [{ value: usd(inv.amount), label: "invoice" }] } })),
    ...(spend
      ? [{
          key: period,
          label: periodLabel(period).slice(0, 3),
          value: spend.itemisedTotal,
          extra: Math.max(0, spend.projectedTotal - spend.itemisedTotal),
          cap: `~${usd(spend.projectedTotal)}`,
          tooltip: { title: `${periodLabel(period, true)} (in progress)`, rows: [{ value: usd(spend.itemisedTotal), label: "so far" }, { value: usd(spend.projectedTotal), label: "projected" }] },
        }]
      : []),
  ];

  // ---- the cluster, per namespace ----
  const unpricedNodes = allocation?.nodes.filter((n) => n.hourly === null) ?? [];
  const sumNodes = (pick: (n: { cpu: { allocatable: number; requests: number; usage: number | null }; memory: { allocatable: number; requests: number; usage: number | null } }) => { allocatable: number; requests: number; usage: number | null }) =>
    cluster.ok
      ? cluster.nodes.map(pick).reduce((a, r) => ({ allocatable: a.allocatable + r.allocatable, requests: a.requests + r.requests, usage: a.usage === null || r.usage === null ? null : a.usage + r.usage }), { allocatable: 0, requests: 0, usage: 0 as number | null })
      : null;
  const cpuUse = sumNodes((n) => n.cpu);
  const memUse = sumNodes((n) => n.memory);
  const pools = cluster.ok && cluster.nodePools.state === "ok" && d.sizes.ok ? poolCeilings(cluster.nodePools.pools, sizes) : null;

  const spentNow = balance?.monthToDateUsage ?? spend?.itemisedTotal ?? null;
  const taxLine = spend?.lines.find((l) => l.isTax);
  const projectedUp = spend && lastMonth ? spend.projectedTotal > lastMonth.amount : false;
  const pct = (r: number) => `${Math.round(r * 1000) / 10}%`;
  const monthEnd = utcTime(new Date(monthWindow(period).end).toISOString());

  // ---- like-for-like: this month so far against the same days last month ----
  const same = insights?.sameDays ?? null;
  const sameLabel = same ? `1–${same.days} ${periodLabel(period).slice(0, 3)}` : "";
  const prevLabel = same ? `1–${same.previousDays} ${periodLabel(prev).slice(0, 3)}` : "";
  const sameUp = same ? same.current > same.previous * 1.1 : false;

  // Lines whose projection adds the most between now and the end of the month.
  const growth = spend ? spend.lines.filter((l) => !l.isTax && l.projected - l.amount > 0.005).sort((a, b) => b.projected - b.amount - (a.projected - a.amount)).slice(0, 4) : [];
  const burners = spend ? spend.lines.filter((l) => l.running && !l.isTax).sort((a, b) => b.rate - a.rate).slice(0, 5) : [];
  const lineContext = spend ? { hoursLeft: spend.hoursLeft, lastDay: spend.lastFullDay, taxRate: spend.taxRate, projectedPretax: spend.projectedPretax } : null;
  const sections = [
    { id: "summary", label: "Summary" },
    ...(spend ? [{ id: "breakdown", label: "Where the money goes" }] : []),
    { id: "trends", label: "Trends" },
    { id: "allocation", label: "Per namespace" },
    { id: "efficiency", label: "Savings" },
  ];

  return (
    <div className="space-y-8">
      <PageHeader
        title="FinOps"
        subtitle="What this DigitalOcean account spends, where it goes, and what the cluster costs per namespace. Billing is read from DigitalOcean; nothing is changed."
        actions={
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            <Badge tone="info">{periodLabel(period, true)}</Badge>
            {spend ? <Badge title="DigitalOcean regenerates this month's invoice about once a day">Invoice data to {utcTime(spend.coverageEnd)}</Badge> : null}
            <Badge>USD</Badge>
          </div>
        }
      />
      <SectionNav sections={sections} />

      {/* ---- 1. headline ---- */}
      <section id="summary" aria-label="This month" className="@container">
        <div className="grid grid-cols-2 gap-3 @3xl:grid-cols-3 @6xl:grid-cols-6">
          <StatCard
            label="Spent this month"
            value={usd(spentNow)}
            hint={balance ? `as of ${utcTime(balance.generatedAt)}${spend ? ` · ${usd(spend.itemisedTotal)} itemised` : ""}` : d.balance.ok ? undefined : "from the invoice lines"}
            info={
              <Explain title="Spent this month">
                <Step label="DigitalOcean balance API: month_to_date_usage" value={usd(balance?.monthToDateUsage)} />
                <Step label="Generated at" value={utcTime(balance?.generatedAt)} />
                {spend ? <Step label="Sum of this month's invoice lines" value={usd(spend.itemisedTotal)} /> : null}
                <span className="block">The headline is DigitalOcean&apos;s own figure, used as is. The invoice lines can differ by a little: DigitalOcean does not document why, most likely usage not yet split into lines.</span>
              </Explain>
            }
          />
          <StatCard
            label="Projected month end"
            value={spend ? usd(spend.projectedTotal) : "—"}
            tone={projectedUp ? "warning" : undefined}
            hint={spend && lastMonth ? `${signedPercent(spend.projectedTotal, lastMonth.amount)} vs ${periodLabel(prev)} (${usd(lastMonth.amount)})` : spend ? "running resources × hours left, capped at 672 h" : undefined}
            info={
              spend ? (
                <Explain title="Projected month end">
                  <Step label="Billed so far, before tax" value={usd(spend.pretax)} />
                  <Step label={`Invoice data runs to ${utcTime(spend.coverageEnd)}; the month ends ${monthEnd}`} value={`${Math.round(spend.hoursLeft)} h left`} />
                  <Formula>each running resource: min(so far + rate × {Math.round(spend.hoursLeft)} h, rate × {HOURS_CAP} h)</Formula>
                  <span className="block">Stopped resources stay at what they cost. No resource is billed more than {HOURS_CAP} hours a month. The biggest additions by month end:</span>
                  {growth.map((l) => <Step key={l.description} label={<span className="font-mono text-[11px]">{l.description}</span>} value={`+${usd(l.projected - l.amount)}`} />)}
                  <Step label="Projected before tax" value={usd(spend.projectedPretax)} strong />
                  <Step label={`Tax at the rate so far (${pct(spend.taxRate)})`} value={usd(spend.projectedTax)} />
                  <Step label="Projected month end" value={usd(spend.projectedTotal)} strong />
                  {lastMonth ? <span className="block">Compared with {periodLabel(prev, true)}&apos;s full invoice of {usd(lastMonth.amount)}. For a like-for-like view, see &quot;vs same days last month&quot;.</span> : null}
                </Explain>
              ) : null
            }
          />
          <StatCard
            label="vs same days last month"
            value={same ? (same.previous > 0 ? signedPercent(same.current, same.previous) : `+${usd(same.current)}`) : "—"}
            tone={sameUp ? "warning" : undefined}
            hint={same ? `${sameLabel}: ${usd(same.current)} · ${prevLabel}: ${usd(same.previous)}` : lastMonth ? `${periodLabel(prev, true)} invoice: ${usd(lastMonth.amount)}` : undefined}
            info={
              same ? (
                <Explain title="vs same days last month">
                  <Step label={`${sameLabel}, from Billing Insights`} value={usd(same.current)} />
                  <Step label={`${prevLabel}, the same days`} value={usd(same.previous)} />
                  <Step label="Change" value={same.previous > 0 ? signedPercent(same.current, same.previous) : "nothing billed last month by then"} strong />
                  {lastMonth ? <Step label={`${periodLabel(prev, true)} full invoice`} value={usd(lastMonth.amount)} /> : null}
                  <span className="block">A fair comparison: the same number of days in each month, tax included. Daily figures come from Billing Insights, built nightly, so they can differ slightly from the invoice.{same.previousDays < same.days ? ` ${periodLabel(prev)} has only ${same.previousDays} days, so all of them are counted.` : ""}</span>
                </Explain>
              ) : null
            }
          />
          <StatCard
            label="Burn rate"
            value={spend ? `${usd(spend.burnPerHour * 24)}/day` : "—"}
            hint={spend ? `${usdRate(spend.burnPerHour)}/h before tax, for what runs now` : undefined}
            info={
              spend ? (
                <Explain title="Burn rate">
                  <Formula>burn rate = sum of the hourly rates of everything still running</Formula>
                  {burners.map((l) => <Step key={l.description} label={<span className="font-mono text-[11px]">{l.description}</span>} value={`${usdRate(l.rate)}/h`} />)}
                  {spend.lines.filter((l) => l.running && !l.isTax).length > burners.length ? <span className="block">…and {spend.lines.filter((l) => l.running && !l.isTax).length - burners.length} smaller lines.</span> : null}
                  <Step label="Total per hour, before tax" value={`${usdRate(spend.burnPerHour)}/h`} strong />
                  <Step label="× 24 hours" value={`${usd(spend.burnPerHour * 24)}/day`} />
                  <span className="block">How fast money is being spent right now. Delete or resize something and this changes the next day.</span>
                </Explain>
              ) : null
            }
          />
          <StatCard
            label="Kubernetes cluster"
            value={spend ? usd(spend.cluster.amount) : "—"}
            hint={spend ? `${spend.pretax ? Math.round((spend.cluster.amount / spend.pretax) * 100) : 0}% of spend before tax · ~${usd(spend.cluster.projected)} month` : undefined}
            info={
              spend ? (
                <Explain title="Kubernetes cluster">
                  <Step label={`${spend.cluster.count} invoice lines filed under ${clusterName ? `the cluster “${clusterName}”` : "Kubernetes Clusters"}`} value={usd(spend.cluster.amount)} />
                  <Step label="Share of spend before tax" value={`${usd(spend.cluster.amount)} ÷ ${usd(spend.pretax)} = ${spend.pretax ? Math.round((spend.cluster.amount / spend.pretax) * 100) : 0}%`} />
                  <Step label="Projected for the month" value={usd(spend.cluster.projected)} strong />
                  <span className="block">Nodes, the load balancer and the volumes. Click &quot;Cluster vs everything else&quot; below to see the lines.</span>
                </Explain>
              ) : null
            }
          />
          <StatCard
            label="Tax"
            value={spend ? usd(spend.tax) : "—"}
            hint={spend ? `${taxLine?.description ?? `${Math.round(spend.taxRate * 100)}%`} · ~${usd(spend.projectedTax)} month` : undefined}
            info={
              spend ? (
                <Explain title="Tax">
                  <Step label={taxLine?.description ?? "Tax lines"} value={usd(spend.tax)} />
                  <Step label="Rate so far" value={`${usd(spend.tax)} ÷ ${usd(spend.pretax)} = ${pct(spend.taxRate)}`} />
                  <Step label="Projected" value={`${usd(spend.projectedPretax)} × ${pct(spend.taxRate)} = ${usd(spend.projectedTax)}`} strong />
                </Explain>
              ) : null
            }
          />
        </div>
      </section>

      {!d.items.ok ? <Unavailable what="This month's invoice" message={d.items.message} /> : null}
      {!d.balance.ok ? <Unavailable what="Account balance" message={d.balance.message} /> : null}

      {spend?.nodeChanges.length ? (
        <Card className="border-warning/40">
          <CardBody className="flex items-start gap-3 text-sm">
            <Info className="mt-0.5 size-4 shrink-0 text-warning" />
            <div className="space-y-1">
              {spend.nodeChanges.map((c) => {
                const before = spend.lines.find((l) => l.description === c.from);
                const after = spend.lines.find((l) => l.description === c.to);
                return (
                  <p key={c.at}>
                    <span className="font-medium">Node pool resized on {dayLabel(c.at)}:</span> {c.from.replace(/^\d+ nodes? - /, "")} → {c.to.replace(/^\d+ nodes? - /, "")}.
                    {before && after && before.rate > 0 ? <span className="text-muted"> Node cost went from {usdRate(before.rate)}/h to {usdRate(after.rate)}/h ({signedPercent(after.rate, before.rate)}).</span> : null}
                  </p>
                );
              })}
            </div>
          </CardBody>
        </Card>
      ) : null}

      {/* ---- 2. where the money goes ---- */}
      {spend ? (
        <Section id="breakdown" title="Where the money goes" subtitle="This month's invoice, before tax unless it says Taxes. Bars run to the projected month total.">
          {lineContext ? (
            <Breakdown lines={spend.lines} byProduct={spend.byProduct} byProject={spend.byProject} cluster={spend.cluster} other={spend.other} clusterName={clusterName} context={lineContext} />
          ) : null}
        </Section>
      ) : null}

      {/* ---- 3. trends ---- */}
      <Section id="trends" title="Trends" subtitle="Daily figures come from Billing Insights, which DigitalOcean builds each night; they can differ slightly from the invoice.">
        {!d.insights.ok ? <Unavailable what="Daily spend" message={d.insights.message} /> : null}
        {insights ? (
          <div className="grid gap-3 xl:grid-cols-2">
            <Card>
              <CardHeader title="Running total by day of month" subtitle={`${periodLabel(period)} so far against all of ${periodLabel(prev)}, tax included`} />
              <CardBody>
                <CumulativeChart current={cumulative(currentDaily.map((x) => x.amount))} previous={cumulative(previousDaily.map((x) => x.amount))} currentLabel={periodLabel(period)} previousLabel={periodLabel(prev)} days={daysInPeriod(period)} />
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Spend per day" subtitle={`${periodLabel(period)}, tax included, up to ${dayLabel(lastDay)} (the last complete day)`} />
              <CardBody>
                <DailySpend columns={dailyColumns} markers={resizeMarkers} items={insights.items} label={`Daily spend in ${periodLabel(period, true)}`} />
              </CardBody>
            </Card>
          </div>
        ) : null}
        {monthColumns.length ? (
          <Card>
            <CardHeader title="Monthly invoices" subtitle="Past invoices, and this month so far (solid) with the projected rest (lighter)" />
            <CardBody>
              <ColumnChart columns={monthColumns} label="Monthly invoice totals" height={220} />
            </CardBody>
          </Card>
        ) : null}
        {insights ? (
          <details className="rounded-xl border border-border bg-surface">
            <summary className="cursor-pointer px-4 py-3 text-sm text-muted hover:text-text">Show daily spend as a table</summary>
            <div className="grid gap-x-8 px-4 pb-4 sm:grid-cols-2">
              {[{ label: periodLabel(period, true), rows: currentDaily }, { label: periodLabel(prev, true), rows: previousDaily }].map((m) => (
                <table key={m.label} className="w-full text-sm">
                  <caption className="py-2 text-left text-xs font-medium uppercase tracking-wide text-muted">{m.label}</caption>
                  <tbody>
                    {m.rows.map((r) => (
                      <tr key={r.date} className="border-b border-border/60"><td className="py-1">{dayLabel(r.date)}</td><td className="py-1 text-right tabular-nums">{usd(r.amount)}</td></tr>
                    ))}
                  </tbody>
                </table>
              ))}
            </div>
          </details>
        ) : null}
      </Section>

      {/* ---- 4. per namespace ---- */}
      <Section
        id="allocation"
        title="Cluster cost per namespace, right now"
        subtitle="Node price split 50% CPU / 50% memory. Each pod pays for the larger of what it requests and what it uses; volumes go to the namespace that claims them; load balancers are shared."
      >
        {!cluster.ok ? <Unavailable what="Per-namespace cost" message={`The cluster is not reachable: ${cluster.error}`} /> : null}
        {!d.sizes.ok ? <Unavailable what="Node prices" message={d.sizes.message} /> : null}
        {allocation ? (
          <Card>
            <CardHeader
              action={
                <Explain title="Cost per namespace">
                  {allocation.nodes.map((n) =>
                    n.hourly === null ? (
                      <Step key={n.name} label={<span className="font-mono text-[11px]">{n.name}</span>} value="no list price" />
                    ) : (
                      <span key={n.name} className="block space-y-1">
                        <Step label={<>Node <span className="font-mono text-[11px]">{n.name}</span> ({n.size})</>} value={`${usdRate(n.hourly)}/h`} />
                        <Formula>CPU rate = {usdRate(n.hourly)} × 50% ÷ vCPUs = {usdRate(n.cpuRate)} per core-hour</Formula>
                        <Formula>memory rate = {usdRate(n.hourly)} × 50% ÷ GiB = {usdRate(n.memRate)} per GiB-hour</Formula>
                      </span>
                    ),
                  )}
                  <Formula>pod = max(CPU request, CPU used) × CPU rate + max(memory request, memory used) × memory rate</Formula>
                  <span className="block">Volumes are priced from their invoice line and go to the namespace that claims them. The load balancer is shared. What no pod reserves or uses is idle capacity. A full month is {HOURS_CAP} hours.</span>
                  <Step label="All rows together" value={`${usdRate(allocation.total)}/h`} strong />
                  {allocation.invoiceRate > 0 ? <Step label="The invoice's current rate for the cluster" value={`${usdRate(allocation.invoiceRate)}/h`} /> : null}
                  <span className="block">Click a namespace to see its pods and volumes.</span>
                </Explain>
              }
              title={`${usdRate(allocation.total)} per hour · about ${usd(monthly(allocation.total))} for a full month`}
              subtitle={
                <>
                  A live estimate from today&apos;s pods, not a history. A full month is 672 billed hours.
                  {allocation.invoiceRate > 0 ? <> The invoice&apos;s current rate for the cluster is {usdRate(allocation.invoiceRate)}/h.</> : null}
                </>
              }
            />
            <NamespaceCostTable allocation={allocation} />
            {(() => {
              const notes = [
                !allocation.metricsAvailable ? "metrics-server is not available, so pods are charged for their requests only." : "",
                allocation.unscheduledPods ? `${allocation.unscheduledPods} pod${allocation.unscheduledPods === 1 ? " has" : "s have"} no node yet and cost nothing.` : "",
                unpricedNodes.length ? `No list price for ${unpricedNodes.map((n) => `${n.name} (${n.size ?? "unknown size"})`).join(", ")}; ${allocation.unpricedPods} pod(s) on it are not counted.` : "",
                allocation.unpricedClaims.length ? `${allocation.unpricedClaims.length} claim(s) have no invoice line yet (new since the invoice was generated): ${allocation.unpricedClaims.join(", ")}.` : "",
                allocation.overcommitted.length ? `Pods on ${allocation.overcommitted.join(", ")} reserve or use more than the node has, so the namespaces add up to more than its price.` : "",
                !spend ? "Without this month's invoice, volumes and load balancers can't be priced." : "",
              ].filter(Boolean);
              return notes.length ? <div className="space-y-1 border-t border-border px-4 py-3 text-xs text-muted">{notes.map((n) => <p key={n}>{n}</p>)}</div> : null;
            })()}
          </Card>
        ) : null}
      </Section>

      {/* ---- 5. efficiency ---- */}
      <Section id="efficiency" title="Efficiency and savings" subtitle="Suggestions only. Nothing here changes the cluster or the account.">
        <div className="grid gap-3 xl:grid-cols-2">
          {cpuUse && memUse ? <UtilisationCard cpu={cpuUse} memory={memUse} idleMonthly={allocation ? monthly(allocation.idle.total) : null} /> : null}
          {allocation ? <UnusedRequestsCard allocation={allocation} /> : null}
          {cluster.ok ? <MissingRequestsCard pods={podsWithoutRequests(cluster.rows)} /> : null}
          <CeilingCard pools={pools} />
          {spend ? <DropletsCard droplets={otherDroplets(spend.lines, sizes)} /> : null}
          {spend ? <SnapshotsCard lines={snapshotsAndBackups(spend.lines)} /> : null}
        </div>
      </Section>
    </div>
  );
}
