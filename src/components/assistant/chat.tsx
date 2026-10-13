"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp, KeyRound, RotateCcw, ShieldCheck, Sparkles } from "lucide-react";
import { answerToHistory, type Answer } from "@/lib/ai/answer";
import type { ChatMeta } from "@/lib/ai/chat";
import { BUTTON } from "@/components/ui/controls";
import { AnswerView } from "./answer-view";

export type AssistantStatus = "ready" | "no-key" | "off";

type Message =
  | { id: string; role: "user"; text: string }
  | { id: string; role: "assistant"; state: "pending" }
  | { id: string; role: "assistant"; state: "done"; answer: Answer; meta: ChatMeta }
  | { id: string; role: "assistant"; state: "error"; error: string; question: string };

const STARTERS = [
  { title: "What needs attention?", prompt: "Which pods or nodes need attention right now, and why?" },
  { title: "Memory headroom", prompt: "Which pods are closest to their memory limit, and which have no limit at all?" },
  { title: "How traffic flows", prompt: "Explain how a request from the internet reaches the pods in each namespace that has an ingress." },
  { title: "Storage", prompt: "List every persistent volume, its size, and what uses it." },
  { title: "Node capacity", prompt: "How much room is left on the node, and what happens if autoscaling adds a node?" },
  { title: "Recent problems", prompt: "Summarise the latest warning events and what they probably mean." },
];

let counter = 0;
const nextId = () => `m${(counter += 1)}`;

function Setup({ status, model }: { status: Exclude<AssistantStatus, "ready">; model: string }) {
  return (
    <div className="mx-auto mt-6 max-w-xl rounded-xl border border-border bg-surface p-5">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <KeyRound className="size-4 text-accent" aria-hidden />
        {status === "off" ? "The assistant is turned off" : "Add your Gemini API key"}
      </div>
      {status === "off" ? (
        <p className="text-sm text-muted">It is switched off by <code className="font-mono text-xs">ENABLE_AI=false</code> in <code className="font-mono text-xs">.env.local</code>. Remove that line and restart the dev server to use it.</p>
      ) : (
        <ol className="list-decimal space-y-2 pl-5 text-sm text-muted">
          <li>Create a key in Google AI Studio (<span className="font-mono text-xs">aistudio.google.com/apikey</span>).</li>
          <li>Paste it in <Link href="/settings" className="text-accent hover:underline">Settings</Link> and click Connect. It is checked, saved and used at once; it stays on this machine and is never sent to the browser.</li>
          <li>Optional: <code className="font-mono text-xs">GEMINI_MODEL</code> picks the model (now <span className="font-mono text-xs">{model}</span>).</li>
        </ol>
      )}
    </div>
  );
}

