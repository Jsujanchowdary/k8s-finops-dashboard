"use client";

import dynamic from "next/dynamic";
import type { LaidOutTopology } from "@/lib/topology/types";

// The diagram measures the screen, so it is drawn in the browser only.
const ArchitectureGraph = dynamic(() => import("./architecture-graph"), {
  ssr: false,
  loading: () => <div className="h-[calc(100vh-22rem)] min-h-[520px] animate-pulse rounded-xl border border-border bg-surface" aria-label="Loading diagram" />,
});

export function Architecture({ topology }: { topology: LaidOutTopology }) {
  return <ArchitectureGraph topology={topology} />;
}
