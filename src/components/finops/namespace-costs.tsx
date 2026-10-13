"use client";

import Link from "next/link";
import { Fragment, useState } from "react";
import { ChevronRight } from "lucide-react";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { monthly, type Allocation, type NamespaceCost } from "@/lib/finops/allocation";
import { usd, usdRate } from "@/lib/finops/format";
import { formatPercent } from "@/lib/format";

const nsHref = (ns: string) => `/namespaces/${encodeURIComponent(ns)}`;
const cores = (n: number) => (n < 1 ? `${Math.round(n * 1000)}m` : `${Math.round(n * 100) / 100}`);
const gib = (n: number) => (n < 1 ? `${Math.round(n * 1024)}Mi` : `${Math.round(n * 100) / 100}Gi`);

/** What one namespace's cost is made of: each pod's charge and each volume. */
function NamespaceDetail({ n }: { n: NamespaceCost }) {
  return (
    <div className="space-y-3">
      {n.podCosts.length ? (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-muted">
              <th className="py-1 pr-3 font-medium">Pod</th>
              <th className="py-1 pr-3 font-medium">CPU charged</th>
              <th className="py-1 pr-3 font-medium">Memory charged</th>
              <th className="py-1 pr-3 text-right font-medium">CPU / h</th>
              <th className="py-1 pr-3 text-right font-medium">Memory / h</th>
              <th className="py-1 pr-3 text-right font-medium">Total / h</th>
              <th className="py-1 text-right font-medium">Per month</th>
            </tr>
          </thead>
          <tbody>
            {n.podCosts.map((p) => (
              <tr key={p.pod} className="border-t border-border/60">
                <td className="py-1.5 pr-3">
                  <Link href={`${nsHref(n.namespace)}/pods/${encodeURIComponent(p.pod)}`} className="font-mono text-[11px] hover:text-accent">{p.pod}</Link>
                </td>
                <td className="py-1.5 pr-3 tabular-nums" title={`${cores(p.cpuCores)} cores × ${usdRate(p.cpuRate)} per core-hour`}>
                  {cores(p.cpuCores)} <span className={p.cpuBasis === "usage" ? "text-warning" : "text-muted"}>({p.cpuBasis === "usage" ? "uses more than requested" : "requested"})</span>
                </td>
                <td className="py-1.5 pr-3 tabular-nums" title={`${gib(p.memGib)} × ${usdRate(p.memRate)} per GiB-hour`}>
                  {gib(p.memGib)} <span className={p.memBasis === "usage" ? "text-warning" : "text-muted"}>({p.memBasis === "usage" ? "uses more than requested" : "requested"})</span>
                </td>
                <td className="py-1.5 pr-3 text-right tabular-nums">{usdRate(p.cpu)}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums">{usdRate(p.memory)}</td>
                <td className="py-1.5 pr-3 text-right font-medium tabular-nums">{usdRate(p.total)}</td>
                <td className="py-1.5 text-right tabular-nums">{usd(monthly(p.total))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="text-xs text-muted">No running pods here.</p>
      )}
      {n.volumeCosts.length ? (
        <div className="space-y-1">
          {n.volumeCosts.map((v) => (
            <p key={v.claim} className="flex flex-wrap items-baseline justify-between gap-x-3 text-xs">
              <span>
                Volume <span className="font-mono text-[11px]">{v.claim}</span> <span className="font-mono text-[11px] text-muted">({v.volume})</span>
              </span>
              <span className="tabular-nums">{v.hourly ? `${usdRate(v.hourly)}/h · ${usd(monthly(v.hourly))}/month` : "no invoice line yet"}</span>
            </p>
          ))}
        </div>
      ) : null}
      {n.podCosts[0] ? (
        <p className="text-[11px] text-muted">
          Rates on this node: CPU {usdRate(n.podCosts[0].cpuRate)} per core-hour, memory {usdRate(n.podCosts[0].memRate)} per GiB-hour. Each pod pays for the larger of what it requests and what it uses; a month is 672 billed hours.
        </p>
      ) : null}
    </div>
  );
}

/** Cost per namespace now, with idle capacity and shared costs as their own rows, adding up to the cluster's rate. */
export function NamespaceCostTable({ allocation }: { allocation: Allocation }) {
  const [open, setOpen] = useState<string | null>(null);
  const { namespaces, idle, shared, unclaimedVolumes, total } = allocation;
  const share = (v: number) => (total ? (v / total) * 100 : 0);
  const bar = (v: number) => (
    <div className="h-1.5 w-20 overflow-hidden rounded-full bg-surface-2" aria-hidden>
      <div className="h-full rounded-full bg-accent" style={{ width: `${share(v)}%` }} />
    </div>
  );
  const shareCell = (v: number) => (
    <Td><div className="flex items-center gap-2">{bar(v)}<span className="w-10 text-right text-xs tabular-nums text-muted">{formatPercent(v, total)}</span></div></Td>
  );

  return (
    <TableWrap>
      <Table>
        <thead>
          <tr>
            <Th>Namespace</Th>
            <Th className="text-right">Pods</Th>
            <Th className="text-right">CPU / h</Th>
            <Th className="text-right">Memory / h</Th>
            <Th className="text-right">Storage / h</Th>
            <Th className="text-right">Total / h</Th>
            <Th className="text-right">Per month</Th>
            <Th>Share</Th>
          </tr>
        </thead>
        <tbody>
          {namespaces.map((n) => {
            const isOpen = open === n.namespace;
            return (
              <Fragment key={n.namespace}>
                <tr
                  onClick={() => setOpen(isOpen ? null : n.namespace)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setOpen(isOpen ? null : n.namespace);
                    }
                  }}
                  tabIndex={0}
                  aria-expanded={isOpen}
                  className={`cursor-pointer outline-none transition-colors hover:bg-surface-2 focus-visible:bg-surface-2 ${isOpen ? "bg-surface-2" : ""}`}
                >
                  <Td mono>
                    <span className="inline-flex items-center gap-1.5">
                      <ChevronRight className={`size-3.5 shrink-0 text-muted transition-transform motion-reduce:transition-none ${isOpen ? "rotate-90" : ""}`} aria-hidden />
                      {n.namespace}
                    </span>
                  </Td>
                  <Td className="text-right tabular-nums">{n.pods}</Td>
                  <Td className="text-right tabular-nums">{usdRate(n.cpu)}</Td>
                  <Td className="text-right tabular-nums">{usdRate(n.memory)}</Td>
                  <Td className="text-right tabular-nums">{n.storage ? usdRate(n.storage) : "—"}</Td>
                  <Td className="text-right tabular-nums font-medium">{usdRate(n.total)}</Td>
                  <Td className="text-right tabular-nums">{usd(monthly(n.total))}</Td>
                  {shareCell(n.total)}
                </tr>
                {isOpen ? (
                  <tr className="bg-surface-2/60">
                    <td colSpan={8} className="border-b border-border/60 px-4 py-3 pl-10">
                      <NamespaceDetail n={n} />
                      <p className="mt-2 text-xs"><Link href={nsHref(n.namespace)} className="text-accent hover:underline">Open namespace {n.namespace}</Link></p>
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
          <tr className="bg-surface-2/40">
            <Td><span className="font-medium">Idle capacity</span> <span className="text-xs text-muted">paid for, not reserved or used</span></Td>
            <Td />
            <Td className="text-right tabular-nums">{usdRate(idle.cpu)}</Td>
            <Td className="text-right tabular-nums">{usdRate(idle.memory)}</Td>
            <Td />
            <Td className="text-right tabular-nums font-medium">{usdRate(idle.total)}</Td>
            <Td className="text-right tabular-nums">{usd(monthly(idle.total))}</Td>
            {shareCell(idle.total)}
          </tr>
          {shared.map((s) => (
            <tr key={s.name} className="bg-surface-2/40">
              <Td><span className="font-medium">Shared: load balancer</span> <span className="font-mono text-xs text-muted">{s.owner ?? s.name}</span></Td>
              <Td /><Td /><Td /><Td />
              <Td className="text-right tabular-nums font-medium">{usdRate(s.hourly)}</Td>
              <Td className="text-right tabular-nums">{usd(monthly(s.hourly))}</Td>
              {shareCell(s.hourly)}
            </tr>
          ))}
          {unclaimedVolumes.map((v) => (
            <tr key={v.name} className="bg-surface-2/40">
              <Td><span className="font-medium">Volume with no claim</span> <span className="font-mono text-xs text-muted">{v.name}</span></Td>
              <Td /><Td /><Td />
              <Td className="text-right tabular-nums">{usdRate(v.hourly)}</Td>
              <Td className="text-right tabular-nums font-medium">{usdRate(v.hourly)}</Td>
              <Td className="text-right tabular-nums">{usd(monthly(v.hourly))}</Td>
              {shareCell(v.hourly)}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <Td className="font-medium">Cluster total</Td>
            <Td /><Td /><Td /><Td />
            <Td className="text-right font-semibold tabular-nums">{usdRate(total)}</Td>
            <Td className="text-right font-semibold tabular-nums">{usd(monthly(total))}</Td>
            <Td />
          </tr>
        </tfoot>
      </Table>
    </TableWrap>
  );
}
