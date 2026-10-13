import { describe, expect, it } from "vitest";
import { BALANCE, INSIGHTS_CURRENT, INVOICES, NOW, PREVIEW_ITEMS, SIZES } from "@/test/finops-sample";
import { money, parseBalance, parseInsights, parseInvoiceItems, parseInvoiceList, parseSizes } from "./parse";
import { costLines, coverageEnd, cumulative, dailySeries, dayBreakdown, daysInPeriod, HOURS_CAP, lastFullDay, monthWindow, previousPeriod, sameDaysComparison, summarizeSpend } from "./spend";

const items = parseInvoiceItems(PREVIEW_ITEMS).items;
const insights = parseInsights(INSIGHTS_CURRENT).points;
const options = { period: "2026-10", now: NOW, insights, clusterName: "wldd" };
const byDesc = (lines: ReturnType<typeof costLines>["lines"], prefix: string) => {
  const line = lines.find((l) => l.description.startsWith(prefix));
  if (!line) throw new Error(`no line ${prefix}`);
  return line;
};

describe("parsing", () => {
  it("reads money and counts that DigitalOcean sends as strings", () => {
    expect(money("41.14")).toBe(41.14);
    expect(money("-0.50")).toBe(-0.5);
    expect(money(3)).toBe(3);
    expect(money("")).toBe(0);
    expect(money("abc")).toBe(0);
    expect(money(undefined)).toBe(0);
  });

  it("parses the balance, invoices, items, insights and sizes", () => {
    expect(parseBalance(BALANCE)).toEqual({ monthToDateUsage: 111.51, accountBalance: -112.01, generatedAt: "2026-10-13T04:10:49Z" });
    expect(parseBalance({})).toBeNull();
    const list = parseInvoiceList(INVOICES);
    expect(list.preview).toMatchObject({ period: "2026-10", amount: 109.16, accountUrn: "do:team:2383b506-3ce5-4552-b51f-fe432dc29d93" });
    expect(list.invoices.map((i) => i.period)).toEqual(["2026-09", "2026-08"]);
    expect(items).toHaveLength(13);
    expect(items.find((i) => i.product === "Droplets")).toMatchObject({ amount: 41.14, duration: 288, projectName: "Transition" });
    expect(parseInsights(INSIGHTS_CURRENT).totalPages).toBe(1);
    expect(parseSizes(SIZES).find((s) => s.slug === "s-8vcpu-16gb")).toEqual({ slug: "s-8vcpu-16gb", priceHourly: 0.14286, priceMonthly: 96, vcpus: 8, memoryMb: 16384 });
  });

  it("survives empty or malformed answers", () => {
    expect(parseInvoiceList(null)).toEqual({ preview: undefined, invoices: [] });
    expect(parseInvoiceItems({ invoice_items: "nope" })).toEqual({ items: [], total: 0 });
    expect(parseInsights({ data_points: [{ start_date: "bad" }] }).points).toEqual([]);
    expect(parseSizes(undefined)).toEqual([]);
  });
});

describe("billing calendar", () => {
  it("uses UTC month windows", () => {
    expect(monthWindow("2026-10")).toEqual({ start: Date.UTC(2026, 9, 1), end: Date.UTC(2026, 10, 1) });
    expect(previousPeriod("2026-10")).toBe("2026-09");
    expect(previousPeriod("2026-01")).toBe("2025-12");
    expect(daysInPeriod("2026-02")).toBe(28);
    expect(daysInPeriod("2026-10")).toBe(31);
  });

  it("finds where the invoice stops (ignoring tax, which is dated to the month end) and the last full day", () => {
    const coverage = coverageEnd(items, "2026-10", NOW);
    expect(new Date(coverage).toISOString()).toBe("2026-10-13T00:00:00.000Z");
    expect(lastFullDay(coverage)).toBe("2026-10-12");
    expect(lastFullDay(Date.parse("2026-10-13T05:00:00Z"))).toBe("2026-10-12");
    // Never after now, never outside the month.
    expect(coverageEnd(items, "2026-10", Date.parse("2026-10-10T00:00:00Z"))).toBe(Date.parse("2026-10-10T00:00:00Z"));
    expect(coverageEnd([], "2026-10", Date.parse("2026-12-01T00:00:00Z"))).toBe(Date.UTC(2026, 10, 1));
  });
});

