// What the account is spending: hourly rates per invoice line, the month-end projection and the breakdowns.
// Pure: works on parsed invoice lines and Billing Insights points, so every formula is tested directly.
//
// Rules DigitalOcean bills by, that the projection relies on:
// - Resources are billed by the hour, and one resource is never billed more than 672 hours (28 days) in a month,
//   so its monthly price is rate × 672.
// - The current month's invoice (the "preview") is regenerated about once a day. Every line ends where that run stopped.
// - Tax is a separate line, charged as a percentage of everything else.

import type { InsightPoint, InvoiceItem } from "./parse";

export const HOURS_CAP = 672;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
export const TAX_PRODUCT = "Taxes";

export interface LineCost extends InvoiceItem {
  /** USD per hour while the resource runs. 0 for free lines and tax. */
  rate: number;
  /**
   * Where the rate came from:
   * hours  = amount / billed hours (the invoice's hours agree with its time window),
   * daily  = the last full day's charge in Billing Insights / 24 (lines whose duration is not hours, such as daily backups),
   * window = amount / the line's time window (no better source),
   * none   = free, one-off or tax.
   */
  rateSource: "hours" | "daily" | "window" | "none";
  /** Still being billed when the invoice was last generated. */
  running: boolean;
  /** Expected amount for the whole month. */
  projected: number;
  isTax: boolean;
}

export interface Group {
  name: string;
  amount: number;
  projected: number;
  count: number;
}

export interface NodeChange {
  at: string;
  from: string;
  to: string;
}

export interface SpendSummary {
  period: string;
  /** Where the invoice data stops (ISO). */
  coverageEnd: string;
  /** Hours from coverageEnd to the end of the month. */
  hoursLeft: number;
  /** The newest complete UTC day in the data ("2026-10-12"). */
  lastFullDay: string;
  /** Sum of the invoice lines, tax included. */
  itemisedTotal: number;
  pretax: number;
  tax: number;
  /** tax / pretax so far, e.g. 0.18. */
  taxRate: number;
  projectedPretax: number;
  projectedTax: number;
  projectedTotal: number;
  /** Sum of the hourly rates of everything still running, before tax. */
  burnPerHour: number;
  lines: LineCost[];
  byProduct: Group[];
  byProject: Group[];
  cluster: Group;
  other: Group;
  nodeChanges: NodeChange[];
}

const ms = (iso: string | undefined): number | undefined => {
  if (!iso) return undefined;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : undefined;
};

export const dayString = (t: number) => new Date(t).toISOString().slice(0, 10);

/** First instant of the month and of the next one, in UTC (billing periods are UTC). */
export function monthWindow(period: string): { start: number; end: number } {
  const [y, m] = period.split("-").map(Number);
  return { start: Date.UTC(y, m - 1, 1), end: Date.UTC(y, m, 1) };
}

export function previousPeriod(period: string): string {
  const { start } = monthWindow(period);
  return new Date(start - 1).toISOString().slice(0, 7);
}

export function daysInPeriod(period: string): number {
  const { start, end } = monthWindow(period);
  return Math.round((end - start) / DAY);
}

/** Where the invoice data stops: the latest end of a non-tax line, kept inside the month and not after now. */
export function coverageEnd(items: InvoiceItem[], period: string, now: number): number {
  const { start, end } = monthWindow(period);
  const ends = items.filter((i) => i.product !== TAX_PRODUCT).map((i) => ms(i.end)).filter((t): t is number => t !== undefined);
  const latest = ends.length ? Math.max(...ends) : now;
  return Math.max(start, Math.min(latest, end, now));
}

/** The newest UTC day that is complete in the data: the day before the one coverage ends in. */
export function lastFullDay(coverage: number): string {
  return dayString(Math.floor(coverage / DAY) * DAY - DAY);
}

export function dailyByDescription(points: InsightPoint[], date: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const p of points) if (p.date === date) out.set(p.description, (out.get(p.description) ?? 0) + p.amount);
  return out;
}

