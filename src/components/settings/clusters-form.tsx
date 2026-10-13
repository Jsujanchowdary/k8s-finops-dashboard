"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { CheckCircle2, CircleAlert, Loader2, Server, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Segmented } from "@/components/ui/controls";
import type { ClusterSummary, ConnectionCheck } from "@/lib/clusters/types";
import { PROVIDER_LABEL, PROVIDER_PRODUCT } from "@/lib/providers/detect";

const button = "inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50";
const primary = `${button} bg-accent text-white hover:bg-accent/90`;
const secondary = `${button} border border-border bg-surface hover:bg-surface-2`;
const danger = `${button} text-danger hover:bg-danger/10`;
const field = "w-full rounded-md border border-border bg-surface-2 px-3 font-mono text-sm placeholder:font-sans placeholder:text-muted focus:border-accent focus:outline-none";

type Reply = { error?: string; check?: ConnectionCheck; clusters?: ClusterSummary[]; id?: string };

async function call(body: Record<string, unknown>): Promise<{ status: number; data: Reply }> {
  const response = await fetch("/api/clusters", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: response.status, data: await response.json().catch(() => ({ error: "The dashboard answered with something unexpected." })) };
}

function Line({ ok, warn, children }: { ok: boolean; warn?: boolean; children: ReactNode }) {
  const Icon = ok ? CheckCircle2 : warn ? CircleAlert : XCircle;
  return (
    <li className="flex items-start gap-2 text-sm">
      <Icon className={`mt-0.5 size-4 shrink-0 ${ok ? "text-success" : warn ? "text-warning" : "text-danger"}`} aria-hidden />
      <span>{children}</span>
    </li>
  );
}

const READ_TEXT = { namespaces: "list namespaces", nodes: "list nodes", pods: "list pods" } as const;

function CheckView({ check }: { check: ConnectionCheck }) {
  if (!check.version) return null;
  return (
    <ul className="space-y-1">
      <Line ok>
        Reached the API server: Kubernetes <span className="font-mono text-xs">{check.version}</span>
        {check.provider && check.provider !== "kubernetes" ? ` on ${PROVIDER_LABEL[check.provider]} (${PROVIDER_PRODUCT[check.provider]})` : ""}.
      </Line>
      {(Object.keys(READ_TEXT) as (keyof typeof READ_TEXT)[]).map((k) => (
        <Line key={k} ok={check.reads[k] === "ok"} warn={check.reads[k] === "forbidden"}>
          {check.reads[k] === "ok" ? `Can ${READ_TEXT[k]}.` : check.reads[k] === "forbidden" ? `Not allowed to ${READ_TEXT[k]}.` : `Could not ${READ_TEXT[k]}.`}
        </Line>
      ))}
    </ul>
  );
}

function ClusterRow({ cluster, selected, busy, onSelect, onRemove }: { cluster: ClusterSummary; selected: boolean; busy: boolean; onSelect: () => void; onRemove: () => void }) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
      <Server className="size-4 shrink-0 text-muted" aria-hidden />
      <div className="min-w-0 flex-1 basis-60">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate font-mono text-sm">{cluster.name}</span>
          {cluster.provider ? <Badge>{cluster.provider === "kubernetes" ? "Kubernetes" : `${PROVIDER_LABEL[cluster.provider]} · ${PROVIDER_PRODUCT[cluster.provider]}`}</Badge> : null}
          <Badge tone={cluster.kind === "local" ? undefined : "info"}>{cluster.kind === "local" ? "this machine's kubeconfig" : `saved · ${cluster.auth}`}</Badge>
          {selected ? <Badge tone="success">Showing</Badge> : null}
        </div>
        <div className="truncate font-mono text-xs text-muted" title={cluster.server}>{cluster.server}</div>
      </div>
      <div className="flex items-center gap-1">
        {!selected ? <button type="button" className={secondary} disabled={busy} onClick={onSelect}>Show</button> : null}
        {cluster.kind === "saved" ? <button type="button" className={danger} disabled={busy} onClick={onRemove}>Remove</button> : null}
      </div>
    </li>
  );
}

