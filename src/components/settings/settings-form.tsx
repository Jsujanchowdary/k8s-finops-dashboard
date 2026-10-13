"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { CheckCircle2, CircleAlert, KeyRound, Loader2, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import type { SettingKey } from "@/lib/settings/env-file";
import type { SettingStatus } from "@/lib/settings/store";
import { refreshLabel } from "@/lib/refresh";

type ScopeCheck = "ok" | "missing" | "error";
type DoCheck = { valid: boolean; message?: string; scopes: { kubernetes: ScopeCheck; billing: ScopeCheck; sizes: ScopeCheck }; clusterName?: string };
type AiCheck = { ok: true; model: string } | { ok: false; reason: string; message: string };
type Result = { ok: boolean; message?: string; check?: DoCheck | AiCheck };

const button = "inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50";
const primary = `${button} bg-accent text-white hover:bg-accent/90`;
const secondary = `${button} border border-border bg-surface hover:bg-surface-2`;
const danger = `${button} text-danger hover:bg-danger/10`;

async function call(body: Record<string, unknown>): Promise<{ status: number; data: { error?: string; settings?: SettingStatus[]; check?: DoCheck | AiCheck } }> {
  const response = await fetch("/api/settings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: response.status, data: await response.json().catch(() => ({ error: "The dashboard answered with something unexpected." })) };
}

function Saved({ status }: { status?: SettingStatus }) {
  if (!status?.set) return <Badge>Not set</Badge>;
  return (
    <span className="flex flex-wrap items-center gap-2">
      <Badge tone="success">Saved</Badge>
      <span className="font-mono text-xs text-muted">{status.shown}</span>
      <span className="text-xs text-muted">· {status.source === "settings page" ? "saved here" : "from .env.local"}</span>
    </span>
  );
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

/** One secret: paste, Connect (check, then save), Test what is saved, or Remove. */
function SecretCard({
  settingKey,
  title,
  subtitle,
  placeholder,
  help,
  status,
  onSaved,
  renderCheck,
  removeWarning,
}: {
  settingKey: SettingKey;
  title: string;
  subtitle: string;
  placeholder: string;
  help: ReactNode;
  status?: SettingStatus;
  onSaved: (settings?: SettingStatus[]) => void;
  renderCheck: (check: DoCheck | AiCheck) => ReactNode;
  removeWarning: string;
}) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState<null | "connect" | "test" | "remove">(null);
  const [result, setResult] = useState<Result | null>(null);

  const run = async (action: "connect" | "test" | "remove") => {
    if (action === "remove" && !window.confirm(removeWarning)) return;
    setBusy(action);
    setResult(null);
    try {
      const { status: code, data } = await call({ action, key: settingKey, ...(action === "connect" ? { value } : {}) });
      if (code >= 400) setResult({ ok: false, message: data.error ?? "Something went wrong.", check: data.check });
      else {
        setResult({ ok: true, check: data.check, message: action === "remove" ? "Removed." : action === "connect" ? "Saved to .env.local and in use now." : undefined });
        if (action !== "test") {
          setValue("");
          onSaved(data.settings);
        }
      }
    } catch {
      setResult({ ok: false, message: "Could not reach the dashboard's server." });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card>
      <CardHeader title={title} subtitle={subtitle} action={<Saved status={status} />} />
      <CardBody className="space-y-3">
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (value.trim()) void run("connect");
          }}
        >
          <label className="relative min-w-0 flex-1 basis-72">
            <span className="sr-only">{title}</span>
            <KeyRound className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted" />
            <input
              type="password"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={status?.set ? "Paste a new value to replace it" : placeholder}
              autoComplete="off"
              spellCheck={false}
              className="h-9 w-full rounded-md border border-border bg-surface-2 pl-8 pr-3 font-mono text-sm placeholder:font-sans placeholder:text-muted focus:border-accent focus:outline-none"
            />
          </label>
          <button type="submit" className={primary} disabled={!value.trim() || busy !== null}>
            {busy === "connect" ? <Loader2 className="size-4 animate-spin" /> : null}
            {busy === "connect" ? "Checking…" : "Connect"}
          </button>
          {status?.set ? (
            <>
              <button type="button" className={secondary} disabled={busy !== null} onClick={() => run("test")}>
                {busy === "test" ? <Loader2 className="size-4 animate-spin" /> : null}
                Test
              </button>
              <button type="button" className={danger} disabled={busy !== null} onClick={() => run("remove")}>Remove</button>
            </>
          ) : null}
        </form>

        {result ? (
          <div className={`rounded-lg border p-3 ${result.ok ? "border-border bg-surface-2/50" : "border-danger/40 bg-danger/5"}`} role="status">
            {result.message ? <p className={`mb-1 text-sm ${result.ok ? "font-medium" : "text-danger"}`}>{result.message}</p> : null}
            {result.check ? renderCheck(result.check) : null}
          </div>
        ) : null}

        <div className="text-xs text-muted">{help}</div>
      </CardBody>
    </Card>
  );
}

const SCOPE_TEXT: Record<"kubernetes" | "billing" | "sizes", { scope: string; used: string }> = {
  kubernetes: { scope: "kubernetes:read", used: "node pools, autoscaling and the cluster's name" },
  billing: { scope: "billing:read", used: "the FinOps page (spend, invoices, daily spend)" },
  sizes: { scope: "sizes:read", used: "node prices for the cost per namespace" },
};

