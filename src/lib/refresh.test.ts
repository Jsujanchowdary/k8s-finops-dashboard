import { describe, expect, it } from "vitest";
import { parseRefreshSeconds, refreshLabel, refreshOptions } from "./refresh";

describe("parseRefreshSeconds", () => {
  it("accepts off and values from 2 seconds to an hour", () => {
    expect(parseRefreshSeconds("0")).toBe(0);
    expect(parseRefreshSeconds("2")).toBe(2);
    expect(parseRefreshSeconds(5)).toBe(5);
    expect(parseRefreshSeconds("3600")).toBe(3600);
  });
  it("rejects anything unsafe or malformed", () => {
    for (const bad of ["1", "-5", "2.5", "abc", "", null, undefined, "3601", "1e3"]) {
      expect(parseRefreshSeconds(bad as string | null | undefined), String(bad)).toBeUndefined();
    }
  });
});

describe("refreshOptions", () => {
  it("lists the presets in order with Off first", () => {
    expect(refreshOptions()).toEqual([0, 2, 5, 10, 30, 60]);
  });
  it("adds a custom valid value once and ignores invalid ones", () => {
    expect(refreshOptions(7, 7, 5, 1, undefined)).toEqual([0, 2, 5, 7, 10, 30, 60]);
  });
});

describe("refreshLabel", () => {
  it("is human friendly", () => {
    expect(refreshLabel(0)).toBe("Off");
    expect(refreshLabel(5)).toBe("5s");
    expect(refreshLabel(60)).toBe("1 min");
    expect(refreshLabel(120)).toBe("2 min");
  });
});
