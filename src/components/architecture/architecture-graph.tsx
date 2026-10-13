"use client";

import "@xyflow/react/dist/base.css";
import { useCallback, useId, useMemo, useRef, useState } from "react";
import { applyNodeChanges, Background, BackgroundVariant, Controls, MarkerType, MiniMap, Panel, ReactFlow, type Edge, type Node, type NodeChange, type ReactFlowInstance, type Viewport } from "@xyflow/react";
import { Eye, EyeOff, X } from "lucide-react";
import { EmptyState } from "@/components/ui/misc";
import { toggleClass } from "@/components/ui/controls";
import { tracePath } from "@/lib/topology/trace";
import type { EdgeKind, LaidOutTopology, PlacedNode, TopoEdge } from "@/lib/topology/types";
import { Card, type CardData, type CardNode } from "./cards";
import { GutterEdge } from "./edges";

const NODE_TYPES = { card: Card };
const EDGE_TYPES = { gutter: GutterEdge };
const MIN_START_ZOOM = 0.45;

/** Changes when something is added or removed, which is when the layout has to be redone. */
function structureKey(t: LaidOutTopology): string {
  const nodes = t.nodes.map((n) => `${n.id}:${(n.pods ?? []).map((p) => p.id).join(",")}`);
  return `${t.namespace}|${nodes.join(";")}|${t.edges.map((e) => e.id).join(";")}`;
}

/** What survives a re-layout: where the user had zoomed to and which cards they had moved. */
class ViewMemory {
  viewport: Viewport | undefined;
  positions: Record<string, { x: number; y: number }> = {};
  moved(id: string, position: { x: number; y: number }) {
    this.positions[id] = position;
  }
  zoomed(viewport: Viewport) {
    this.viewport = viewport;
  }
}

const STROKE: Record<EdgeKind, { color: string; width: number; dash?: string }> = {
  route: { color: "var(--accent)", width: 1.75 },
  config: { color: "var(--muted)", width: 1.5, dash: "7 5" },
  mount: { color: "var(--muted)", width: 1.5, dash: "2 5" },
};

const shorten = (text: string, max = 38) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

function buildEdge(e: TopoEdge, byId: Map<string, PlacedNode>, opts: { animate: boolean; lit: Set<string> | null }): Edge {
  const source = byId.get(e.from);
  const target = byId.get(e.to);
  // A link back to something drawn to its left leaves from the left edge and enters the target from above (or below),
  // so it runs through the gaps between columns instead of behind the cards.
  const back = !!source && !!target && target.x < source.x + source.width;
  const targetBelow = !!source && !!target && target.y >= source.y;
  const style = !e.active ? { color: "var(--danger)", width: 1.5, dash: "3 4" } : STROKE[e.kind];
  const dimmed = opts.lit !== null && !opts.lit.has(e.id);
  const animated = opts.animate && e.kind === "route" && e.active && !dimmed;
  return {
    id: e.id,
    type: back ? "gutter" : "default",
    data: { enter: targetBelow ? "top" : "bottom" },
    source: e.from,
    target: e.to,
    sourceHandle: back ? "sl" : "r",
    targetHandle: back ? (targetBelow ? "t" : "b") : e.toPod ? `in:${e.toPod}` : "l",
    animated,
    label: e.label ? shorten(e.label) : undefined,
    labelStyle: { fontSize: 10.5, fill: "var(--muted)" },
    labelBgStyle: { fill: "var(--surface)", stroke: "var(--border)", strokeWidth: 1 },
    labelBgPadding: [6, 3],
    labelBgBorderRadius: 6,
    markerEnd: { type: MarkerType.ArrowClosed, color: style.color, width: 14, height: 14 },
    style: { stroke: style.color, strokeWidth: style.width, strokeDasharray: style.dash, opacity: dimmed ? 0.12 : e.active ? 1 : 0.75 },
    zIndex: opts.lit && !dimmed ? 10 : 0,
    selectable: false,
    focusable: false,
  };
}

