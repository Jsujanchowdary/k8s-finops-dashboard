"use client";

import Link from "next/link";
import { Box, Cable, Folder, HardDrive, Layers, Package, Server, Signpost, TriangleAlert, type LucideIcon } from "lucide-react";
import { Badge, type Tone } from "@/components/ui/badge";
import { CopyButton } from "@/components/ui/copy-button";
import { answerToMarkdown, type Answer, type AnswerSection, type EvidenceKind, type Severity } from "@/lib/ai/answer";
import type { ChatMeta } from "@/lib/ai/chat";

const TONE: Record<Severity, Tone> = { ok: "success", info: "info", warning: "warning", critical: "danger" };
const LABEL: Record<Severity, string> = { ok: "All good", info: "For your information", warning: "Needs attention", critical: "Critical" };
const DOT: Record<Severity, string> = { ok: "bg-success", info: "bg-info", warning: "bg-warning", critical: "bg-danger" };

const KIND_ICON: Record<EvidenceKind, LucideIcon> = { node: Server, namespace: Folder, pod: Box, workload: Layers, service: Cable, ingress: Signpost, pvc: HardDrive, helm: Package };
const KIND_LABEL: Record<EvidenceKind, string> = { node: "Node", namespace: "Namespace", pod: "Pod", workload: "Workload", service: "Service", ingress: "Ingress", pvc: "Volume", helm: "Helm release" };

function Section({ section }: { section: AnswerSection }) {
  return (
    <section className="rounded-xl border border-border bg-surface p-4">
      <h3 className="mb-2.5 text-sm font-semibold">{section.heading}</h3>

      {section.type === "text" ? <p className="whitespace-pre-wrap text-sm leading-relaxed">{section.text}</p> : null}

      {section.type === "bullets" ? (
        <ul className="space-y-2">
          {section.items?.map((item, i) => (
            <li key={i} className="flex items-start gap-2.5 text-sm leading-relaxed">
              <span aria-hidden className={`mt-2 size-1.5 shrink-0 rounded-full ${DOT[item.severity ?? "info"]}`} />
              <span className="min-w-0 flex-1">
                {item.severity && item.severity !== "info" ? <span className="sr-only">{item.severity}: </span> : null}
                {item.text}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {section.type === "table" ? (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-max border-collapse text-left text-xs">
            <thead className="bg-surface-2 text-muted">
              <tr>
                {section.columns?.map((c) => (
                  <th key={c} className="whitespace-nowrap px-3 py-2 font-medium">{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {section.rows?.map((row, r) => (
                <tr key={r} className="border-t border-border">
                  {row.map((cell, c) => (
                    <td key={c} className={`px-3 py-2 align-top ${c === 0 ? "font-mono text-[11.5px]" : ""}`}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {section.type === "commands" ? (
        <ul className="space-y-3">
          {section.commands?.map((c, i) => (
            <li key={i}>
              <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                <span>{c.purpose}</span>
                {c.changesCluster ? (
                  <Badge tone="warning" title="This command would change the cluster. The dashboard never runs commands; review it before you run it yourself.">
                    <TriangleAlert className="size-3" /> Changes the cluster
                  </Badge>
                ) : null}
              </div>
              <div className="flex items-start gap-2 rounded-lg border border-border bg-surface-2 p-2.5">
                <code className="min-w-0 flex-1 break-all font-mono text-xs">{c.command}</code>
                <CopyButton text={c.command} label="Copy command" />
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

const tokens = (n: number | undefined) => (n === undefined ? "?" : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

export function AnswerView({ answer, meta, onFollowUp }: { answer: Answer; meta?: ChatMeta; onFollowUp?: (question: string) => void }) {
  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3">
        <Badge tone={TONE[answer.status]}>{LABEL[answer.status]}</Badge>
        <p className="min-w-0 flex-1 text-[15px] font-medium leading-relaxed">{answer.summary}</p>
      </div>

      {answer.sections.map((s, i) => (
        <Section key={`${s.heading}-${i}`} section={s} />
      ))}

      {answer.evidence.length ? (
        <div>
          <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted">Based on</p>
          <div className="flex flex-wrap gap-1.5">
            {answer.evidence.map((e) => {
              const Icon = KIND_ICON[e.kind];
              return (
                <Link key={`${e.kind}-${e.namespace}-${e.name}`} href={e.href} title={`${KIND_LABEL[e.kind]}${e.namespace ? ` in ${e.namespace}` : ""}`} className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-border bg-surface px-2 py-1 text-xs transition-colors hover:border-accent/50 hover:bg-surface-2">
                  <Icon className="size-3.5 shrink-0 text-muted" aria-hidden />
                  <span className="truncate font-mono text-[11.5px]">{e.name}</span>
                </Link>
              );
            })}
          </div>
        </div>
      ) : null}

      {answer.followUps.length && onFollowUp ? (
        <div className="flex flex-wrap gap-2 pt-1">
          {answer.followUps.map((q) => (
            <button key={q} type="button" onClick={() => onFollowUp(q)} className="rounded-full border border-border bg-surface px-3 py-1.5 text-left text-xs transition-colors hover:border-accent/50 hover:bg-surface-2">
              {q}
            </button>
          ))}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border pt-2.5 text-xs text-muted">
        <CopyButton text={answerToMarkdown(answer)} label="Copy answer as Markdown" />
        {meta ? (
          <>
            <span>Cluster data from {new Date(meta.snapshotAt).toLocaleTimeString()}</span>
            <span>{meta.counts.pods} pods · {meta.counts.namespaces} namespaces</span>
            <span className="font-mono">{meta.model}</span>
            {meta.fellBackFrom ? <span className="text-warning" title="The model you chose was busy, so a lighter one answered. Answers may be a little less thorough.">{meta.fellBackFrom} was busy</span> : null}
            <span>{tokens(meta.inputTokens)} in · {tokens(meta.outputTokens)} out</span>
            {meta.unverifiedReferences > 0 ? <span className="text-warning">{meta.unverifiedReferences === 1 ? "1 reference to an object that is not in the cluster data was removed" : `${meta.unverifiedReferences} references to objects that are not in the cluster data were removed`}</span> : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
