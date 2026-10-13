// "How does a request reach this pod, and what does it use?" Given one thing in the diagram, find everything
// upstream of it (back to the Internet) and downstream of it (the services, databases and volumes it uses).

import type { TopoEdge, TopoNode } from "./types";

export interface Trace {
  /** Node ids and pod ids to keep lit. */
  ids: Set<string>;
  edges: Set<string>;
}

export function tracePath(nodes: TopoNode[], edges: TopoEdge[], selected: string): Trace {
  const podsOf = new Map<string, string[]>();
  const workloadOf = new Map<string, string>();
  for (const n of nodes) {
    if (n.kind !== "workload") continue;
    podsOf.set(n.id, (n.pods ?? []).map((p) => p.id));
    for (const p of n.pods ?? []) workloadOf.set(p.id, n.id);
  }

  // Everything that can be the end of an edge when `id` is selected: a workload also counts as its pods.
  const targets = (id: string) => [id, ...(podsOf.get(id) ?? [])];
  // Everything that can be the start of an edge: a pod starts the edges of its workload.
  const sources = (id: string) => (workloadOf.has(id) ? [workloadOf.get(id)!] : [id]);

  const ids = new Set<string>([selected]);
  const lit = new Set<string>();

  // Upstream: who sends traffic here.
  const up = [selected];
  const seenUp = new Set<string>();
  while (up.length) {
    const current = up.pop()!;
    if (seenUp.has(current)) continue;
    seenUp.add(current);
    const own = new Set(targets(current));
    for (const e of edges) {
      if (!own.has(e.toPod ?? e.to)) continue;
      lit.add(e.id);
      ids.add(e.from);
      if (e.toPod) {
        ids.add(e.toPod);
        ids.add(e.to);
      }
      up.push(e.from);
    }
  }

  // Downstream: what this uses.
  const down = [selected];
  const seenDown = new Set<string>();
  while (down.length) {
    const current = down.pop()!;
    if (seenDown.has(current)) continue;
    seenDown.add(current);
    const own = new Set(sources(current));
    if (podsOf.has(current)) for (const p of podsOf.get(current)!) ids.add(p);
    for (const e of edges) {
      if (!own.has(e.from)) continue;
      lit.add(e.id);
      ids.add(e.from);
      ids.add(e.to);
      if (e.toPod) ids.add(e.toPod);
      down.push(e.to);
    }
  }

  // A selected pod lights its own card.
  const owner = workloadOf.get(selected);
  if (owner) ids.add(owner);
  return { ids, edges: lit };
}
