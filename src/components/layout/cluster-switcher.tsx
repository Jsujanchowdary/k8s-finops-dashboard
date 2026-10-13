"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ChevronDown, Loader2, Server } from "lucide-react";
import type { ClusterSummary } from "@/lib/clusters/types";
import { PROVIDER_PRODUCT } from "@/lib/providers/detect";

/** Which cluster this browser looks at. The choice is a cookie holding the cluster's id; the pages then re-render. */
export function ClusterSwitcher({ clusters, selected }: { clusters: ClusterSummary[]; selected?: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const current = clusters.find((c) => c.id === selected);

  const choose = async (id: string) => {
    setError(null);
    try {
      const response = await fetch("/api/clusters", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "select", id }) });
      if (!response.ok) {
        setError(((await response.json().catch(() => ({}))) as { error?: string }).error ?? "Could not switch.");
        return;
      }
      startTransition(() => router.refresh());
    } catch {
      setError("Could not reach the dashboard's server.");
    }
  };

  if (clusters.length === 0) return <span className="text-sm text-muted">No cluster</span>;

  return (
    <label className="relative flex items-center" title={error ?? current?.server}>
      <span className="sr-only">Cluster</span>
      {pending ? <Loader2 className="pointer-events-none absolute left-2 size-3.5 animate-spin text-muted" aria-hidden /> : <Server className="pointer-events-none absolute left-2 size-3.5 text-muted" aria-hidden />}
      <select
        value={selected ?? ""}
        onChange={(e) => void choose(e.target.value)}
        disabled={pending}
        aria-invalid={error ? true : undefined}
        className={`h-7 max-w-64 appearance-none truncate rounded-md border bg-surface pl-7 pr-7 font-mono text-xs text-text focus:border-accent focus:outline-none disabled:opacity-60 ${error ? "border-danger" : "border-border"}`}
      >
        {clusters.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
            {c.provider && c.provider !== "kubernetes" ? ` · ${PROVIDER_PRODUCT[c.provider]}` : ""}
            {c.kind === "local" ? " · local" : ""}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 size-3.5 text-muted" aria-hidden />
    </label>
  );
}