/** Hourly rate, whether it is still running and the projected month total, for each invoice line. */
export function costLines(items: InvoiceItem[], options: { period: string; now: number; insights: InsightPoint[] }): { lines: LineCost[]; coverage: number; hoursLeft: number; lastDay: string } {
  const coverage = coverageEnd(items, options.period, options.now);
  const hoursLeft = Math.max(0, (monthWindow(options.period).end - coverage) / HOUR);
  const lastDay = lastFullDay(coverage);
  const daily = dailyByDescription(options.insights, lastDay);

  const lines = items.map((item): LineCost => {
    const isTax = item.product === TAX_PRODUCT;
    const start = ms(item.start);
    const end = ms(item.end);
    const windowHours = start !== undefined && end !== undefined && end > start ? (end - start) / HOUR : 0;

    let rate = 0;
    let rateSource: LineCost["rateSource"] = "none";
    if (!isTax && item.amount > 0) {
      const hoursAgree = /^hours?$/i.test(item.durationUnit) && item.duration > 0 && windowHours > 0 && Math.abs(item.duration - windowHours) <= 2;
      const lastDayCharge = daily.get(item.description) ?? 0;
      if (hoursAgree) {
        rate = item.amount / item.duration;
        rateSource = "hours";
      } else if (lastDayCharge > 0) {
        rate = lastDayCharge / 24;
        rateSource = "daily";
      } else if (windowHours > 0) {
        rate = item.amount / windowHours;
        rateSource = "window";
      }
    }

    // Daily charges land once a day, so their last line can end up to a day before coverage while still running.
    const slack = rateSource === "daily" ? DAY + HOUR : HOUR;
    const running = !isTax && rate > 0 && end !== undefined && end >= coverage - slack;
    const projected = running ? Math.max(item.amount, Math.min(item.amount + rate * hoursLeft, rate * HOURS_CAP)) : item.amount;
    return { ...item, rate, rateSource, running, projected, isTax };
  });

  // Tax follows everything else at the rate seen so far.
  const pretax = sum(lines.filter((l) => !l.isTax).map((l) => l.amount));
  const projectedPretax = sum(lines.filter((l) => !l.isTax).map((l) => l.projected));
  const tax = sum(lines.filter((l) => l.isTax).map((l) => l.amount));
  const taxRate = pretax > 0 ? tax / pretax : 0;
  const projectedTax = Math.max(tax, projectedPretax * taxRate);
  for (const l of lines) if (l.isTax) l.projected = tax > 0 ? (l.amount / tax) * projectedTax : 0;

  return { lines, coverage, hoursLeft, lastDay };
}

export function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

function groupBy(lines: LineCost[], key: (l: LineCost) => string): Group[] {
  const groups = new Map<string, Group>();
  for (const l of lines) {
    const name = key(l);
    const g = groups.get(name) ?? { name, amount: 0, projected: 0, count: 0 };
    g.amount += l.amount;
    g.projected += l.projected;
    g.count += 1;
    groups.set(name, g);
  }
  return [...groups.values()].sort((a, b) => b.projected - a.projected || b.amount - a.amount || a.name.localeCompare(b.name));
}

const NODE_LINE = /^\d+ nodes? - /;

/** A node line that stopped while a differently sized one started (within two hours): the pool was resized. */
export function nodeChanges(clusterLines: LineCost[]): NodeChange[] {
  const nodes = clusterLines.filter((l) => NODE_LINE.test(l.description));
  const changes: NodeChange[] = [];
  for (const before of nodes) {
    const ended = ms(before.end);
    if (before.running || ended === undefined) continue;
    for (const after of nodes) {
      const started = ms(after.start);
      if (after === before || after.description === before.description || started === undefined) continue;
      if (Math.abs(started - ended) <= 2 * HOUR) changes.push({ at: after.start!, from: before.description, to: after.description });
    }
  }
  return changes.sort((a, b) => a.at.localeCompare(b.at));
}

