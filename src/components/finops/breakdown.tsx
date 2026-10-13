"use client";

import { useRef, useState } from "react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import type { LineContext } from "@/lib/finops/explain";
import { usd } from "@/lib/finops/format";
import type { Group, LineCost } from "@/lib/finops/spend";
import { LineItemsTable, type LineFilter } from "./line-items";

type Selection = { kind: "product" | "project" | "scope"; name: string } | null;

/** Legend for the two-step bars: so far (solid) and the rest of the projected month (lighter). */
function SoFarLegend() {
  return (
    <div className="flex items-center gap-4 text-xs text-muted" aria-hidden>
      <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-accent" />So far</span>
      <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-accent/30" />Projected by month end</span>
    </div>
  );
}

/** Horizontal bars, one hue: solid for what has been billed, a lighter step up to the projected month. Each row is a button. */
function GroupBars({ groups, selected, onSelect }: { groups: Group[]; selected: string | null; onSelect: (name: string) => void }) {
  const max = Math.max(0, ...groups.map((g) => Math.max(g.projected, g.amount)));
  if (groups.length === 0) return <p className="text-sm text-muted">Nothing billed yet this month.</p>;
  return (
    <ul className="space-y-1">
      {groups.map((g) => {
        const sofar = max ? (g.amount / max) * 100 : 0;
        const proj = max ? (Math.max(g.projected, g.amount) / max) * 100 : 0;
        const on = selected === g.name;
        const dim = selected !== null && !on;
        return (
          <li key={g.name}>
            <button
              type="button"
              onClick={() => onSelect(g.name)}
              aria-pressed={on}
              title={on ? "Click again to show all invoice lines" : `Show only these invoice lines`}
              className={`-mx-2 block w-[calc(100%+1rem)] rounded-lg px-2 py-1.5 text-left transition-[background-color,opacity] duration-150 motion-reduce:transition-none ${on ? "bg-accent/10 ring-1 ring-accent/40" : "hover:bg-surface-2"} ${dim ? "opacity-50 hover:opacity-100" : ""}`}
            >
              <span className="mb-1 flex items-baseline justify-between gap-3 text-sm">
                <span className="min-w-0 truncate">{g.name}</span>
                <span className="shrink-0 text-xs tabular-nums text-muted">
                  <span className="font-medium text-text">{usd(g.amount)}</span> so far · {usd(g.projected)} month
                </span>
              </span>
              <span className="relative block h-2 w-full overflow-hidden rounded-full bg-surface-2" role="img" aria-label={`${g.name}: ${usd(g.amount)} so far, ${usd(g.projected)} projected for the month`}>
                <span className="absolute inset-y-0 left-0 rounded-full bg-accent/30" style={{ width: `${proj}%` }} />
                <span className="absolute inset-y-0 left-0 rounded-full bg-accent" style={{ width: `${sofar}%` }} />
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The three breakdowns and the invoice table, linked: clicking a bar filters the table to its lines and scrolls to it.
 */
export function Breakdown({
  lines,
  byProduct,
  byProject,
  cluster,
  other,
  clusterName,
  context,
}: {
  lines: LineCost[];
  byProduct: Group[];
  byProject: Group[];
  cluster: Group;
  other: Group;
  clusterName?: string;
  context: LineContext;
}) {
  const [selection, setSelection] = useState<Selection>(null);
  const table = useRef<HTMLDivElement>(null);

  const inCluster = (l: LineCost) => (clusterName ? l.groupDescription === clusterName : l.product === "Kubernetes Clusters");
  const filter: LineFilter | null = !selection
    ? null
    : selection.kind === "product"
      ? { label: `Product: ${selection.name}`, match: (l) => l.product === selection.name }
      : selection.kind === "project"
        ? { label: `Project: ${selection.name}`, match: (l) => !l.isTax && (l.projectName ?? "No project") === selection.name }
        : selection.name === cluster.name
          ? { label: `Cluster: ${cluster.name}`, match: (l) => !l.isTax && inCluster(l) }
          : { label: "Everything else", match: (l) => !l.isTax && !inCluster(l) };

  const select = (kind: NonNullable<Selection>["kind"], name: string) => {
    const same = selection?.kind === kind && selection.name === name;
    setSelection(same ? null : { kind, name });
    if (!same) {
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      // After the table re-renders with the filter.
      window.setTimeout(() => table.current?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" }), 0);
    }
  };
  const selectedIn = (kind: NonNullable<Selection>["kind"]) => (selection?.kind === kind ? selection.name : null);

  return (
    <>
      <div className="grid gap-3 xl:grid-cols-3">
        <Card>
          <CardHeader title="By product" action={<SoFarLegend />} />
          <CardBody><GroupBars groups={byProduct} selected={selectedIn("product")} onSelect={(n) => select("product", n)} /></CardBody>
        </Card>
        <Card>
          <CardHeader title="By project" subtitle="DigitalOcean projects; tax has no project" />
          <CardBody><GroupBars groups={byProject} selected={selectedIn("project")} onSelect={(n) => select("project", n)} /></CardBody>
        </Card>
        <Card>
          <CardHeader title="Cluster vs everything else" subtitle={clusterName ? `Lines DigitalOcean files under the cluster “${clusterName}”` : "Kubernetes lines vs the rest"} />
          <CardBody><GroupBars groups={[cluster, other]} selected={selectedIn("scope")} onSelect={(n) => select("scope", n)} /></CardBody>
        </Card>
      </div>
      <p className="-mt-1 text-xs text-muted">Click a bar to see just its invoice lines.</p>
      <div ref={table} className="scroll-mt-32">
        <Card>
          <CardHeader title="Invoice lines" subtitle="Projected = so far + rate × hours left in the month, never above 672 hours per resource (DigitalOcean's monthly cap). Click a line for its calculation." />
          <LineItemsTable lines={lines} context={context} filter={filter} onClearFilter={() => setSelection(null)} />
        </Card>
      </div>
    </>
  );
}
