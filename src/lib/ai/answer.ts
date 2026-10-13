// The shape of an assistant answer, the JSON schema Gemini is asked to follow, and the checks that turn whatever
// it returns into something safe to draw. Pure: shared by the server (validation) and the browser (rendering).

export type Severity = "ok" | "info" | "warning" | "critical";
export type SectionType = "text" | "bullets" | "table" | "commands";
export type EvidenceKind = "node" | "namespace" | "pod" | "workload" | "service" | "ingress" | "pvc" | "helm";

export interface AnswerItem {
  text: string;
  severity?: Severity;
}

export interface AnswerCommand {
  command: string;
  purpose: string;
  /** True when the command would change the cluster. It is shown with a warning, and never run by the dashboard. */
  changesCluster: boolean;
}

export interface AnswerSection {
  heading: string;
  type: SectionType;
  text?: string;
  items?: AnswerItem[];
  columns?: string[];
  rows?: string[][];
  commands?: AnswerCommand[];
}

export interface EvidenceRef {
  kind: EvidenceKind;
  namespace?: string;
  name: string;
  /** Page for this object. Only set when the object exists in the snapshot the answer was based on. */
  href: string;
}

export interface Answer {
  summary: string;
  status: Severity;
  sections: AnswerSection[];
  evidence: EvidenceRef[];
  followUps: string[];
}

export const SEVERITIES: Severity[] = ["ok", "info", "warning", "critical"];
const SECTION_TYPES: SectionType[] = ["text", "bullets", "table", "commands"];
const EVIDENCE_KINDS: EvidenceKind[] = ["node", "namespace", "pod", "workload", "service", "ingress", "pvc", "helm"];

/** Set of objects that exist in the snapshot, by kind. Keys are `namespace/name`, or just `name` for nodes and namespaces. */
export type EvidenceIndex = Record<EvidenceKind, Set<string>>;

export function emptyIndex(): EvidenceIndex {
  return { node: new Set(), namespace: new Set(), pod: new Set(), workload: new Set(), service: new Set(), ingress: new Set(), pvc: new Set(), helm: new Set() };
}

// ---------------------------------------------------------------------------
// The schema sent to Gemini (a subset of JSON Schema: lowercase types, no nullable keyword)
// ---------------------------------------------------------------------------

const text = (description: string) => ({ type: "string", description });

export const ANSWER_SCHEMA = {
  type: "object",
  properties: {
    summary: text("One or two sentences that directly answer the question. No preamble."),
    status: { type: "string", enum: SEVERITIES, description: "Overall state of what was asked about: ok, info, warning or critical." },
    sections: {
      type: "array",
      description: "The answer, broken into titled sections. Use 1 to 6 sections.",
      items: {
        type: "object",
        properties: {
          heading: text("Short section title."),
          type: { type: "string", enum: SECTION_TYPES, description: "text: a short paragraph. bullets: findings. table: comparable rows. commands: kubectl commands the user can run." },
          text: text("Only for type text."),
          items: {
            type: "array",
            description: "Only for type bullets.",
            items: { type: "object", properties: { text: text("One finding, with the reason it matters."), severity: { type: "string", enum: SEVERITIES } }, required: ["text"] },
          },
          columns: { type: "array", description: "Only for type table: column titles.", items: { type: "string" } },
          rows: {
            type: "array",
            description: "Only for type table: one entry per row, with one cell per column.",
            items: { type: "object", properties: { cells: { type: "array", items: { type: "string" } } }, required: ["cells"] },
          },
          commands: {
            type: "array",
            description: "Only for type commands.",
            items: { type: "object", properties: { command: text("A single shell command."), purpose: text("What it shows or does, in one line.") }, required: ["command", "purpose"] },
          },
        },
        required: ["heading", "type"],
      },
    },
    evidence: {
      type: "array",
      description: "Every object from the snapshot the answer relies on. Use exact names.",
      items: {
        type: "object",
        properties: { kind: { type: "string", enum: EVIDENCE_KINDS }, namespace: text("Namespace, for everything except node and namespace."), name: text("Exact object name.") },
        required: ["kind", "name"],
      },
    },
    followUps: { type: "array", description: "Up to 3 natural follow-up questions.", items: { type: "string" } },
  },
  required: ["summary", "status", "sections"],
} as const;

// ---------------------------------------------------------------------------
// Turning the model's output into a safe Answer
// ---------------------------------------------------------------------------

const MAX_TEXT = 1200;
const MAX_CELL = 300;

const clip = (value: unknown, max: number): string => (typeof value === "string" ? value.trim().slice(0, max) : "");
const oneOf = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(value as T) ? (value as T) : fallback);
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const asRecord = (value: unknown): Record<string, unknown> => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {});

// Anything that could change the cluster or the node. The dashboard never runs commands; this only decides which ones get a warning.
const CHANGING = /\b(kubectl|helm|doctl)\b[^|;&]*\b(delete|apply|patch|scale|edit|replace|create|drain|cordon|uncordon|taint|annotate|label|rollout\s+(restart|undo|pause|resume)|set\s+\w+|exec|cp|run|expose|install|upgrade|uninstall|rollback|annotate)\b|\b(rm|mv|dd|sudo|chmod|chown|kill|shutdown|reboot)\b|>\s*\S|\|\s*(sh|bash)\b/i;

export function commandChangesCluster(command: string): boolean {
  return CHANGING.test(command);
}