function LegendLine({ kind, label }: { kind: "route" | "config" | "mount" | "inactive"; label: string }) {
  const s = kind === "inactive" ? { color: "var(--danger)", dash: "3 4" } : { color: STROKE[kind].color, dash: STROKE[kind].dash };
  return (
    <span className="inline-flex items-center gap-1.5">
      <svg width="28" height="8" aria-hidden><line x1="1" y1="4" x2="27" y2="4" stroke={s.color} strokeWidth="2" strokeDasharray={s.dash} strokeLinecap="round" /></svg>
      {label}
    </span>
  );
}

function Diagram({ topology, memory }: { topology: LaidOutTopology; memory: ViewMemory }) {
  const flowId = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const [animate, setAnimate] = useState(true);
  const [showConfig, setShowConfig] = useState(true);
  const [showStorage, setShowStorage] = useState(true);
  const [showMap, setShowMap] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

  // Position and measurements of the cards live here; their contents come from the latest topology each refresh.
  const [shells, setShells] = useState<Node[]>(() =>
    topology.nodes.map((n) => ({ id: n.id, type: "card", position: memory.positions[n.id] ?? { x: n.x, y: n.y }, width: n.width, height: n.height, selectable: false, data: {} })),
  );
  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      for (const c of changes) if (c.type === "position" && c.position) memory.moved(c.id, c.position);
      setShells((current) => applyNodeChanges(changes, current));
    },
    [memory],
  );

  const byId = useMemo(() => new Map(topology.nodes.map((n) => [n.id, n])), [topology]);
  const trace = useMemo(() => (selected ? tracePath(topology.nodes, topology.edges, selected) : null), [topology, selected]);

  const visibleEdges = useMemo(
    () => topology.edges.filter((e) => (showConfig || e.kind !== "config") && (showStorage || e.kind !== "mount")),
    [topology, showConfig, showStorage],
  );
  const hiddenNodes = useMemo(() => {
    const incident = new Map<string, number>();
    const visible = new Map<string, number>();
    const bump = (m: Map<string, number>, id: string) => m.set(id, (m.get(id) ?? 0) + 1);
    for (const e of topology.edges) {
      bump(incident, e.from);
      bump(incident, e.to);
    }
    for (const e of visibleEdges) {
      bump(visible, e.from);
      bump(visible, e.to);
    }
    return new Set(topology.nodes.filter((n) => (incident.get(n.id) ?? 0) > 0 && (visible.get(n.id) ?? 0) === 0).map((n) => n.id));
  }, [topology, visibleEdges]);

  const nodes = useMemo<CardNode[]>(
    () =>
      shells
        .filter((s) => byId.has(s.id))
        .map((s) => ({ ...s, type: "card", hidden: hiddenNodes.has(s.id), data: { node: byId.get(s.id)!, lit: trace?.ids ?? null, selected } satisfies CardData }) as CardNode),
    [shells, byId, hiddenNodes, trace, selected],
  );
  const edges = useMemo(
    () => visibleEdges.map((e) => buildEdge(e, byId, { animate, lit: trace?.edges ?? null })),
    [visibleEdges, byId, animate, trace],
  );

  // Fit the whole diagram when that is still readable. A wide one starts at a readable size on the left, where the request begins.
  const onInit = useCallback(
    (flow: ReactFlowInstance<CardNode, Edge>) => {
      if (memory.viewport) return;
      const box = canvasRef.current?.getBoundingClientRect();
      if (!box) return;
      const pad = 24;
      const zoom = Math.min(1, Math.max(MIN_START_ZOOM, Math.min((box.width - pad * 2) / topology.width, (box.height - pad * 2) / topology.height)));
      const x = topology.width * zoom <= box.width ? (box.width - topology.width * zoom) / 2 : pad;
      const y = topology.height * zoom <= box.height ? (box.height - topology.height * zoom) / 2 : pad;
      flow.setViewport({ x, y, zoom });
    },
    [memory, topology.width, topology.height],
  );

  const onNodeClick = useCallback((event: React.MouseEvent, node: Node) => {
    const pod = (event.target as HTMLElement).closest("[data-pod-id]")?.getAttribute("data-pod-id");
    const id = pod ?? node.id;
    setSelected((current) => (current === id ? null : id));
  }, []);

  const selectedTitle = selected ? (byId.get(selected)?.title ?? selected.replace(/^pod:[^/]+\//, "")) : null;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
          <LegendLine kind="route" label="Routed by Kubernetes" />
          <LegendLine kind="config" label="Configured link (from env values)" />
          <LegendLine kind="mount" label="Storage" />
          <LegendLine kind="inactive" label="Pod not receiving traffic" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" aria-pressed={animate} onClick={() => setAnimate((v) => !v)} className={toggleClass(animate)}>Show direction</button>
          <button type="button" aria-pressed={showConfig} onClick={() => setShowConfig((v) => !v)} className={toggleClass(showConfig)}>{showConfig ? <Eye className="size-3.5" aria-hidden /> : <EyeOff className="size-3.5" aria-hidden />}Configured links</button>
          <button type="button" aria-pressed={showStorage} onClick={() => setShowStorage((v) => !v)} className={toggleClass(showStorage)}>{showStorage ? <Eye className="size-3.5" aria-hidden /> : <EyeOff className="size-3.5" aria-hidden />}Storage</button>
          <button type="button" aria-pressed={showMap} onClick={() => setShowMap((v) => !v)} className={toggleClass(showMap)}>Mini map</button>
        </div>
      </div>

      <div ref={canvasRef} className="h-[calc(100vh-22rem)] min-h-[520px] overflow-hidden rounded-xl border border-border bg-surface/40" data-testid="architecture-canvas">
        <ReactFlow
          id={flowId}
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          edgeTypes={EDGE_TYPES}
          onNodesChange={onNodesChange}
          onNodeClick={onNodeClick}
          onPaneClick={() => setSelected(null)}
          onMoveEnd={(_, viewport) => memory.zoomed(viewport)}
          defaultViewport={memory.viewport}
          onInit={onInit}
          minZoom={0.15}
          maxZoom={1.6}
          nodesConnectable={false}
          elementsSelectable={false}
          deleteKeyCode={null}
          selectionKeyCode={null}
          zoomOnDoubleClick={false}
          proOptions={{ hideAttribution: false }}
          aria-label={`Architecture of ${topology.namespace}`}
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1.2} color="var(--border)" />
          <Controls showInteractive={false} position="bottom-right" />
          {showMap ? <MiniMap pannable zoomable position="bottom-left" nodeStrokeWidth={2} nodeColor={(n) => ((n.data as CardData).node.health === "critical" ? "var(--danger)" : (n.data as CardData).node.health === "warning" ? "var(--warning)" : "var(--muted)")} maskColor="color-mix(in srgb, var(--bg) 70%, transparent)" /> : null}
          <Panel position="top-center">
            {selectedTitle ? (
              <button type="button" onClick={() => setSelected(null)} className="inline-flex max-w-[min(32rem,70vw)] items-center gap-2 rounded-full border border-accent/40 bg-surface px-3 py-1 text-xs shadow-sm">
                <span className="shrink-0">Tracing</span>
                <span className="truncate font-mono font-medium" title={selectedTitle}>{selectedTitle}</span>
                <X className="size-3.5 shrink-0 text-muted" aria-label="Clear" />
              </button>
            ) : (
              <span className="rounded-full border border-border bg-surface/90 px-3 py-1 text-xs text-muted shadow-sm">Click a pod, service or workload to trace its path</span>
            )}
          </Panel>
        </ReactFlow>
      </div>

      <ul className="mt-3 space-y-1 text-xs text-muted">
        {animate ? <li>Moving dashes show the direction requests are routed, not measured traffic.</li> : null}
        {topology.notes.map((n) => <li key={n}>{n}</li>)}
      </ul>
    </div>
  );
}

export default function ArchitectureGraph({ topology }: { topology: LaidOutTopology }) {
  const [memory] = useState(() => new ViewMemory());
  if (topology.nodes.length === 0) {
    return <div className="rounded-xl border border-border bg-surface"><EmptyState title="Nothing to draw yet" hint="This namespace has no workloads, services or ingresses." /></div>;
  }
  // A new key (something was added or removed) rebuilds the diagram; a plain refresh only updates what the cards show.
  return <Diagram key={structureKey(topology)} topology={topology} memory={memory} />;
}
