import { describe, expect, it } from "vitest";
import { createLimiter } from "./limiter";

describe("createLimiter", () => {
  it("refuses beyond the cap and frees slots on release", () => {
    const limiter = createLimiter(2);
    const a = limiter.acquire();
    const b = limiter.acquire();
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(limiter.acquire()).toBeNull();
    a!();
    expect(limiter.active).toBe(1);
    expect(limiter.acquire()).not.toBeNull();
  });

  it("ignores double release", () => {
    const limiter = createLimiter(1);
    const release = limiter.acquire()!;
    release();
    release();
    expect(limiter.active).toBe(0);
    expect(limiter.acquire()).not.toBeNull();
    expect(limiter.acquire()).toBeNull();
  });
});
