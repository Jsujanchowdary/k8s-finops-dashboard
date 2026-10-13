import { describe, expect, it } from "vitest";
import { isLocalRequest, parseLogParams } from "./params";

const q = (s: string) => new URLSearchParams(s);
const headers = (h: Record<string, string>) => ({ get: (n: string) => h[n.toLowerCase()] ?? null });

describe("parseLogParams", () => {
  it("accepts a normal request with defaults", () => {
    expect(parseLogParams("do-dms-staging", "api-7c9-abcde", q("container=dms-api"))).toEqual({
      ok: true,
      value: { namespace: "do-dms-staging", pod: "api-7c9-abcde", container: "dms-api", tailLines: 200, previous: false, sinceTime: undefined },
    });
  });
  it("reads tail, previous and since", () => {
    const r = parseLogParams("ns", "pod", q("container=app&tail=500&previous=1&since=2026-10-08T10:00:00.123456789Z"));
    expect(r).toMatchObject({ ok: true, value: { tailLines: 500, previous: true, sinceTime: "2026-10-08T10:00:00.123456789Z" } });
  });
  it("rejects anything that could change the request path or query", () => {
    for (const [ns, pod, search] of [
      ["../kube-system", "pod", "container=app"],
      ["ns", "pod/../../secrets", "container=app"],
      ["ns", "pod", "container=app/../x"],
      ["ns", "pod", "container=app%0d%0a"],
      ["ns", "POD", "container=app"],
      ["ns", "pod", ""],
      ["ns", "pod", "container=app&tail=999999"],
      ["ns", "pod", "container=app&tail=-1"],
      ["ns", "pod", "container=app&tail=abc"],
      ["ns", "pod", "container=app&since=yesterday"],
    ] as const) {
      expect(parseLogParams(ns, pod, q(search)).ok, `${ns} ${pod} ${search}`).toBe(false);
    }
  });
});

describe("isLocalRequest", () => {
  it("allows local hosts and same-origin requests", () => {
    expect(isLocalRequest(headers({ host: "127.0.0.1:3000" }))).toBe(true);
    expect(isLocalRequest(headers({ host: "localhost:3000", origin: "http://localhost:3000", "sec-fetch-site": "same-origin" }))).toBe(true);
  });
  it("rejects other hosts, cross-site origins and cross-site fetches", () => {
    expect(isLocalRequest(headers({ host: "192.168.1.5:3000" }))).toBe(false);
    expect(isLocalRequest(headers({ host: "evil.example:3000" }))).toBe(false);
    expect(isLocalRequest(headers({ host: "127.0.0.1:3000", origin: "https://evil.example" }))).toBe(false);
    expect(isLocalRequest(headers({ host: "127.0.0.1:3000", "sec-fetch-site": "cross-site" }))).toBe(false);
  });
});
