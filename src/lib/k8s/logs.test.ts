import http from "node:http";
import type { AddressInfo } from "node:net";
import { KubeConfig } from "@kubernetes/client-node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runLogStream, type LogLine, type StreamEnd } from "@/lib/logs/stream-core";
import { LogRequestError, openPodLog } from "./logs";

// A fake Kubernetes API server on localhost. No real cluster is involved.
let server: http.Server;
let kc: KubeConfig;
const seen: { method?: string; url?: string; auth?: string }[] = [];
const openSockets = { closed: 0, opened: 0 };

beforeAll(async () => {
  server = http.createServer((req, res) => {
    seen.push({ method: req.method, url: req.url, auth: req.headers.authorization });
    const url = new URL(req.url ?? "/", "http://x");
    const pod = url.pathname.split("/")[6];
    if (pod === "missing") {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ kind: "Status", message: 'pods "missing" not found' }));
      return;
    }
    if (pod === "waiting") {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ kind: "Status", message: 'container "app" in pod "waiting" is waiting to start: ContainerCreating' }));
      return;
    }
    if (pod === "forbidden") {
      res.writeHead(403, { "content-type": "application/json" });
      res.end(JSON.stringify({ kind: "Status", message: "forbidden" }));
      return;
    }
    res.writeHead(200, { "content-type": "text/plain" });
    openSockets.opened += 1;
    res.write("2026-10-08T10:00:00.000000001Z first line\n");
    if (url.searchParams.get("follow") === "false") {
      res.end("2026-10-08T10:00:01.000000000Z previous run line\n");
      return;
    }
    const timer = setInterval(() => res.write("2026-10-08T10:00:02.000000000Z tick password=hunter2\n"), 20);
    req.on("close", () => {
      clearInterval(timer);
      openSockets.closed += 1;
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  kc = new KubeConfig();
  kc.loadFromOptions({
    clusters: [{ name: "fake", server: `http://127.0.0.1:${port}`, skipTLSVerify: true }],
    users: [{ name: "u", token: "test-token" }],
    contexts: [{ name: "ctx", cluster: "fake", user: "u" }],
    currentContext: "ctx",
  });
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

async function waitFor(condition: () => boolean, ms = 2000) {
  const start = Date.now();
  while (!condition() && Date.now() - start < ms) await new Promise((r) => setTimeout(r, 10));
}

function collect() {
  const lines: LogLine[] = [];
  const ends: { reason: StreamEnd; message?: string }[] = [];
  return { lines, ends, events: { onLine: (l: LogLine) => lines.push(l), onNotice: () => {}, onEnd: (reason: StreamEnd, message?: string) => ends.push({ reason, message }) } };
}

describe("openPodLog against a fake Kubernetes API", () => {
  it("sends one authenticated read-only GET with the right parameters", async () => {
    seen.length = 0;
    const c = collect();
    const run = runLogStream(openPodLog({ namespace: "ns", pod: "app-1", container: "app", tailLines: 123 }, kc), c.events);
    await new Promise((r) => setTimeout(r, 120));
    run.stop();
    await run.done;
    expect(seen).toHaveLength(1);
    expect(seen[0].method).toBe("GET");
    expect(seen[0].auth).toBe("Bearer test-token");
    const url = new URL(seen[0].url!, "http://x");
    expect(url.pathname).toBe("/api/v1/namespaces/ns/pods/app-1/log");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ container: "app", follow: "true", timestamps: "true", previous: "false", tailLines: "123" });
    expect(c.lines.length).toBeGreaterThan(1);
  });

  it("streams lines exactly as the container wrote them", async () => {
    const c = collect();
    const run = runLogStream(openPodLog({ namespace: "ns", pod: "app-1", container: "app" }, kc), c.events);
    await new Promise((r) => setTimeout(r, 100));
    run.stop();
    await run.done;
    expect(c.lines.some((l) => l.msg === "tick password=hunter2")).toBe(true);
  });

  it("stopping closes the connection to the cluster and leaves no unhandled errors", async () => {
    // Let connections from earlier tests finish closing so the counters are exact.
    await waitFor(() => openSockets.opened === openSockets.closed);
    const opened = openSockets.opened;
    const c = collect();
    const run = runLogStream(openPodLog({ namespace: "ns", pod: "app-2", container: "app" }, kc), c.events);
    await waitFor(() => openSockets.opened === opened + 1 && c.lines.length > 0);
    expect(openSockets.closed).toBe(opened); // still streaming
    run.stop();
    await run.done;
    await waitFor(() => openSockets.closed === opened + 1);
    expect(openSockets.closed).toBe(opened + 1); // the cluster side saw the connection close
    expect(c.ends).toEqual([{ reason: "stopped", message: undefined }]);
  });

  it("previous-container logs do not follow and end by themselves", async () => {
    seen.length = 0;
    const c = collect();
    await runLogStream(openPodLog({ namespace: "ns", pod: "app-3", container: "app", previous: true }, kc), c.events).done;
    const url = new URL(seen[0].url!, "http://x");
    expect(url.searchParams.get("follow")).toBe("false");
    expect(url.searchParams.get("previous")).toBe("true");
    expect(c.ends[0].reason).toBe("ended");
    expect(c.lines.map((l) => l.msg)).toEqual(["first line", "previous run line"]);
  });

  it("uses sinceTime instead of tailLines when resuming", async () => {
    seen.length = 0;
    const run = runLogStream(openPodLog({ namespace: "ns", pod: "app-4", container: "app", tailLines: 50, sinceTime: "2026-10-08T10:00:00Z" }, kc), collect().events);
    await new Promise((r) => setTimeout(r, 60));
    run.stop();
    await run.done;
    const url = new URL(seen[0].url!, "http://x");
    expect(url.searchParams.get("sinceTime")).toBe("2026-10-08T10:00:00Z");
    expect(url.searchParams.has("tailLines")).toBe(false);
  });

  it("turns Kubernetes errors into readable messages", async () => {
    for (const [pod, expected] of [
      ["missing", /not found/i],
      ["waiting", /waiting to start/],
      ["forbidden", /pods\/log permission/],
    ] as const) {
      const c = collect();
      await runLogStream(openPodLog({ namespace: "ns", pod, container: "app" }, kc), c.events).done;
      expect(c.ends[0].reason).toBe("error");
      expect(c.ends[0].message).toMatch(expected);
    }
    await expect(openPodLog({ namespace: "ns", pod: "missing", container: "app" }, kc)(new AbortController().signal)).rejects.toBeInstanceOf(LogRequestError);
  });
});