describe("hourly rates and the month-end projection", () => {
  const { lines, hoursLeft } = costLines(items, options);

  it("has 19 days (456 hours) left after the 13th", () => {
    expect(hoursLeft).toBe(456);
  });

  it("takes the rate from billed hours when they match the line's time window", () => {
    const node = byDesc(lines, "1 node - 16 GB");
    expect(node.rateSource).toBe("hours");
    expect(node.rate).toBeCloseTo(19.62 / 137, 10);
    // The API's list price for s-8vcpu-16gb is $0.14286/h: the invoice agrees.
    expect(node.rate).toBeCloseTo(0.14286, 3);
    expect(node.running).toBe(true);
    expect(node.projected).toBeCloseTo(19.62 + (19.62 / 137) * 456, 6);
  });

  it("uses the last full day for daily-billed lines whose duration is not hours (backups)", () => {
    const backups = byDesc(lines, "server-001 (Daily");
    expect(backups.rateSource).toBe("daily");
    expect(backups.rate).toBeCloseTo(1.03 / 24, 10);
    expect(backups.running).toBe(true);
    // Capped at 672 hours: 30% of a $96 Droplet = $28.84.
    expect(backups.projected).toBeCloseTo((1.03 / 24) * HOURS_CAP, 6);
  });

  it("never projects a resource above its monthly price (672 hours)", () => {
    const droplet = byDesc(lines, "server-001 (s-8vcpu");
    expect(droplet.projected).toBeCloseTo((41.14 / 288) * 672, 6);
    expect(droplet.projected).toBeCloseTo(96, 0);
    const lb = byDesc(lines, "ac4cbf57");
    expect(lb.projected).toBeCloseTo((6.43 / 288) * 672, 6);
  });

  it("does not project a resource that stopped (the old node)", () => {
    const old = byDesc(lines, "1 node - 8 GB");
    expect(old.running).toBe(false);
    expect(old.projected).toBe(10.82);
  });

  it("keeps free lines at zero", () => {
    expect(byDesc(lines, "infisical").projected).toBe(0);
    expect(byDesc(lines, "Spaces Bandwidth").rate).toBe(0);
  });

  it("projects tax at the rate seen so far", () => {
    const tax = byDesc(lines, "GST");
    const pretax = lines.filter((l) => !l.isTax);
    const rate = 16.65 / pretax.reduce((a, l) => a + l.amount, 0);
    expect(tax.projected).toBeCloseTo(pretax.reduce((a, l) => a + l.projected, 0) * rate, 6);
  });
});

describe("summary", () => {
  const s = summarizeSpend(items, options);

  it("adds up to the invoice", () => {
    expect(s.itemisedTotal).toBeCloseTo(108.79, 2);
    expect(s.pretax).toBeCloseTo(92.14, 2);
    expect(s.tax).toBe(16.65);
    expect(s.taxRate).toBeCloseTo(16.65 / 92.14, 10);
  });

  it("projects the month from the resources still running", () => {
    const expected =
      (41.14 / 288) * 672 + // server-001, capped
      (1.03 / 24) * 672 + // its backups, capped
      10.82 + // old node, stopped
      19.62 + (19.62 / 137) * 456 + // new node
      (6.43 / 288) * 672 + // load balancer, capped
      ((0.04 + 0.43 + 0.34) / 288) * 672 + // volumes, capped
      0.97 + (0.97 / 131) * 456 + // Spaces
      0.01 + (0.01 / 137) * 456; // snapshot
    expect(s.projectedPretax).toBeCloseTo(expected, 6);
    expect(s.projectedTotal).toBeCloseTo(expected * (1 + 16.65 / 92.14), 6);
    expect(s.projectedTotal).toBeGreaterThan(280);
    expect(s.projectedTotal).toBeLessThan(290);
  });

  it("splits the cluster from everything else by the cluster's DigitalOcean name", () => {
    expect(s.cluster.amount).toBeCloseTo(0.04 + 0.43 + 0.34 + 6.43 + 10.82 + 19.62, 6);
    expect(s.other.amount).toBeCloseTo(41.14 + 12.34 + 0.97 + 0.01, 6);
    expect(s.cluster.amount + s.other.amount).toBeCloseTo(s.pretax, 6);
  });

  it("groups by product and project, biggest first", () => {
    // Ordered by the projected month: the cluster ($112.64) overtakes the Droplet ($96) by month end.
    expect(s.byProduct.slice(0, 3).map((g) => g.name)).toEqual(["Kubernetes Clusters", "Droplets", "Taxes"]);
    expect(s.byProduct.find((g) => g.name === "Kubernetes Clusters")?.count).toBe(6);
    expect(s.byProject.map((g) => g.name)).toEqual(["Transition", "WLDD", "No project"]);
    expect(s.byProject.reduce((a, g) => a + g.amount, 0)).toBeCloseTo(s.pretax, 6);
  });

  it("burn rate is the sum of what is still running", () => {
    expect(s.burnPerHour).toBeCloseTo(41.14 / 288 + 1.03 / 24 + 19.62 / 137 + 6.43 / 288 + 0.81 / 288 + 0.97 / 131 + 0.01 / 137, 6);
  });

  it("notices the node pool resize", () => {
    expect(s.nodeChanges).toEqual([{ at: "2026-10-07T06:39:27Z", from: "1 node - 8 GB / 4 vCPU / 160 GB SSD", to: "1 node - 16 GB / 8 vCPU / 320 GB SSD" }]);
  });

  it("without the cluster's name, falls back to the Kubernetes product", () => {
    const fallback = summarizeSpend(items, { ...options, clusterName: undefined });
    expect(fallback.cluster.amount).toBeCloseTo(s.cluster.amount, 6);
  });
});