function DoCheckView({ check }: { check: DoCheck }) {
  if (!check.valid) return null;
  return (
    <ul className="space-y-1">
      {(Object.keys(SCOPE_TEXT) as (keyof typeof SCOPE_TEXT)[]).map((k) => (
        <Line key={k} ok={check.scopes[k] === "ok"} warn={check.scopes[k] === "missing"}>
          <span className="font-mono text-xs">{SCOPE_TEXT[k].scope}</span>{" "}
          {check.scopes[k] === "ok" ? `works: ${SCOPE_TEXT[k].used}` : check.scopes[k] === "missing" ? `missing: add this scope for ${SCOPE_TEXT[k].used}` : `could not be checked`}
        </Line>
      ))}
      {check.clusterName ? <Line ok>Connected to the cluster “{check.clusterName}”.</Line> : null}
      {check.message ? <Line ok={false} warn>{check.message}</Line> : null}
    </ul>
  );
}

function AiCheckView({ check }: { check: AiCheck }) {
  return (
    <ul className="space-y-1">
      {check.ok ? <Line ok>The key works with <span className="font-mono text-xs">{check.model}</span>.</Line> : <Line ok={false} warn={check.reason !== "invalid-key"}>{check.message}</Line>}
    </ul>
  );
}

/** The Settings page's forms. Every change goes through /api/settings, which checks it before saving. */
export function SettingsForm({ initial, refreshPresets, aiModel, aiEnabled }: { initial: SettingStatus[]; refreshPresets: number[]; aiModel: string; aiEnabled: boolean }) {
  const router = useRouter();
  const [settings, setSettings] = useState(initial);
  const statusOf = (key: SettingKey) => settings.find((s) => s.key === key);
  // Saved: re-read the pages so FinOps, node pools and the assistant pick the change up now.
  const onSaved = (next?: SettingStatus[]) => {
    if (next) setSettings(next);
    router.refresh();
  };

  const refresh = statusOf("NEXT_PUBLIC_REFRESH_SECONDS");
  const [seconds, setSeconds] = useState(refresh?.shown ?? "30");
  const [refreshState, setRefreshState] = useState<null | "saving" | "saved" | string>(null);
  const saveRefresh = async () => {
    setRefreshState("saving");
    try {
      const { status: code, data } = await call({ action: "connect", key: "NEXT_PUBLIC_REFRESH_SECONDS", value: seconds });
      if (code >= 400) setRefreshState(data.error ?? "Could not save.");
      else {
        setRefreshState("saved");
        onSaved(data.settings);
      }
    } catch {
      setRefreshState("Could not reach the dashboard's server.");
    }
  };

  return (
    <div className="space-y-4">
      <SecretCard
        settingKey="DIGITALOCEAN_TOKEN"
        title="DigitalOcean"
        subtitle="A read-only API token. Used for node pools and autoscaling, the FinOps page and the cost per namespace."
        placeholder="dop_v1_…"
        status={statusOf("DIGITALOCEAN_TOKEN")}
        onSaved={onSaved}
        renderCheck={(c) => <DoCheckView check={c as DoCheck} />}
        removeWarning="Remove the DigitalOcean token? Node pools and the FinOps page stop working until you add one again."
        help={
          <>
            Create one at cloud.digitalocean.com → API → Tokens → Generate New Token, with <span className="font-medium text-text">Custom Scopes</span>: <span className="font-mono">kubernetes:read</span>, <span className="font-mono">billing:read</span> and <span className="font-mono">sizes:read</span> (all read-only). Connect checks it with one read-only request per scope before saving.
          </>
        }
      />

      <SecretCard
        settingKey="GEMINI_API_KEY"
        title="AI assistant (Google Gemini)"
        subtitle={aiEnabled ? `Answers questions about the cluster with ${aiModel}.` : "The assistant is turned off (ENABLE_AI=false), but you can still save a key."}
        placeholder="AIza…"
        status={statusOf("GEMINI_API_KEY")}
        onSaved={onSaved}
        renderCheck={(c) => <AiCheckView check={c as AiCheck} />}
        removeWarning="Remove the Gemini key? The AI assistant stops working until you add one again."
        help={
          <>
            Create one at aistudio.google.com/apikey. Connect checks it by looking up the model ({aiModel}); no cluster data is sent. Each question you ask later sends a snapshot of the cluster to Google, as the assistant page explains.
          </>
        }
      />

      <Card>
        <CardHeader title="Default auto-refresh" subtitle="How often pages re-read the cluster for anyone who has not picked their own interval in the top bar." action={<Badge>{refresh?.set ? `Now ${refreshLabel(Number(refresh.shown))}` : "Now 30s (default)"}</Badge>} />
        <CardBody className="flex flex-wrap items-center gap-2">
          <label className="text-sm">
            <span className="sr-only">Default auto-refresh</span>
            <select
              value={seconds}
              onChange={(e) => {
                setSeconds(e.target.value);
                setRefreshState(null);
              }}
              className="h-9 rounded-md border border-border bg-surface-2 px-2.5 text-sm focus:border-accent focus:outline-none"
            >
              {refreshPresets.map((s) => <option key={s} value={String(s)}>{refreshLabel(s)}</option>)}
            </select>
          </label>
          <button type="button" className={primary} onClick={saveRefresh} disabled={refreshState === "saving"}>
            {refreshState === "saving" ? <Loader2 className="size-4 animate-spin" /> : null}
            Save
          </button>
          {refreshState === "saved" ? <span className="text-sm text-success">Saved. New visitors get this; your own choice in the top bar still wins in this browser.</span> : null}
          {refreshState && refreshState !== "saved" && refreshState !== "saving" ? <span className="text-sm text-danger">{refreshState}</span> : null}
        </CardBody>
      </Card>
    </div>
  );
}