/** Everything the headline, breakdowns and line-item table need. `clusterName` is the cluster's DigitalOcean name. */
export function summarizeSpend(items: InvoiceItem[], options: { period: string; now: number; insights: InsightPoint[]; clusterName?: string }): SpendSummary {
  const { lines, coverage, hoursLeft, lastDay } = costLines(items, options);
  const billable = lines.filter((l) => !l.isTax);
  const taxLines = lines.filter((l) => l.isTax);
  const inCluster = (l: LineCost) => (options.clusterName ? l.groupDescription === options.clusterName : l.product === "Kubernetes Clusters");
  const pretax = sum(billable.map((l) => l.amount));
  const tax = sum(taxLines.map((l) => l.amount));
  const projectedPretax = sum(billable.map((l) => l.projected));
  const projectedTax = sum(taxLines.map((l) => l.projected));
  const whole = (name: string, part: LineCost[]): Group => ({ name, amount: sum(part.map((l) => l.amount)), projected: sum(part.map((l) => l.projected)), count: part.length });

  return {
    period: options.period,
    coverageEnd: new Date(coverage).toISOString(),
    hoursLeft,
    lastFullDay: lastDay,
    itemisedTotal: pretax + tax,
    pretax,
    tax,
    taxRate: pretax > 0 ? tax / pretax : 0,
    projectedPretax,
    projectedTax,
    projectedTotal: projectedPretax + projectedTax,
    burnPerHour: sum(billable.filter((l) => l.running).map((l) => l.rate)),
    lines: [...lines].sort((a, b) => b.projected - a.projected || b.amount - a.amount),
    byProduct: groupBy(lines, (l) => l.product),
    byProject: groupBy(billable, (l) => l.projectName ?? "No project"),
    cluster: whole(options.clusterName ?? "Kubernetes", billable.filter(inCluster)),
    other: whole("Everything else", billable.filter((l) => !inCluster(l))),
    nodeChanges: nodeChanges(billable.filter(inCluster)),
  };
}

export interface DayAmount {
  date: string;
  amount: number;
}

/** Spend per UTC day of the month from Billing Insights, up to and including `lastDay` (all days when omitted). */
export function dailySeries(points: InsightPoint[], period: string, lastDay?: string): DayAmount[] {
  const totals = new Map<string, number>();
  for (const p of points) if (p.date.startsWith(`${period}-`)) totals.set(p.date, (totals.get(p.date) ?? 0) + p.amount);
  const { start } = monthWindow(period);
  const out: DayAmount[] = [];
  for (let d = 0; d < daysInPeriod(period); d += 1) {
    const date = dayString(start + d * DAY);
    if (lastDay && date > lastDay) break;
    out.push({ date, amount: totals.get(date) ?? 0 });
  }
  return out;
}

export function cumulative(values: number[]): number[] {
  let running = 0;
  return values.map((v) => (running += v));
}

/**
 * Like-for-like: this month's first N days against the same N days of last month (N = days with data this month).
 * Fair where "projected month vs last month's invoice" is not. Null without data. When last month is shorter, its
 * own days are all counted.
 */
export function sameDaysComparison(current: DayAmount[], previous: DayAmount[]): { days: number; current: number; previous: number; previousDays: number } | null {
  if (current.length === 0 || previous.length === 0) return null;
  const days = current.length;
  const previousDays = Math.min(days, previous.length);
  return {
    days,
    current: current.reduce((a, d) => a + d.amount, 0),
    previous: previous.slice(0, previousDays).reduce((a, d) => a + d.amount, 0),
    previousDays,
  };
}

/** What was billed on one UTC day (Billing Insights), biggest first, with zero lines left out. */
export function dayBreakdown(points: InsightPoint[], date: string): { description: string; amount: number }[] {
  const byDesc = dailyByDescription(points, date);
  return [...byDesc.entries()]
    .filter(([, amount]) => amount !== 0)
    .map(([description, amount]) => ({ description, amount }))
    .sort((a, b) => b.amount - a.amount || a.description.localeCompare(b.description));
}
