import { describe, expect, it } from "vitest";
import { INSIGHTS_CURRENT, NOW, PREVIEW_ITEMS } from "@/test/finops-sample";
import { explainLine } from "./explain";
import { parseInsights, parseInvoiceItems } from "./parse";
import { summarizeSpend } from "./spend";

const s = summarizeSpend(parseInvoiceItems(PREVIEW_ITEMS).items, { period: "2026-10", now: NOW, insights: parseInsights(INSIGHTS_CURRENT).points, clusterName: "wldd" });
const ctx = { hoursLeft: s.hoursLeft, lastDay: s.lastFullDay, taxRate: s.taxRate, projectedPretax: s.projectedPretax };
const line = (prefix: string) => s.lines.find((l) => l.description.startsWith(prefix))!;

describe("explainLine", () => {
  it("shows the rate from billed hours, and the 672 h cap when it applies (server-001)", () => {
    const e = explainLine(line("server-001 (s-8vcpu"), ctx);
    expect(e.rate).toBe("Rate = $41.14 so far ÷ 288 h billed = $0.1428/h");
    expect(e.projected).toBe("Projected = the lower of $41.14 + $0.1428 × 456 h left = $106.28, and the 672 h monthly cap $0.1428 × 672 = $95.99. The cap applies: $95.99.");
    expect(e.note).toBeUndefined();
  });

  it("shows the plain projection when the cap does not apply (the new node)", () => {
    expect(explainLine(line("1 node - 16 GB"), ctx).projected).toBe("Projected = $19.62 + $0.1432 × 456 h left = $84.92 (under the 672 h cap of $96.24).");
  });

  it("explains why backups use the last day's charge", () => {
    const e = explainLine(line("server-001 (Daily"), ctx);
    expect(e.rate).toBe("Rate = $1.03 charged on 2026-10-12 (the last full day) ÷ 24 = $0.0429/h");
    expect(e.note).toContain('"12 Hours"');
    expect(e.note).toContain("counts days");
  });

  it("says a stopped resource stays at what it cost (the old node)", () => {
    expect(explainLine(line("1 node - 8 GB"), ctx).projected).toBe("Stopped on 2026-10-07, so it stays at $10.82 for the month.");
  });

  it("explains tax as a percentage of everything else", () => {
    const e = explainLine(line("GST"), ctx);
    expect(e.rate).toBe("Tax is not billed by the hour: it is 18.1% of everything else ($16.65 so far).");
    expect(e.projected).toMatch(/^Projected tax = \$241\.\d\d projected before tax × 18\.1% = \$43\.\d\d$/);
  });

  it("says free lines are free", () => {
    expect(explainLine(line("infisical"), ctx)).toEqual({ rate: "Free: nothing is charged for this line.", projected: "Stays at $0.00 for the month." });
  });
});
