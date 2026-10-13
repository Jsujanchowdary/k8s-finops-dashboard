// The heart of live logs, with no network and no Kubernetes in it so it can be tested directly.
// It reads a byte stream, splits it into lines (text is passed through exactly as written), enforces
// limits, and stops cleanly.

export interface LogLimits {
  maxLineChars: number;
  maxLinesPerSecond: number;
  maxDurationMs: number;
}

export const DEFAULT_LIMITS: LogLimits = {
  maxLineChars: 8_000,
  maxLinesPerSecond: 1_500,
  maxDurationMs: 30 * 60 * 1000,
};

export type StreamEnd = "ended" | "stopped" | "timeout" | "error";

export interface LogLine {
  /** RFC3339 timestamp added by Kubernetes (timestamps=true), when present. */
  ts?: string;
  msg: string;
}

export interface LogEvents {
  onLine(line: LogLine): void;
  onNotice(message: string): void;
  onEnd(reason: StreamEnd, message?: string): void;
}

export type OpenLogBody = (signal: AbortSignal) => Promise<ReadableStream<Uint8Array>>;

const TIMESTAMP = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))\s([\s\S]*)$/;

export function parseLine(raw: string, maxChars: number): LogLine {
  const match = TIMESTAMP.exec(raw);
  let msg = match ? match[2] : raw;
  const ts = match ? match[1] : undefined;
  if (msg.length > maxChars) msg = `${msg.slice(0, maxChars)} …[truncated]`;
  return { ts, msg };
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * Runs one log stream. `stop()` aborts the underlying request and guarantees that `onEnd` is called exactly once.
 * Aborting is expected, so it never surfaces as an error.
 */
export function runLogStream(open: OpenLogBody, events: LogEvents, limits: LogLimits = DEFAULT_LIMITS): { stop: () => void; done: Promise<void> } {
  const controller = new AbortController();
  let finished = false;

  const finish = (reason: StreamEnd, message?: string) => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    controller.abort();
    events.onEnd(reason, message);
  };

  const timer = setTimeout(() => finish("timeout", `Stopped after ${Math.round(limits.maxDurationMs / 60000)} minutes. Press Start to continue.`), limits.maxDurationMs);

  const done = (async () => {
    try {
      const body = await open(controller.signal);
      const reader = body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";
      let windowStart = Date.now();
      let windowCount = 0;
      let dropped = 0;

      const emit = (raw: string) => {
        const now = Date.now();
        if (now - windowStart >= 1000) {
          if (dropped > 0) events.onNotice(`Dropped ${dropped} lines: the container is logging faster than ${limits.maxLinesPerSecond} lines per second.`);
          windowStart = now;
          windowCount = 0;
          dropped = 0;
        }
        windowCount += 1;
        if (windowCount > limits.maxLinesPerSecond) {
          dropped += 1;
          return;
        }
        events.onLine(parseLine(raw, limits.maxLineChars));
      };

      while (!finished) {
        const { value, done: eof } = await reader.read();
        if (eof) break;
        buffer += decoder.decode(value, { stream: true });
        let newline = buffer.indexOf("\n");
        while (newline >= 0) {
          emit(buffer.slice(0, newline).replace(/\r$/, ""));
          buffer = buffer.slice(newline + 1);
          newline = buffer.indexOf("\n");
        }
        // A single huge line with no newline must not grow the buffer without limit.
        if (buffer.length > limits.maxLineChars * 2) {
          emit(buffer);
          buffer = "";
        }
      }
      if (!finished) {
        buffer += decoder.decode();
        if (buffer) emit(buffer.replace(/\r$/, ""));
        if (dropped > 0) events.onNotice(`Dropped ${dropped} lines: the container is logging too fast.`);
        finish("ended");
      }
    } catch (error) {
      if (finished) return; // we aborted it ourselves
      finish("error", errorMessage(error));
    }
  })();

  return { stop: () => finish("stopped"), done };
}
