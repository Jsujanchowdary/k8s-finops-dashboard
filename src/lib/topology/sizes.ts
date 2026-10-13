// Card sizes are known before anything is drawn, so the layout (server) and the cards (browser) always agree
// without measuring. Long names wrap instead of being cut off, so the number of lines is estimated from the
// text length, a little on the generous side: spare room in a card is harmless, text spilling out of it is not.

import type { TopoFact, TopoNode } from "./types";

export const POD_ROW_HEIGHT = 66;
export const POD_ROW_GAP = 6;
/** Title, subtitle and the gap above the fact rows, for a one-line title. */
export const WORKLOAD_HEADER = 52;
export const WORKLOAD_PADDING = 10;
export const FACT_ROW = 18;
export const TITLE_LINE = 20;
export const FACT_LINE = 14;
/** Space between two columns of cards; links that go backwards run down the middle of it. */
export const COLUMN_GAP = 72;
const MAX_LINES = 3;

const TITLE_CHAR = 8; // 13px semibold, with room for words that break at hyphens
const MONO_CHAR = 6.5; // 10.5px monospace
const SANS_CHAR = 6.2; // 11px

const WIDTH: Record<TopoNode["kind"], number> = {
  internet: 160,
  loadbalancer: 236,
  controller: 256,
  ingress: 272,
  service: 252,
  workload: 340,
  pvc: 236,
  external: 256,
};

const BASE_HEIGHT: Record<TopoNode["kind"], number> = {
  internet: 64,
  loadbalancer: 70,
  controller: 70,
  ingress: 70,
  service: 70,
  workload: 0,
  pvc: 70,
  external: 70,
};

function lineCount(chars: number, perChar: number, available: number): number {
  return Math.min(MAX_LINES, Math.max(1, Math.ceil((chars * perChar) / Math.max(available, 40))));
}

/** How many lines the card's title needs. */
export function titleLines(node: Pick<TopoNode, "kind" | "title" | "tags" | "health">): number {
  const tags = node.tags.reduce((sum, t) => sum + t.length * 6 + 20, 0);
  const dot = node.health === "unknown" ? 0 : 18;
  // card padding, icon and its gap, then whatever sits beside the title
  return lineCount(node.title.length, TITLE_CHAR, WIDTH[node.kind] - 26 - 38 - tags - dot);
}

/** Height of one fact row: a label column on the left, a value that wraps on the right. */
export function factHeight(kind: TopoNode["kind"], fact: TopoFact): number {
  const lines = lineCount(fact.value.length, fact.mono ? MONO_CHAR : SANS_CHAR, WIDTH[kind] - 26 - 62);
  return Math.max(FACT_ROW, lines * FACT_LINE + 4);
}

/** The facts a workload card shows under its title (the rest are dropped to leave room for the pods). */
export function shownFacts(node: Pick<TopoNode, "kind" | "facts">): TopoFact[] {
  return node.kind === "workload" ? node.facts.slice(0, 2) : node.facts;
}

function factsHeight(node: Pick<TopoNode, "kind" | "facts">): number {
  return shownFacts(node).reduce((sum, f) => sum + factHeight(node.kind, f), 0);
}

/** Height of the part of a workload card above its pods. */
export function workloadHeaderHeight(node: Pick<TopoNode, "kind" | "title" | "tags" | "health" | "facts">): number {
  return WORKLOAD_HEADER + (titleLines(node) - 1) * TITLE_LINE + factsHeight(node);
}

export function nodeSize(node: Pick<TopoNode, "kind" | "title" | "tags" | "health" | "facts" | "pods">): { width: number; height: number } {
  const width = WIDTH[node.kind];
  if (node.kind === "workload") {
    const rows = Math.max(node.pods?.length ?? 0, 1);
    return { width, height: WORKLOAD_PADDING * 2 + workloadHeaderHeight(node) + rows * (POD_ROW_HEIGHT + POD_ROW_GAP) - POD_ROW_GAP };
  }
  return { width, height: BASE_HEIGHT[node.kind] + (titleLines(node) - 1) * TITLE_LINE + factsHeight(node) };
}