/** The Clusters card: every cluster the dashboard can show, and a form to add one with a read-only token or a kubeconfig. */
export function ClustersForm({ initial, selected: initialSelected }: { initial: ClusterSummary[]; selected?: string }) {
  const router = useRouter();
  const [clusters, setClusters] = useState(initial);
  const [selected, setSelected] = useState(initialSelected);
  const [busy, setBusy] = useState<null | "test" | "add" | string>(null);
  const [listError, setListError] = useState<string | null>(null);

  const [mode, setMode] = useState<"token" | "kubeconfig">("token");
  const [name, setName] = useState("");
  const [server, setServer] = useState("");
  const [token, setToken] = useState("");
  const [ca, setCa] = useState("");
  const [kubeconfig, setKubeconfig] = useState("");
  const [result, setResult] = useState<{ ok: boolean; message?: string; check?: ConnectionCheck } | null>(null);

  const ready = mode === "token" ? name.trim() && server.trim() && token.trim() && ca.trim() : kubeconfig.trim();
  const payload = () => (mode === "token" ? { mode, name, server, token, ca } : { mode, kubeconfig, name: name.trim() || undefined });

  const submit = async (action: "test" | "add") => {
    setBusy(action);
    setResult(null);
    try {
      const { status, data } = await call({ action, ...payload() });
      if (status >= 400) setResult({ ok: false, message: data.error ?? "Something went wrong.", check: data.check });
      else if (action === "test") setResult({ ok: !!data.check?.ok, message: data.check?.ok ? "Everything the dashboard needs works. Add it to save." : data.check?.message, check: data.check });
      else {
        setResult({ ok: true, message: "Saved, and this browser now shows it.", check: data.check });
        if (data.clusters) setClusters(data.clusters);
        setSelected(data.id);
        setName("");
        setServer("");
        setToken("");
        setCa("");
        setKubeconfig("");
        router.refresh();
      }
    } catch {
      setResult({ ok: false, message: "Could not reach the dashboard's server." });
    } finally {
      setBusy(null);
    }
  };

  const select = async (id: string) => {
    setBusy(id);
    setListError(null);
    try {
      const { status, data } = await call({ action: "select", id });
      if (status >= 400) setListError(data.error ?? "Could not switch.");
      else {
        setSelected(id);
        router.refresh();
      }
    } finally {
      setBusy(null);
    }
  };

  const remove = async (c: ClusterSummary) => {
    if (!window.confirm(`Remove “${c.name}”? Its saved token is deleted from this machine. (The cluster itself is not touched.)`)) return;
    setBusy(c.id);
    setListError(null);
    try {
      const { status, data } = await call({ action: "remove", id: c.id });
      if (status >= 400) setListError(data.error ?? "Could not remove it.");
      else {
        if (data.clusters) setClusters(data.clusters);
        if (selected === c.id) setSelected(undefined);
        router.refresh();
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card>
      <CardHeader title="Clusters" subtitle="Every cluster the dashboard can show. Pick one here or in the top bar; each browser keeps its own choice." action={<Badge>{clusters.length}</Badge>} />
      <CardBody className="space-y-5">
        {clusters.length ? (
          <ul className="divide-y divide-border">
            {clusters.map((c) => (
              <ClusterRow key={c.id} cluster={c} selected={c.id === selected} busy={busy !== null} onSelect={() => void select(c.id)} onRemove={() => void remove(c)} />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">No cluster yet. Add one below.</p>
        )}
        {listError ? <p className="text-sm text-danger">{listError}</p> : null}

        <div className="space-y-3 border-t border-border pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">Add a cluster</h3>
            <Segmented
              label="How to connect"
              value={mode}
              onChange={(m) => {
                setMode(m);
                setResult(null);
              }}
              options={[
                { id: "token", label: "Read-only token" },
                { id: "kubeconfig", label: "Kubeconfig" },
              ]}
            />
          </div>

          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (ready) void submit("add");
            }}
          >
            <label className="block text-xs text-muted">
              Name{mode === "kubeconfig" ? " (optional: the context's name otherwise)" : ""}
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="prod-eks" autoComplete="off" spellCheck={false} className={`${field} mt-1 h-9`} />
            </label>
            {mode === "token" ? (
              <>
                <label className="block text-xs text-muted">
                  API server
                  <input value={server} onChange={(e) => setServer(e.target.value)} placeholder="https://xxxx.k8s.ondigitalocean.com" autoComplete="off" spellCheck={false} className={`${field} mt-1 h-9`} />
                </label>
                <label className="block text-xs text-muted">
                  ServiceAccount token
                  <input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="eyJhbGciOi…" autoComplete="off" spellCheck={false} className={`${field} mt-1 h-9`} />
                </label>
                <label className="block text-xs text-muted">
                  CA certificate (PEM, or base64 as in certificate-authority-data)
                  <textarea value={ca} onChange={(e) => setCa(e.target.value)} placeholder="-----BEGIN CERTIFICATE-----" rows={3} spellCheck={false} className={`${field} mt-1 py-2 text-xs`} />
                </label>
              </>
            ) : (
              <label className="block text-xs text-muted">
                Kubeconfig (its current context is used)
                <textarea value={kubeconfig} onChange={(e) => setKubeconfig(e.target.value)} placeholder="apiVersion: v1&#10;kind: Config&#10;clusters: …" rows={8} spellCheck={false} className={`${field} mt-1 py-2 text-xs`} />
              </label>
            )}
            <div className="flex flex-wrap gap-2 pt-1">
              <button type="button" className={secondary} disabled={!ready || busy !== null} onClick={() => void submit("test")}>
                {busy === "test" ? <Loader2 className="size-4 animate-spin" /> : null}
                Test
              </button>
              <button type="submit" className={primary} disabled={!ready || busy !== null}>
                {busy === "add" ? <Loader2 className="size-4 animate-spin" /> : null}
                {busy === "add" ? "Checking…" : "Add cluster"}
              </button>
            </div>
          </form>

          {result ? (
            <div className={`rounded-lg border p-3 ${result.ok ? "border-border bg-surface-2/50" : "border-danger/40 bg-danger/5"}`} role="status">
              {result.message ? <p className={`mb-1 text-sm ${result.ok ? "font-medium" : "text-danger"}`}>{result.message}</p> : null}
              {result.check ? <CheckView check={result.check} /> : null}
            </div>
          ) : null}

          <div className="space-y-1 text-xs text-muted">
            <p>
              Works with any cloud (DigitalOcean, AWS EKS, Azure AKS, Google GKE) or your own cluster. The best way in is a <span className="font-medium text-text">read-only ServiceAccount</span>: apply <span className="font-mono">deploy/read-only-rbac.yaml</span> to the cluster, then paste the API server, token and CA it prints. A token like that works the same on every cloud and never needs your own login.
            </p>
            <p>
              A kubeconfig is accepted only if its credentials are written inside it. Kubeconfigs made by <span className="font-mono">aws eks update-kubeconfig</span>, <span className="font-mono">az aks get-credentials</span>, <span className="font-mono">gcloud</span> or <span className="font-mono">doctl</span> run a program on your computer to log in, which the server cannot do, so use the token instead. Add checks the connection first (read-only, one item of each kind) and saves it only if it works.
            </p>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
