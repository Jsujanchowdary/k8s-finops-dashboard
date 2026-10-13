"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDownToLine, Clock, Copy, Eraser, History, Info, Play, Square, WrapText } from "lucide-react";
import { Badge, type Tone } from "@/components/ui/badge";
import { Card, CardBody } from "@/components/ui/card";
import { BUTTON, SearchField, SelectField as Select, toggleClass } from "@/components/ui/controls";

export interface LogContainer {
  name: string;
  isInit: boolean;
  state: "running" | "waiting" | "terminated" | "unknown";
  restarts: number;
}

type Status = "idle" | "connecting" | "streaming" | "ended" | "stopped" | "timeout" | "error";

interface Line {
  id: number;
  ts?: string;
  msg: string;
  notice?: boolean;
}

const MAX_LINES = 5000; // rolling window kept in this browser tab only
const FLUSH_MS = 100;
const MAX_RETRIES = 3;
const TAILS = [100, 200, 500, 1000];

const STATUS_LABEL: Record<Status, string> = {
  idle: "Not started",
  connecting: "Connecting…",
  streaming: "Streaming live",
  ended: "Stream ended",
  stopped: "Stopped",
  timeout: "Time limit reached",
  error: "Error",
};
const STATUS_TONE: Record<Status, Tone> = { idle: "neutral", connecting: "info", streaming: "success", ended: "neutral", stopped: "neutral", timeout: "warning", error: "danger" };

/** Pads the fraction so RFC3339 strings compare correctly as text. */
function normTs(ts: string): string {
  return ts.replace(/(?:\.(\d+))?Z$/, (_m, frac: string | undefined) => `.${(frac ?? "").padEnd(9, "0")}Z`);
}

async function readSse(body: ReadableStream<Uint8Array>, onEvent: (event: string, data: string) => void) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });
    let end = buffer.indexOf("\n\n");
    while (end >= 0) {
      const block = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      if (!block.startsWith(":")) {
        let event = "message";
        let data = "";
        for (const row of block.split("\n")) {
          if (row.startsWith("event:")) event = row.slice(6).trim();
          else if (row.startsWith("data:")) data += row.slice(5).trim();
        }
        onEvent(event, data);
      }
      end = buffer.indexOf("\n\n");
    }
  }
}

