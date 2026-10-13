import { describe, expect, it } from "vitest";
import { parseBytes, parseCpu, parseQuantity } from "./quantity";

describe("parseQuantity", () => {
  it("parses cpu", () => {
    expect(parseCpu("500m")).toBeCloseTo(0.5);
    expect(parseCpu("2")).toBe(2);
    expect(parseCpu("1.5")).toBe(1.5);
    expect(parseCpu("250000n")).toBeCloseTo(0.00025);
    expect(parseCpu("100u")).toBeCloseTo(0.0001);
  });

  it("parses memory with binary and decimal suffixes", () => {
    expect(parseBytes("512Mi")).toBe(512 * 1024 ** 2);
    expect(parseBytes("1Gi")).toBe(1024 ** 3);
    expect(parseBytes("16322340Ki")).toBe(16322340 * 1024);
    expect(parseBytes("1G")).toBe(1e9);
    expect(parseBytes("128974848")).toBe(128974848);
    expect(parseBytes("12e6")).toBe(12e6);
  });

  it("returns 0 for empty or invalid input", () => {
    expect(parseQuantity(undefined)).toBe(0);
    expect(parseQuantity(null)).toBe(0);
    expect(parseQuantity("")).toBe(0);
    expect(parseQuantity("abc")).toBe(0);
    expect(parseQuantity("5Xi")).toBe(0);
  });
});
