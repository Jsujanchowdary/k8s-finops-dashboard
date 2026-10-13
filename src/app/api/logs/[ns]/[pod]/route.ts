import { selectedCluster } from "@/lib/clusters/registry";
import { logsEnabled } from "@/lib/config";
import { openPodLog } from "@/lib/k8s/logs";
import { createLimiter } from "@/lib/logs/limiter";
import { isLocalRequest, parseLogParams } from "@/lib/logs/params";
import { runLogStream, type LogLine, type StreamEnd } from "@/lib/logs/stream-core";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_OPEN_STREAMS = 5;
const HEARTBEAT_MS = 15_000;

// One limiter per server process, kept across dev hot reloads.
const globalState = globalThis as unknown as { __logLimiter?: ReturnType<typeof createLimiter> };
const limiter = (globalState.__logLimiter ??= createLimiter(MAX_OPEN_STREAMS));

const json = (status: number, error: string) =>
  new Response(JSON.stringify({ error }), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

/**
 * GET /api/logs/<namespace>/<pod>?container=<name>&tail=200&previous=0&since=<rfc3339>
 * Streams one container's logs as Server-Sent Events. Nothing is stored. When the browser goes away
 * the request is aborted, and that stops the stream to the cluster.
 */
export async function GET(request: Request, context: { params: Promise<{ ns: string; pod: string }> }) {
  if (!logsEnabled()) return json(403, "Live logs are turned off (ENABLE_LOGS=false).");
  if (!isLocalRequest(request.headers)) return json(403, "Logs can only be opened from this machine.");

  const { ns, pod } = await context.params;
  const parsed = parseLogParams(ns, pod, new URL(request.url).searchParams);
  if (!parsed.ok) return json(400, parsed.error);
  const params = parsed.value;

  // The cluster this browser is looking at (its cookie), so logs come from the same cluster as the page.
  const cluster = await selectedCluster();
  if (!cluster) return json(503, "No cluster is connected yet. Add one in Settings.");

  const release = limiter.acquire();
  if (!release) return json(429, `Too many open log streams (the limit is ${MAX_OPEN_STREAMS}). Stop one and try again.`);

  const label = `${cluster.summary.name}:${params.namespace}/${params.pod}/${params.container}`;
  console.info(`[logs] open  ${label} tail=${params.tailLines}${params.previous ? " previous" : ""}`);

  const encoder = new TextEncoder();
  let stop: (() => void) | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let lineCount = 0;
  let cleaned = false;

  const cleanup = (reason: string) => {
    if (cleaned) return;
    cleaned = true;
    if (heartbeat) clearInterval(heartbeat);
    release();
    console.info(`[logs] close ${label} reason=${reason} lines=${lineCount}`);
  };

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          /* the browser already left */
        }
      };

      send("status", { state: "connected" });
      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          /* closed */
        }
      }, HEARTBEAT_MS);

      const run = runLogStream(
        openPodLog({ namespace: params.namespace, pod: params.pod, container: params.container, tailLines: params.tailLines, previous: params.previous, sinceTime: params.sinceTime }, cluster.kc),
        {
          onLine: (line: LogLine) => {
            lineCount += 1;
            send("line", line);
          },
          onNotice: (message: string) => send("notice", { message }),
          onEnd: (reason: StreamEnd, message?: string) => {
            if (reason !== "stopped") send("status", { state: reason, message });
            cleanup(reason);
            try {
              controller.close();
            } catch {
              /* already closed or cancelled */
            }
          },
        },
      );
      stop = run.stop;

      // The browser closed the page, the tab, or pressed Stop: end the stream to the cluster.
      request.signal.addEventListener("abort", () => run.stop(), { once: true });
    },
    cancel() {
      stop?.();
      cleanup("client-cancelled");
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}

