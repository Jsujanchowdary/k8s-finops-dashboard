import { describe, expect, it } from "vitest";
import { isReadOnlyMethod, readOnlyClient, withTimeout } from "./readonly";

class FakeApi {
  value = 7;
  listPods() { return this.value; }
  readNamespace() { return this.value + 1; }
  getCode() { return this.value + 2; }
  createNamespacedPod() { return "created"; }
  deleteNamespacedPod() { return "deleted"; }
  patchNode() { return "patched"; }
  replaceNode() { return "replaced"; }
}

describe("readOnlyClient", () => {
  const api = readOnlyClient(new FakeApi());
  it("allows list/read/get with the right this", () => {
    expect(api.listPods()).toBe(7);
    expect(api.readNamespace()).toBe(8);
    expect(api.getCode()).toBe(9);
  });
  it("blocks anything else", () => {
    expect(() => api.createNamespacedPod()).toThrow(/Blocked/);
    expect(() => api.deleteNamespacedPod()).toThrow(/Blocked/);
    expect(() => api.patchNode()).toThrow(/Blocked/);
    expect(() => api.replaceNode()).toThrow(/Blocked/);
  });
  it("classifies names", () => {
    expect(isReadOnlyMethod("listNode")).toBe(true);
    expect(isReadOnlyMethod("deleteNode")).toBe(false);
  });
});

describe("withTimeout", () => {
  it("rejects slow calls", async () => {
    await expect(withTimeout(new Promise(() => {}), 20, "slow")).rejects.toThrow(/timed out/);
  });
  it("passes fast calls through", async () => {
    await expect(withTimeout(Promise.resolve(5), 100, "fast")).resolves.toBe(5);
  });
});
