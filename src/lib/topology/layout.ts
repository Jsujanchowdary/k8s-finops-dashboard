// Left-to-right layered layout: Internet on the left, pods and what they depend on to the right.
// Runs on the server; the browser only draws the positions it is given.

import { Graph, layout } from "@dagrejs/dagre";
import { COLUMN_GAP, nodeSize } from "./sizes";
import type { LaidOutTopology, PlacedNode, Topology } from "./types";

const MARGIN = 24;
const GAP = 36;
const ISOLATED_WIDTH = 1500;

export function layoutTopology(topology: Topology): LaidOutTopology {
  const sizes = new Map(topology.nodes.map((n) => [n.id, nodeSize(n)]));

  // Columns follow how requests travel. A configured link to something that already sits on the request path
  // (the UI calling the API's Service) must not stretch the layout, so it takes no part in choosing columns;
  // it is drawn afterwards. Links to things only reachable that way (a database, another namespace) do count.
  const routed = new Set(topology.edges.filter((e) => e.kind === "route").map((e) => e.to));
  const ranking = topology.edges.filter((e) => e.from !== e.to && (e.kind !== "config" || !routed.has(e.to)));

  const touched = new Set(topology.edges.flatMap((e) => [e.from, e.to]));
  const connected = topology.nodes.filter((n) => touched.has(n.id));
  const isolated = topology.nodes.filter((n) => !touched.has(n.id));

  const graph = new Graph();
  graph.setGraph({ rankdir: "LR", nodesep: GAP, ranksep: COLUMN_GAP, marginx: MARGIN, marginy: MARGIN, ranker: "network-simplex" });
  graph.setDefaultEdgeLabel(() => ({}));
  for (const n of connected) graph.setNode(n.id, { ...sizes.get(n.id)! });
  // Edges between pods and the workload are the same edge as far as the layout is concerned.
  const seen = new Set<string>();
  for (const e of ranking) {
    const k = `${e.from}>${e.to}`;
    if (seen.has(k)) continue;
    seen.add(k);
    graph.setEdge(e.from, e.to);
  }
  layout(graph);

  let width = 0;
  let height = 0;
  const placed: PlacedNode[] = connected.map((n) => {
    const at = graph.node(n.id);
    const size = sizes.get(n.id)!;
    // dagre reports centres; the diagram wants top-left corners.
    const x = Math.round(at.x - size.width / 2);
    const y = Math.round(at.y - size.height / 2);
    width = Math.max(width, x + size.width + MARGIN);
    height = Math.max(height, y + size.height + MARGIN);
    return { ...n, x, y, ...size };
  });

  // Workloads and volumes that nothing connects to go in a tidy block underneath.
  let x = MARGIN;
  let y = connected.length ? height + GAP : MARGIN;
  let rowHeight = 0;
  const limit = Math.max(width, ISOLATED_WIDTH);
  for (const n of isolated) {
    const size = sizes.get(n.id)!;
    if (x > MARGIN && x + size.width > limit) {
      x = MARGIN;
      y += rowHeight + GAP;
      rowHeight = 0;
    }
    placed.push({ ...n, x, y, ...size });
    width = Math.max(width, x + size.width + MARGIN);
    height = Math.max(height, y + size.height + MARGIN);
    x += size.width + GAP;
    rowHeight = Math.max(rowHeight, size.height);
  }

  return { namespace: topology.namespace, nodes: placed, edges: topology.edges, notes: topology.notes, width, height };
}