export function Chat({ status, model }: { status: AssistantStatus; model: string }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const abort = useRef<AbortController | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const busy = messages.some((m) => m.role === "assistant" && m.state === "pending");

  useEffect(() => () => abort.current?.abort(), []);

  // Follow the conversation: a new question scrolls to the bottom, a finished answer scrolls to its own top.
  const last = messages[messages.length - 1];
  const lastKey = last ? `${last.id}:${last.role === "assistant" ? last.state : "user"}` : "";
  useEffect(() => {
    const area = scroller.current;
    if (!last || !area) return;
    if (last.role === "assistant" && last.state === "done") {
      // Only the message area moves, never the page around it.
      const top = document.getElementById(last.id)?.getBoundingClientRect().top;
      if (top !== undefined) area.scrollTo({ top: area.scrollTop + top - area.getBoundingClientRect().top - 8 });
    } else {
      area.scrollTo({ top: area.scrollHeight });
    }
    // lastKey changes exactly when the last message or its state does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastKey]);

  const send = useCallback(
    async (raw: string, base: Message[]) => {
      const question = raw.trim();
      if (!question || base.some((m) => m.role === "assistant" && m.state === "pending")) return;

      const history: { role: "user" | "assistant"; text: string }[] = [
        ...base.flatMap((m): { role: "user" | "assistant"; text: string }[] => (m.role === "user" ? [{ role: "user", text: m.text }] : m.state === "done" ? [{ role: "assistant", text: answerToHistory(m.answer) }] : [])),
        { role: "user", text: question },
      ];
      const pendingId = nextId();
      setMessages([...base, { id: nextId(), role: "user", text: question }, { id: pendingId, role: "assistant", state: "pending" }]);

      const controller = new AbortController();
      abort.current = controller;
      const finish = (message: Message) => setMessages((current) => current.map((m) => (m.id === pendingId ? message : m)));
      try {
        const response = await fetch("/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messages: history }), signal: controller.signal });
        const body = (await response.json().catch(() => ({}))) as { answer?: Answer; meta?: ChatMeta; error?: string };
        if (!response.ok || !body.answer || !body.meta) {
          finish({ id: pendingId, role: "assistant", state: "error", error: body.error ?? `The assistant answered with an error (HTTP ${response.status}).`, question });
        } else {
          finish({ id: pendingId, role: "assistant", state: "done", answer: body.answer, meta: body.meta });
        }
      } catch (error) {
        if ((error as Error).name === "AbortError") return;
        finish({ id: pendingId, role: "assistant", state: "error", error: "Could not reach the dashboard server. Is npm run dev still running?", question });
      }
    },
    [],
  );

  const submit = () => {
    const text = draft;
    if (!text.trim() || busy) return;
    setDraft("");
    if (box.current) box.current.style.height = "auto";
    void send(text, messages);
  };

  const retry = (id: string) => {
    const index = messages.findIndex((m) => m.id === id);
    const failed = messages[index];
    if (!failed || failed.role !== "assistant" || failed.state !== "error") return;
    void send(failed.question, messages.slice(0, Math.max(0, index - 1)));
  };

  const newChat = () => {
    abort.current?.abort();
    setMessages([]);
    setDraft("");
    box.current?.focus();
  };

  return (
    <div className="mx-auto flex h-[calc(100vh-8.5rem)] min-h-[440px] w-full max-w-3xl flex-col">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="grid size-8 place-items-center rounded-lg bg-accent/15 text-accent"><Sparkles className="size-4" aria-hidden /></span>
          <div className="leading-tight">
            <h1 className="text-base font-semibold tracking-tight">AI assistant</h1>
            <p className="font-mono text-[11px] text-muted">{model}</p>
          </div>
        </div>
        {messages.length > 0 ? (
          <button type="button" onClick={newChat} className={BUTTON}><RotateCcw className="size-3.5" aria-hidden /> New chat</button>
        ) : null}
      </div>

      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto pr-1" aria-live="polite">
        {messages.length === 0 ? (
          status === "ready" ? (
            <div className="flex h-full flex-col items-center justify-center gap-6 pb-6 text-center">
              <div>
                <h2 className="text-xl font-semibold tracking-tight">Ask anything about your cluster</h2>
                <p className="mx-auto mt-1.5 max-w-md text-sm text-muted">Nodes, pods, networking, storage, Helm releases, resource use and costs. Answers are built from the cluster as it is right now, and are laid out in sections you can scan.</p>
              </div>
              <div className="grid w-full max-w-2xl grid-cols-1 gap-2 text-left sm:grid-cols-2">
                {STARTERS.map((s) => (
                  <button key={s.title} type="button" onClick={() => void send(s.prompt, [])} className="rounded-xl border border-border bg-surface p-3 transition-colors hover:border-accent/50 hover:bg-surface-2">
                    <span className="block text-sm font-medium">{s.title}</span>
                    <span className="mt-0.5 block text-xs text-muted">{s.prompt}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <Setup status={status === "off" ? "off" : "no-key"} model={model} />
          )
        ) : (
          <div className="space-y-6 pb-4">
            {messages.map((m) =>
              m.role === "user" ? (
                <div key={m.id} className="flex justify-end">
                  <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-tr-md bg-surface-2 px-4 py-2.5 text-sm leading-relaxed">{m.text}</p>
                </div>
              ) : (
                <div key={m.id} id={m.id} className="flex scroll-mt-2 gap-3">
                  <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-accent/15 text-accent"><Sparkles className="size-3.5" aria-hidden /></span>
                  <div className="min-w-0 flex-1">
                    {m.state === "pending" ? (
                      <p className="flex items-center gap-2 py-1 text-sm text-muted">
                        <span className="flex gap-1" aria-hidden>
                          <span className="size-1.5 animate-pulse rounded-full bg-accent" />
                          <span className="size-1.5 animate-pulse rounded-full bg-accent [animation-delay:150ms]" />
                          <span className="size-1.5 animate-pulse rounded-full bg-accent [animation-delay:300ms]" />
                        </span>
                        Reading the cluster and thinking…
                      </p>
                    ) : m.state === "error" ? (
                      <div className="rounded-xl border border-danger/40 bg-danger/10 p-3 text-sm">
                        <p className="font-medium text-danger">Could not get an answer</p>
                        <p className="mt-1 text-muted">{m.error}</p>
                        <button type="button" onClick={() => retry(m.id)} className={`${BUTTON} mt-2`}><RotateCcw className="size-3.5" aria-hidden /> Try again</button>
                      </div>
                    ) : (
                      <AnswerView answer={m.answer} meta={m.meta} onFollowUp={busy ? undefined : (q) => void send(q, messages)} />
                    )}
                  </div>
                </div>
              ),
            )}
          </div>
        )}
      </div>

      <div className="pt-3">
        <div className="flex items-end gap-2 rounded-2xl border border-border bg-surface p-2 focus-within:border-accent">
          <label className="sr-only" htmlFor="assistant-input">Ask about the cluster</label>
          <textarea
            id="assistant-input"
            ref={box}
            value={draft}
            rows={1}
            disabled={status !== "ready"}
            placeholder={status === "ready" ? "Ask about nodes, pods, networking, storage, costs…" : "The assistant is not set up yet"}
            onChange={(e) => {
              setDraft(e.target.value);
              e.currentTarget.style.height = "auto";
              e.currentTarget.style.height = `${Math.min(e.currentTarget.scrollHeight, 160)}px`;
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
            className="max-h-40 min-h-9 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm placeholder:text-muted focus:outline-none disabled:opacity-60"
          />
          <button type="button" onClick={submit} disabled={status !== "ready" || busy || !draft.trim()} aria-label="Send" className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent text-white transition-opacity disabled:opacity-40">
            <ArrowUp className="size-4" aria-hidden />
          </button>
        </div>
        <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-snug text-muted">
          <ShieldCheck className="mt-px size-3 shrink-0" aria-hidden />
          <span>Read-only. Each question sends a snapshot of the cluster (names, statuses, IPs, images, resource numbers and, with a DigitalOcean token, the account&apos;s billing figures; no environment values, Secrets or logs) to Google Gemini. Answers can be wrong, so check the objects they cite. Enter to send, Shift+Enter for a new line.</span>
        </p>
      </div>
    </div>
  );
}
