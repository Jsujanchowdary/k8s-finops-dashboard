import { describe, expect, it } from "vitest";
import { dayLabel, niceTicks, periodLabel, signedPercent, usd, usdRate, usdShort, utcTime } from "./format";

describe("money formatting", () => {
  it("formats dollars to the cent and never hides tiny charges as free", () => {
    expect(usd(1234.5)).toBe("$1,234.50");
    expect(usd(0)).toBe("$0.00");
    expect(usd(0.001)).toBe("<$0.01");
    expect(usd(-112.01)).toBe("-$112.01");
    expect(usd(null)).toBe("—");
    expect(usd(Number.NaN)).toBe("—");
  });

  it("keeps four decimals for hourly rates", () => {
    expect(usdRate(0.14286)).toBe("$0.1429");
    expect(usdRate(0.00001)).toBe("<$0.0001");
    expect(usdRate(0)).toBe("$0.0000");
  });

  it("writes short axis labels", () => {
    expect(usdShort(0)).toBe("$0");
    expect(usdShort(150)).toBe("$150");
    expect(usdShort(2.5)).toBe("$2.50");
    expect(usdShort(1500)).toBe("$1.5K");
    expect(usdShort(2000)).toBe("$2K");
  });

  it("signs percentage changes", () => {
    expect(signedPercent(286, 137.99)).toBe("+107%");
    expect(signedPercent(90, 100)).toBe("−10%");
    expect(signedPercent(100, 100)).toBe("0%");
    expect(signedPercent(1, 0)).toBe("—");
  });
});

describe("dates", () => {
  it("labels periods and days in UTC", () => {
    expect(periodLabel("2026-09")).toBe("Sep 2026");
    expect(periodLabel("2026-10", true)).toBe("October 2026");
    expect(dayLabel("2026-10-07")).toBe("7 Oct");
    expect(dayLabel("2026-10-07T23:30:00Z")).toBe("7 Oct");
    expect(utcTime("2026-10-13T04:10:49Z")).toBe("13 Oct, 04:10 UTC");
    expect(utcTime(undefined)).toBe("—");
  });
});

describe("axis ticks", () => {
  it("rounds to clean steps that cover the maximum", () => {
    expect(niceTicks(137.6)).toEqual([0, 50, 100, 150]);
    expect(niceTicks(100)).toEqual([0, 25, 50, 75, 100]);
    expect(niceTicks(9.45)).toEqual([0, 2.5, 5, 7.5, 10]);
    expect(niceTicks(0)).toEqual([0, 1]);
  });
});
