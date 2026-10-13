import { describe, expect, it } from "vitest";
import { DEFAULT_LIMITS, parseLine, runLogStream, type LogLine, type StreamEnd } from "./stream-core";

const enc = new TextEncoder();

function bodyFrom(chunks: (string | Uint8Array)[], opts: { holdOpen?: boolean; signal?: AbortSignal } = {}) {
  let i = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (i < chunks.length) {
        const c = chunks[i++];
        controller.enqueue(typeof c === "string" ? enc.encode(c) : c);
        return;
      }
      if (opts.holdOpen) {
        await new Promise<void>((resolve) => opts.signal?.addEventListener("abort", () => resolve(), { once: true }));
        controller.error(new DOMException("This operation was aborted", "AbortError"));
        return;
      }
      controller.close();
    },
  });
}

function collect() {
  const lines: LogLine[] = [];
  const notices: string[] = [];
  const ends: { reason: StreamEnd; message?: string }[] = [];
  return { lines, notices, ends, events: { onLine: (l: LogLine) => lines.push(l), onNotice: (m: string) => notices.push(m), onEnd: (reason: StreamEnd, message?: string) => ends.push({ reason, message }) } };
}

describe("parseLine", () => {
  it("splits the kubernetes timestamp from the message", () => {
    expect(parseLine("2026-10-08T10:00:00.123456789Z hello world", 100)).toEqual({ ts: "2026-10-08T10:00:00.123456789Z", msg: "hello world" });
    expect(parseLine("no timestamp here", 100)).toEqual({ ts: undefined, msg: "no timestamp here" });
  });
  it("passes the text through exactly and only truncates absurdly long lines", () => {
    expect(parseLine("2026-10-08T10:00:00Z password=hunter2 url: mongodb+srv://u:p@h/db", 100).msg).toBe("password=hunter2 url: mongodb+srv://u:p@h/db");
    const long = parseLine(`2026-10-08T10:00:00Z ${"x".repeat(50)}`, 10);
    expect(long.msg).toBe(`${"x".repeat(10)} …[truncated]`);
  });
});

describe("runLogStream", () => {
  it("splits lines across chunk boundaries and handles CRLF and a final unterminated line", async () => {
    const c = collect();
    const run = runLogStream(async () => bodyFrom(["2026-10-08T10:00:00Z one\r\n2026-10-08T10:00:01Z tw", "o\n2026-10-08T10:00:02Z three"]), c.events);
    await run.done;
    expect(c.lines.map((l) => l.msg)).toEqual(["one", "two", "three"]);
    expect(c.ends).toEqual([{ reason: "ended", message: undefined }]);
  });

  it("decodes multi-byte characters split across chunks", async () => {
    const bytes = enc.encode("2026-10-08T10:00:00Z héllo ✓\n");
    const c = collect();
    const run = runLogStream(async () => bodyFrom([bytes.slice(0, 25), bytes.slice(25)]), c.events);
    await run.done;
    expect(c.lines[0].msg).toBe("héllo ✓");
  });

  it("emits lines exactly as written, with nothing masked", async () => {
    const c = collect();
    await runLogStream(async () => bodyFrom(["2026-10-08T10:00:00Z url: mongodb+srv://u:topsecret@host/db token=abc123\n"]), c.events).done;
    expect(c.lines[0].msg).toBe("url: mongodb+srv://u:topsecret@host/db token=abc123");
  });

  it("stop() aborts the request, ends once as 'stopped' and never throws", async () => {
    const c = collect();
    let aborted = false;
    const run = runLogStream(async (signal) => {
      signal.addEventListener("abort", () => (aborted = true));
      return bodyFrom(["2026-10-08T10:00:00Z first\n"], { holdOpen: true, signal });
    }, c.events);
    await new Promise((r) => setTimeout(r, 20));
    run.stop();
    run.stop();
    await run.done;
    expect(aborted).toBe(true);
    expect(c.lines).toHaveLength(1);
    expect(c.ends).toEqual([{ reason: "stopped", message: undefined }]);
  });

  it("reports failures to open the stream as 'error' with the message", async () => {
    const c = collect();
    await runLogStream(async () => { throw new Error("container is waiting to start"); }, c.events).done;
    expect(c.ends).toEqual([{ reason: "error", message: "container is waiting to start" }]);
  });

  it("stops after the maximum duration", async () => {
    const c = collect();
    const run = runLogStream(async (signal) => bodyFrom([], { holdOpen: true, signal }), c.events, { ...DEFAULT_LIMITS, maxDurationMs: 30 });
    await run.done;
    expect(c.ends[0].reason).toBe("timeout");
  });

  it("drops lines beyond the rate limit and says so", async () => {
    const c = collect();
    const many = Array.from({ length: 50 }, (_, i) => `2026-10-08T10:00:00Z line ${i}\n`).join("");
    await runLogStream(async () => bodyFrom([many]), c.events, { ...DEFAULT_LIMITS, maxLinesPerSecond: 10 }).done;
    expect(c.lines).toHaveLength(10);
    expect(c.notices.join(" ")).toMatch(/Dropped 40 lines/);
  });

  it("does not let one endless line grow the buffer", async () => {
    const c = collect();
    await runLogStream(async () => bodyFrom(["a".repeat(100), "b".repeat(100)]), c.events, { ...DEFAULT_LIMITS, maxLineChars: 20 }).done;
    expect(c.lines.length).toBeGreaterThan(0);
    expect(c.lines.every((l) => l.msg.length <= 20 + " …[truncated]".length)).toBe(true);
  });
});
