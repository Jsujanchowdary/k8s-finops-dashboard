import { describe, expect, it } from "vitest";
import { formatCpu, formatDay, relativeDays } from "./format";

describe("formatCpu", () => {
  it("shows millicores, and never rounds a working pod down to 0m", () => {
    expect(formatCpu(0)).toBe("0");
    expect(formatCpu(0.0004)).toBe("<1m");
    expect(formatCpu(0.0005)).toBe("1m");
    expect(formatCpu(0.1)).toBe("100m");
    expect(formatCpu(2)).toBe("2");
    expect(formatCpu(7.88)).toBe("7.88");
    expect(formatCpu(null)).toBe("—");
  });
});

describe("dates", () => {
  it("formats days in UTC and says how far away they are", () => {
    expect(formatDay("2026-11-17T08:45:02Z")).toBe("17 Nov 2026");
    expect(formatDay("2026-11-17T23:30:00Z")).toBe("17 Nov 2026");
    expect(formatDay(undefined)).toBe("—");
    expect([relativeDays(34), relativeDays(1), relativeDays(0), relativeDays(-1), relativeDays(-3), relativeDays(null)]).toEqual(["in 34 days", "tomorrow", "today", "yesterday", "3 days ago", "—"]);
  });
});