describe("daily series", () => {
  it("fills every day up to the last full day, with zeros where nothing was billed", () => {
    const days = dailySeries(insights, "2026-10", "2026-10-12");
    expect(days).toHaveLength(12);
    expect(days[0]).toEqual({ date: "2026-10-01", amount: 3.43 + 1.71 + 1.23 });
    expect(days[5]).toEqual({ date: "2026-10-06", amount: 0 });
    expect(days[11].amount).toBeCloseTo(3.43 + 1.03 + 3.43 + 1.56, 10);
  });

  it("covers the whole month when no last day is given", () => {
    expect(dailySeries([], "2026-09")).toHaveLength(30);
  });

  it("accumulates", () => {
    expect(cumulative([1, 2, 3])).toEqual([1, 3, 6]);
  });
});

describe("same days last month", () => {
  const day = (date: string, amount: number) => ({ date, amount });
  it("compares this month's days with the same number of days last month", () => {
    const current = [day("2026-10-01", 8), day("2026-10-02", 9), day("2026-10-03", 10)];
    const previous = [day("2026-09-01", 1), day("2026-09-02", 2), day("2026-09-03", 3), day("2026-09-04", 100)];
    expect(sameDaysComparison(current, previous)).toEqual({ days: 3, current: 27, previous: 6, previousDays: 3 });
  });

  it("counts all of a shorter last month, and says so", () => {
    const current = Array.from({ length: 30 }, (_, i) => day(`2026-03-${String(i + 1).padStart(2, "0")}`, 1));
    const previous = Array.from({ length: 28 }, (_, i) => day(`2026-02-${String(i + 1).padStart(2, "0")}`, 2));
    expect(sameDaysComparison(current, previous)).toEqual({ days: 30, current: 30, previous: 56, previousDays: 28 });
  });

  it("is null without data", () => {
    expect(sameDaysComparison([], [day("2026-09-01", 1)])).toBeNull();
    expect(sameDaysComparison([day("2026-10-01", 1)], [])).toBeNull();
  });
});

describe("one day's breakdown", () => {
  it("lists what was billed that day, biggest first, without zero lines", () => {
    expect(dayBreakdown(insights, "2026-10-12")).toEqual([
      { description: "1 node - 16 GB / 8 vCPU / 320 GB SSD", amount: 3.43 },
      { description: "server-001 (s-8vcpu-16gb)", amount: 3.43 },
      { description: "GST India (18.00%)", amount: 1.56 },
      { description: "server-001 (Daily Backup Services)", amount: 1.03 },
    ]);
    expect(dayBreakdown(insights, "2026-10-05")).toEqual([]);
  });
});
