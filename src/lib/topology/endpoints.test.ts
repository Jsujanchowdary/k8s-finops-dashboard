import { describe, expect, it } from "vitest";
import { bareHost, extractEndpoints, isLocalHost, serviceFromHost } from "./endpoints";

describe("extractEndpoints", () => {
  it("keeps only scheme, host and port, and drops the credentials", () => {
    const found = extractEndpoints("mongodb+srv://admin:s3cret!pass@cluster0.ab12c.mongodb.net/dms?retryWrites=true");
    expect(found).toEqual([{ scheme: "mongodb+srv", host: "cluster0.ab12c.mongodb.net", port: undefined }]);
    expect(JSON.stringify(found)).not.toMatch(/s3cret|admin/);
  });

  it("reads the port and finds several URLs in one value", () => {
    const found = extractEndpoints("http://api.ns.svc.cluster.local:3001/v1/ and redis://cache:6379/0");
    expect(found).toEqual([
      { scheme: "http", host: "api.ns.svc.cluster.local", port: 3001 },
      { scheme: "redis", host: "cache", port: 6379 },
    ]);
  });

  it("does not take an @ inside the query string for credentials", () => {
    expect(extractEndpoints("https://example.com?mail=a@b.co")[0].host).toBe("example.com");
  });

  it("ignores schemes it does not know and plain text", () => {
    expect(extractEndpoints("file:///etc/passwd")).toEqual([]);
    expect(extractEndpoints("production")).toEqual([]);
  });
});

describe("bareHost and serviceFromHost", () => {
  it("parses a host with an optional port", () => {
    expect(bareHost("redis:6379")).toEqual({ host: "redis", port: 6379 });
    expect(bareHost("Redis.Cache.svc")).toEqual({ host: "redis.cache.svc", port: undefined });
    expect(bareHost("not a host")).toBeNull();
    expect(bareHost("http://x")).toBeNull();
  });

  it("maps cluster DNS names to a Service", () => {
    expect(serviceFromHost("redis", "app")).toEqual({ name: "redis", namespace: "app" });
    expect(serviceFromHost("redis.cache", "app")).toEqual({ name: "redis", namespace: "cache" });
    expect(serviceFromHost("redis.cache.svc", "app")).toEqual({ name: "redis", namespace: "cache" });
    expect(serviceFromHost("redis.cache.svc.cluster.local", "app")).toEqual({ name: "redis", namespace: "cache" });
    expect(serviceFromHost("rabbitmq-server-0.rabbitmq-nodes.rabbitmq.svc.cluster.local", "app")).toEqual({ name: "rabbitmq-nodes", namespace: "rabbitmq" });
    expect(serviceFromHost("a.b.example.com", "app")).toBeNull();
  });

  it("recognises local hosts", () => {
    expect(isLocalHost("localhost")).toBe(true);
    expect(isLocalHost("127.0.0.1")).toBe(true);
    expect(isLocalHost("example.com")).toBe(false);
  });
});