export function hrefFor(kind: EvidenceKind, namespace: string | undefined, name: string): string {
  const ns = encodeURIComponent(namespace ?? "");
  switch (kind) {
    case "node": return `/nodes/${encodeURIComponent(name)}`;
    case "namespace": return `/namespaces/${encodeURIComponent(name)}`;
    case "pod": return `/namespaces/${ns}/pods/${encodeURIComponent(name)}`;
    case "workload": return `/namespaces/${ns}?tab=workloads`;
    case "service":
    case "ingress": return `/namespaces/${ns}?tab=network`;
    case "pvc": return `/namespaces/${ns}?tab=storage`;
    case "helm": return `/helm/${ns}/${encodeURIComponent(name)}`;
  }
}

export interface NormalizedAnswer {
  answer: Answer;
  /** References the model made to objects that are not in the snapshot. They are dropped, never linked. */
  droppedReferences: number;
}

/** Validates raw model output. Returns null when it holds no usable answer. */
export function normalizeAnswer(raw: unknown, index: EvidenceIndex): NormalizedAnswer | null {
  const body = asRecord(raw);
  const summary = clip(body.summary, MAX_TEXT);
  if (!summary) return null;

  const sections: AnswerSection[] = [];
  for (const entry of asArray(body.sections).slice(0, 10)) {
    const s = asRecord(entry);
    const heading = clip(s.heading, 120);
    const type = oneOf(s.type, SECTION_TYPES, "text");
    if (!heading) continue;
    const section: AnswerSection = { heading, type };

    if (type === "text") {
      section.text = clip(s.text, MAX_TEXT * 3);
      if (!section.text) continue;
    } else if (type === "bullets") {
      section.items = asArray(s.items)
        .slice(0, 30)
        .map((i) => asRecord(i))
        .map((i) => ({ text: clip(i.text, MAX_TEXT), severity: SEVERITIES.includes(i.severity as Severity) ? (i.severity as Severity) : undefined }))
        .filter((i) => i.text);
      if (!section.items.length) continue;
    } else if (type === "table") {
      const columns = asArray(s.columns).slice(0, 8).map((c) => clip(c, 60));
      const rows = asArray(s.rows)
        .slice(0, 80)
        .map((r) => asArray(asRecord(r).cells).slice(0, columns.length).map((c) => clip(c, MAX_CELL)))
        .filter((r) => r.some(Boolean))
        .map((r) => (r.length < columns.length ? [...r, ...Array(columns.length - r.length).fill("")] : r));
      if (!columns.length || !rows.length) continue;
      section.columns = columns;
      section.rows = rows;
    } else {
      section.commands = asArray(s.commands)
        .slice(0, 12)
        .map((c) => asRecord(c))
        .map((c) => ({ command: clip(c.command, 500), purpose: clip(c.purpose, 200), changesCluster: false }))
        .filter((c) => c.command)
        .map((c) => ({ ...c, changesCluster: commandChangesCluster(c.command) }));
      if (!section.commands.length) continue;
    }
    sections.push(section);
  }

  let dropped = 0;
  const seen = new Set<string>();
  const evidence: EvidenceRef[] = [];
  for (const entry of asArray(body.evidence).slice(0, 40)) {
    const e = asRecord(entry);
    const kind = e.kind as EvidenceKind;
    const name = clip(e.name, 253);
    if (!EVIDENCE_KINDS.includes(kind) || !name) continue;
    const namespace = kind === "node" || kind === "namespace" ? undefined : clip(e.namespace, 63);
    const key = namespace ? `${namespace}/${name}` : name;
    if (!index[kind].has(key)) {
      dropped += 1;
      continue;
    }
    if (seen.has(`${kind}:${key}`)) continue;
    seen.add(`${kind}:${key}`);
    evidence.push({ kind, namespace, name, href: hrefFor(kind, namespace, name) });
  }

  const followUps = asArray(body.followUps).map((f) => clip(f, 160)).filter(Boolean).slice(0, 3);
  return { answer: { summary, status: oneOf(body.status, SEVERITIES, "info"), sections, evidence, followUps }, droppedReferences: dropped };
}

// ---------------------------------------------------------------------------
// Plain text and Markdown forms of an answer (history sent back to the model, and the Copy button)
// ---------------------------------------------------------------------------

export function answerToMarkdown(answer: Answer): string {
  const lines: string[] = [`**${answer.summary}**`, ""];
  for (const s of answer.sections) {
    lines.push(`### ${s.heading}`);
    if (s.type === "text" && s.text) lines.push(s.text);
    if (s.type === "bullets") for (const i of s.items ?? []) lines.push(`- ${i.severity && i.severity !== "info" ? `[${i.severity}] ` : ""}${i.text}`);
    if (s.type === "table" && s.columns && s.rows) {
      lines.push(`| ${s.columns.join(" | ")} |`, `| ${s.columns.map(() => "---").join(" | ")} |`);
      for (const r of s.rows) lines.push(`| ${r.map((c) => c.replace(/\|/g, "\\|")).join(" | ")} |`);
    }
    if (s.type === "commands") for (const c of s.commands ?? []) lines.push(`- ${c.purpose}`, "  ```", `  ${c.command}`, "  ```");
    lines.push("");
  }
  if (answer.evidence.length) lines.push(`Based on: ${answer.evidence.map((e) => (e.namespace ? `${e.namespace}/${e.name}` : e.name)).join(", ")}`);
  return lines.join("\n").trim();
}

/** A short version of an answer for the conversation history sent with the next question. */
export function answerToHistory(answer: Answer): string {
  const parts = [answer.summary];
  for (const s of answer.sections.slice(0, 4)) {
    if (s.type === "text" && s.text) parts.push(`${s.heading}: ${s.text}`);
    if (s.type === "bullets") parts.push(`${s.heading}: ${(s.items ?? []).slice(0, 5).map((i) => i.text).join("; ")}`);
    if (s.type === "table") parts.push(`${s.heading}: table of ${s.rows?.length ?? 0} rows (${(s.columns ?? []).join(", ")})`);
  }
  return parts.join("\n").slice(0, 1500);
}