function clock(ts?: string): string {
  if (!ts) return "";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.toLocaleTimeString([], { hour12: false })}.${String(d.getMilliseconds()).padStart(3, "0")}`;
}

function tint(msg: string): string {
  if (/\b(error|fatal|exception|panic|traceback)\b/i.test(msg)) return "text-danger";
  if (/\bwarn(ing)?\b/i.test(msg)) return "text-warning";
  return "";
}

function Toggle({ on, onClick, icon, label, title }: { on: boolean; onClick: () => void; icon: React.ReactNode; label: string; title?: string }) {
  return (
    <button type="button" aria-pressed={on} title={title} onClick={onClick} className={toggleClass(on)}>
      {icon}
      {label}
    </button>
  );
}

export function PodLogs({ namespace, pod, containers, enabled }: { namespace: string; pod: string; containers: LogContainer[]; enabled: boolean }) {
  const defaultContainer = (containers.find((c) => !c.isInit && c.state === "running") ?? containers.find((c) => !c.isInit) ?? containers[0])?.name ?? "";

  const [container, setContainer] = useState(defaultContainer);
  const [tail, setTail] = useState(200);
  const [previous, setPrevious] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [filter, setFilter] = useState("");
  const [wrap, setWrap] = useState(true);
  const [showTime, setShowTime] = useState(true);
  const [follow, setFollow] = useState(true);
  const [copied, setCopied] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const pendingRef = useRef<Line[]>([]);
  const nextId = useRef(1);
  const lastTs = useRef<string | undefined>(undefined);
  const lastKeys = useRef<Set<string>>(new Set());
  const lastNorm = useRef<string | undefined>(undefined);
  // Set only while resuming after a dropped connection: lines up to this time were already shown.
  const resumeFrom = useRef<string | undefined>(undefined);
  const viewport = useRef<HTMLDivElement>(null);

  // Lines are collected in a buffer and shown ten times a second, so a chatty pod doesn't re-render per line.
  useEffect(() => {
    const id = window.setInterval(() => {
      if (pendingRef.current.length === 0) return;
      const batch = pendingRef.current;
      pendingRef.current = [];
      setLines((prev) => {
        const merged = prev.concat(batch);
        return merged.length > MAX_LINES ? merged.slice(merged.length - MAX_LINES) : merged;
      });
    }, FLUSH_MS);
    return () => window.clearInterval(id);
  }, []);

  // Leaving the tab or the page closes the connection, which stops the stream on the server and in the cluster.
  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    if (follow && viewport.current) viewport.current.scrollTop = viewport.current.scrollHeight;
  }, [lines, follow]);

  const push = useCallback((line: Omit<Line, "id">) => {
    pendingRef.current.push({ id: nextId.current++, ...line });
  }, []);

  const handleLine = useCallback(
    (line: { ts?: string; msg: string }) => {
      if (line.ts) {
        const norm = normTs(line.ts);
        const from = resumeFrom.current;
        if (from) {
          if (norm < from) return; // shown before the connection dropped
          if (norm === from && lastKeys.current.has(line.msg)) return;
          if (norm > from) resumeFrom.current = undefined; // past the overlap, back to normal
        }
        if (lastNorm.current !== norm) {
          lastNorm.current = norm;
          lastKeys.current = new Set();
        }
        lastKeys.current.add(line.msg);
        lastTs.current = line.ts;
      }
      push(line);
    },
    [push],
  );

  const start = useCallback(
    async (resumeFirst = false) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      if (!resumeFirst) {
        pendingRef.current = [];
        setLines([]);
        lastTs.current = undefined;
        lastNorm.current = undefined;
        lastKeys.current = new Set();
      }
      resumeFrom.current = undefined;
      setFollow(true);

      let resume = resumeFirst;
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
        setStatus("connecting");
        setMessage(attempt === 0 ? "" : `Connection lost, retrying (${attempt}/${MAX_RETRIES})…`);

        const params = new URLSearchParams({ container, tail: String(tail) });
        if (previous) params.set("previous", "1");
        if (resume && lastTs.current) {
          params.set("since", lastTs.current);
          resumeFrom.current = normTs(lastTs.current);
        }

        let finalSeen = false;
        try {
          const response = await fetch(`/api/logs/${encodeURIComponent(namespace)}/${encodeURIComponent(pod)}?${params}`, {
            signal: controller.signal,
            cache: "no-store",
            headers: { Accept: "text/event-stream" },
          });
          if (!response.ok || !response.body) {
            const body = (await response.json().catch(() => null)) as { error?: string } | null;
            setStatus("error");
            setMessage(body?.error ?? `The request failed (${response.status}).`);
            return; // a refusal is not worth retrying
          }
          await readSse(response.body, (event, data) => {
            let payload: Record<string, string> = {};
            try {
              payload = JSON.parse(data);
            } catch {
              return;
            }
            if (event === "line") handleLine(payload as { ts?: string; msg: string });
            else if (event === "notice") push({ msg: payload.message, notice: true });
            else if (event === "status") {
              if (payload.state === "connected") setStatus("streaming");
              else {
                finalSeen = true;
                setStatus(payload.state as Status);
                setMessage(payload.message ?? "");
              }
            }
          });
          if (finalSeen || controller.signal.aborted) return;
          throw new Error("The connection was lost.");
        } catch (error) {
          if (controller.signal.aborted) return; // we stopped it on purpose
          if (attempt === MAX_RETRIES) {
            setStatus("error");
            setMessage(error instanceof Error ? error.message : "The connection was lost.");
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
          if (controller.signal.aborted) return;
          resume = true; // continue from the last line already shown
        }
      }
    },
    [container, tail, previous, namespace, pod, handleLine, push],
  );

  const stop = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStatus("stopped");
    setMessage("");
  };

  const clear = () => {
    pendingRef.current = [];
    setLines([]);
  };

  const running = status === "connecting" || status === "streaming";
  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? lines.filter((l) => l.msg.toLowerCase().includes(q)) : lines;
  }, [lines, filter]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(visible.map((l) => `${showTime && l.ts ? `${l.ts} ` : ""}${l.msg}`).join("\n"));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked; ignore */
    }
  };

  if (!enabled) {
    return <Card><CardBody className="text-sm text-muted">Live logs are turned off. Remove <code className="font-mono text-text">ENABLE_LOGS=false</code> from <code className="font-mono text-text">.env.local</code> and restart to enable them.</CardBody></Card>;
  }
  if (!containers.length) return <Card><CardBody className="text-sm text-muted">This pod has no containers to read logs from yet.</CardBody></Card>;

  const selected = containers.find((c) => c.name === container);
  const note = message || (selected?.state === "waiting" && !running ? "This container has not started yet, so Kubernetes may refuse to return logs." : "");

  return (
    <div className="space-y-3">
      <p className="flex items-start gap-2 rounded-md border border-border bg-surface px-3 py-2 text-xs text-muted">
        <Info className="mt-0.5 size-3.5 shrink-0" />
        <span>Logs are shown exactly as the container wrote them, so they can contain sensitive data. Nothing is stored, and closing this tab stops the stream.</span>
      </p>

      <div className="space-y-3 rounded-xl border border-border bg-surface p-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Select label="Container" value={container} onChange={setContainer} disabled={running}>
            {containers.map((c) => <option key={`${c.isInit}-${c.name}`} value={c.name}>{c.name}{c.isInit ? " (init)" : ""} · {c.state}</option>)}
          </Select>
          <Select label="Start with" value={tail} onChange={(v) => setTail(Number(v))} disabled={running}>
            {TAILS.map((t) => <option key={t} value={t}>last {t} lines</option>)}
          </Select>
          <button type="button" aria-pressed={previous} disabled={running} onClick={() => setPrevious((v) => !v)} title="Show the logs of the previous run of this container, useful after a crash" className={toggleClass(previous)}>
            <History className="size-3.5" />Previous run
          </button>

          <div className="ml-auto flex items-center gap-3">
            <Badge tone={STATUS_TONE[status]}>
              {status === "streaming" ? <span className="size-1.5 animate-pulse rounded-full bg-success" aria-hidden /> : null}
              {STATUS_LABEL[status]}
            </Badge>
            {running ? (
              <button type="button" onClick={stop} className={`${BUTTON} min-w-20 justify-center border-danger/40 text-danger hover:bg-danger/10`}><Square className="size-3.5" />Stop</button>
            ) : (
              <button type="button" onClick={() => void start(false)} className="inline-flex h-8 min-w-20 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-accent bg-accent px-3 text-xs font-semibold text-white transition-opacity hover:opacity-90">
                <Play className="size-3.5" />{status === "idle" ? "Start" : "Restart"}
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
          <SearchField value={filter} onChange={setFilter} label="Filter log lines" placeholder="Filter the lines on screen" className="sm:max-w-xs" />
          <Toggle on={showTime} onClick={() => setShowTime((v) => !v)} icon={<Clock className="size-3.5" />} label="Timestamps" />
          <Toggle on={wrap} onClick={() => setWrap((v) => !v)} icon={<WrapText className="size-3.5" />} label="Wrap" />
          <Toggle on={follow} onClick={() => setFollow((v) => !v)} icon={<ArrowDownToLine className="size-3.5" />} label="Follow" title="Keep scrolling to the newest line" />
          <span className="mx-1 hidden h-5 w-px bg-border sm:block" aria-hidden />
          <button type="button" onClick={clear} className={BUTTON}><Eraser className="size-3.5" />Clear</button>
          <button type="button" onClick={() => void copy()} className={BUTTON}><Copy className="size-3.5" />{copied ? "Copied" : "Copy"}</button>
          <span className="ml-auto text-xs tabular-nums text-muted">{filter ? `${visible.length} of ${lines.length} lines` : `${lines.length} lines`}{lines.length >= MAX_LINES ? ` (latest ${MAX_LINES})` : ""}</span>
        </div>

        {note ? <p className={`text-xs ${status === "error" ? "text-danger" : "text-muted"}`}>{note}</p> : null}
      </div>

      <div className="relative">
        <div
          ref={viewport}
          role="log"
          aria-live="off"
          aria-label={`Logs of ${container}`}
          onScroll={(e) => {
            const el = e.currentTarget;
            setFollow(el.scrollHeight - el.scrollTop - el.clientHeight < 48);
          }}
          className="h-[60vh] overflow-auto rounded-xl border border-border bg-surface-2 p-3 font-mono text-xs leading-relaxed"
        >
          {visible.length === 0 ? (
            <p className="text-muted">
              {status === "idle" ? `Press Start to stream logs from “${container}”. Nothing is stored, and closing this tab stops the stream.` : running ? "Waiting for log lines…" : lines.length ? "No line matches the filter." : "No log lines."}
            </p>
          ) : (
            visible.map((l) => (
              <div key={l.id} className={`flex gap-3 ${l.notice ? "italic text-warning" : tint(l.msg)}`}>
                {showTime && !l.notice ? <span className="shrink-0 select-none tabular-nums text-muted">{clock(l.ts)}</span> : null}
                <span className={wrap ? "min-w-0 whitespace-pre-wrap break-all" : "whitespace-pre"}>{l.msg}</span>
              </div>
            ))
          )}
        </div>
        {!follow && lines.length > 0 ? (
          <button type="button" onClick={() => setFollow(true)} className="absolute bottom-3 right-4 inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 text-xs shadow hover:bg-surface-2">
            <ArrowDownToLine className="size-3.5" />Jump to latest
          </button>
        ) : null}
      </div>
    </div>
  );
}
