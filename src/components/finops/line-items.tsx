"use client";

import { Fragment, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ChevronRight, Search, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { explainLine, type LineContext } from "@/lib/finops/explain";
import { usd, usdRate } from "@/lib/finops/format";
import type { LineCost } from "@/lib/finops/spend";

type SortKey = "product" | "description" | "project" | "rate" | "amount" | "projected";

export interface LineFilter {
  /** Shown in the chip, e.g. "Product: Droplets". */
  label: string;
  match: (l: LineCost) => boolean;
}

const keyOf = (l: LineCost, i: number) => `${l.product}-${l.description}-${l.start ?? i}`;

/**
 * Every line of this month's invoice: searchable, sortable, filtered by a click on a breakdown bar, and each row opens
 * to show how its rate and projection were worked out.
 */
export function LineItemsTable({ lines, context, filter, onClearFilter }: { lines: LineCost[]; context: LineContext; filter?: LineFilter | null; onClearFilter?: () => void }) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "projected", desc: true });
  const [open, setOpen] = useState<string | null>(null);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = filter ? lines.filter(filter.match) : lines;
    if (q) list = list.filter((l) => [l.product, l.description, l.projectName ?? "", l.groupDescription ?? ""].some((v) => v.toLowerCase().includes(q)));
    const value = (l: LineCost): string | number =>
      sort.key === "product" ? l.product : sort.key === "description" ? l.description : sort.key === "project" ? (l.projectName ?? "") : sort.key === "rate" ? l.rate : sort.key === "amount" ? l.amount : l.projected;
    return [...list].sort((a, b) => {
      const va = value(a);
      const vb = value(b);
      const c = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb));
      return sort.desc ? -c : c;
    });
  }, [lines, query, sort, filter]);

  const header = (key: SortKey, label: string, align = "") => {
    const on = sort.key === key;
    return (
      <Th className={align}>
        <button
          type="button"
          onClick={() => setSort((s) => ({ key, desc: s.key === key ? !s.desc : key !== "product" && key !== "description" && key !== "project" }))}
          className={`inline-flex items-center gap-1 uppercase tracking-wide hover:text-text ${on ? "text-text" : ""}`}
          aria-label={`Sort by ${label}`}
        >
          {label}
          {on ? sort.desc ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" /> : null}
        </button>
      </Th>
    );
  };

  const total = rows.reduce((a, l) => a + l.amount, 0);
  const projected = rows.reduce((a, l) => a + l.projected, 0);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
        <label className="relative block w-72 max-w-full">
          <span className="sr-only">Search invoice lines</span>
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search product, resource or project"
            className="w-full rounded-md border border-border bg-surface-2 py-1.5 pl-8 pr-2 text-sm placeholder:text-muted focus:border-accent focus:outline-none"
          />
        </label>
        {filter ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-accent/15 py-0.5 pl-2.5 pr-1 text-xs font-medium text-accent">
            {filter.label}
            <button type="button" onClick={onClearFilter} aria-label={`Remove filter ${filter.label}`} className="grid size-4 place-items-center rounded-full hover:bg-accent/20">
              <X className="size-3" />
            </button>
          </span>
        ) : null}
        <span className="text-xs text-muted">{rows.length === lines.length ? `${lines.length} lines` : `${rows.length} of ${lines.length} lines`} · click a line to see how it was worked out</span>
      </div>
      <TableWrap>
        <Table>
          <thead>
            <tr>
              {header("product", "Product")}
              {header("description", "Resource")}
              {header("project", "Project")}
              <Th>Status</Th>
              {header("rate", "Rate / h", "text-right")}
              {header("amount", "So far", "text-right")}
              {header("projected", "Month (projected)", "text-right")}
            </tr>
          </thead>
          <tbody>
            {rows.map((l, i) => {
              const k = keyOf(l, i);
              const isOpen = open === k;
              const e = isOpen ? explainLine(l, context) : null;
              return (
                <Fragment key={k}>
                  <tr
                    onClick={() => setOpen(isOpen ? null : k)}
                    onKeyDown={(ev) => {
                      if (ev.key === "Enter" || ev.key === " ") {
                        ev.preventDefault();
                        setOpen(isOpen ? null : k);
                      }
                    }}
                    tabIndex={0}
                    aria-expanded={isOpen}
                    className={`cursor-pointer outline-none transition-colors hover:bg-surface-2 focus-visible:bg-surface-2 ${isOpen ? "bg-surface-2" : ""}`}
                  >
                    <Td>
                      <span className="inline-flex items-center gap-1.5">
                        <ChevronRight className={`size-3.5 shrink-0 text-muted transition-transform motion-reduce:transition-none ${isOpen ? "rotate-90" : ""}`} aria-hidden />
                        {l.product}
                      </span>
                    </Td>
                    <Td wrap className="font-mono text-xs">{l.description}{l.groupDescription ? <span className="ml-2 text-muted">· {l.groupDescription}</span> : null}</Td>
                    <Td className="text-muted">{l.projectName ?? "—"}</Td>
                    <Td>{l.isTax ? <Badge>Tax</Badge> : l.running ? <Badge tone="success">Active</Badge> : l.amount > 0 ? <Badge>Stopped</Badge> : <Badge>Free</Badge>}</Td>
                    <Td className="text-right tabular-nums">{l.rate > 0 ? usdRate(l.rate) : "—"}</Td>
                    <Td className="text-right tabular-nums">{usd(l.amount)}</Td>
                    <Td className="text-right tabular-nums font-medium">{usd(l.projected)}</Td>
                  </tr>
                  {e ? (
                    <tr className="bg-surface-2/60">
                      <td colSpan={7} className="border-b border-border/60 px-4 py-3 pl-10">
                        <dl className="grid gap-1.5 text-xs md:grid-cols-[7rem_1fr]">
                          <dt className="font-medium text-muted">Hourly rate</dt>
                          <dd className="font-mono text-[11px] text-text">{e.rate}</dd>
                          <dt className="font-medium text-muted">This month</dt>
                          <dd className="font-mono text-[11px] text-text">{e.projected}</dd>
                          {e.note ? (
                            <>
                              <dt className="font-medium text-muted">Note</dt>
                              <dd className="text-muted">{e.note}</dd>
                            </>
                          ) : null}
                          <dt className="font-medium text-muted">Billed</dt>
                          <dd className="text-muted">
                            {l.start ? new Date(l.start).toISOString().replace("T", " ").slice(0, 16) : "?"} → {l.end ? new Date(l.end).toISOString().replace("T", " ").slice(0, 16) : "?"} UTC
                          </dd>
                        </dl>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
            {rows.length === 0 ? (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-sm text-muted">No line matches{query.trim() ? ` “${query.trim()}”` : ""}{filter ? ` with ${filter.label}` : ""}.</td></tr>
            ) : null}
          </tbody>
          {rows.length > 0 ? (
            <tfoot>
              <tr>
                <Td className="font-medium">{filter || query.trim() ? "Total shown" : "Total"}</Td>
                <Td /><Td /><Td /><Td />
                <Td className="text-right font-medium tabular-nums">{usd(total)}</Td>
                <Td className="text-right font-semibold tabular-nums">{usd(projected)}</Td>
              </tr>
            </tfoot>
          ) : null}
        </Table>
      </TableWrap>
    </div>
  );
}
