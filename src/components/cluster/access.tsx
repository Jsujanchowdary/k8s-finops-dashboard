import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { Badge, type Tone } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { CAPABILITIES, type Capability, type Grant, type NamespaceAccess, type Reach, type Severity, type SubjectAccess } from "@/lib/k8s/access";

const TONE: Record<Severity, Tone> = { critical: "danger", high: "warning", medium: "info", low: "neutral" };
const nsHref = (ns: string) => `/namespaces/${encodeURIComponent(ns)}`;

const scopeText = (c: Capability) => (c.scope === "cluster" ? "cluster-wide" : c.scope.length === 1 ? `in ${c.scope[0]}` : `in ${c.scope.length} namespaces`);

export function CapabilityChip({ c }: { c: Capability }) {
  const info = CAPABILITIES[c.id];
  return (
    <span title={`${info.meaning}${c.scope !== "cluster" ? ` Namespaces: ${c.scope.join(", ")}.` : ""}${c.limited ? " Only for a few named objects." : ""}`}>
      <Badge tone={TONE[c.severity]}>
        {info.label}
        <span className="font-normal opacity-75">· {scopeText(c)}{c.limited ? " · named only" : ""}</span>
      </Badge>
    </span>
  );
}

function Capabilities({ s }: { s: SubjectAccess }) {
  if (!s.capabilities.length) return <span className="text-xs text-muted">nothing notable</span>;
  return <div className="flex flex-wrap gap-1">{s.capabilities.map((c) => <CapabilityChip key={c.id} c={c} />)}</div>;
}

export function GrantsTable({ grants }: { grants: Grant[] }) {
  return (
    <TableWrap>
      <Table>
        <thead><tr><Th>Granted by</Th><Th>Role</Th><Th>Where</Th><Th>Rules (verbs on resources)</Th></tr></thead>
        <tbody>
          {grants.map((g) => (
            <tr key={`${g.bindingKind}/${g.binding}`}>
              <Td className="font-mono text-xs">{g.binding}<span className="block text-[11px] text-muted">{g.bindingKind}</span></Td>
              <Td className="font-mono text-xs">{g.role}<span className="block text-[11px] text-muted">{g.roleKind}{g.missingRole ? " · does not exist" : ""}</span></Td>
              <Td className="text-xs">{g.scope === "cluster" ? "cluster-wide" : <Link href={nsHref(g.scope)} className="font-mono hover:text-accent">{g.scope}</Link>}</Td>
              <Td wrap>
                <ul className="space-y-0.5 font-mono text-[11px] text-muted">
                  {g.rules.slice(0, 12).map((r, i) => (
                    <li key={i}>
                      <span className="text-text">{r.verbs.join(",")}</span>{" "}
                      {r.nonResourceURLs.length ? `URLs ${r.nonResourceURLs.join(",")}` : `${r.resources.join(",")}${r.apiGroups.some((a) => a !== "core") ? ` (${r.apiGroups.join(",")})` : ""}`}
                      {r.resourceNames.length ? ` · only ${r.resourceNames.join(",")}` : ""}
                    </li>
                  ))}
                  {g.rules.length > 12 ? <li>+{g.rules.length - 12} more rules</li> : null}
                  {g.rules.length === 0 ? <li>{g.missingRole ? "the role does not exist, so this grants nothing" : "no rules"}</li> : null}
                </ul>
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </TableWrap>
  );
}

function Expander({ summary, children }: { summary: ReactNode; children: ReactNode }) {
  return (
    <details className="group">
      <summary className="flex cursor-pointer list-none items-start gap-2 px-4 py-2.5 hover:bg-surface-2 [&::-webkit-details-marker]:hidden">
        <ChevronRight className="mt-0.5 size-3.5 shrink-0 text-muted transition-transform group-open:rotate-90" />
        {summary}
      </summary>
      <div className="pb-3 pl-5">{children}</div>
    </details>
  );
}

/** One row per subject: who, what it can do, and (expanded) every binding and rule behind it. */
export function SubjectList({ subjects, showUsage }: { subjects: SubjectAccess[]; showUsage: boolean }) {
  return (
    <ul className="divide-y divide-border">
      {subjects.map((s) => (
        <li key={`${s.kind}/${s.namespace ?? ""}/${s.name}`}>
          <Expander
            summary={
              <span className="grid min-w-0 flex-1 gap-1.5 md:grid-cols-[minmax(0,18rem)_1fr]">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium" title={s.label}>{s.label}</span>
                  <span className="block truncate text-[11px] text-muted">
                    {s.kind}
                    {showUsage && s.kind === "ServiceAccount" ? <> · {s.usedBy.length ? `used by ${s.usedBy.join(", ")}` : "no running pod uses it"}</> : null}
                  </span>
                </span>
                <Capabilities s={s} />
              </span>
            }
          >
            <GrantsTable grants={s.grants} />
          </Expander>
        </li>
      ))}
    </ul>
  );
}

export function NoAccessCard({ accounts }: { accounts: { namespace: string; name: string; usedBy: string[] }[] }) {
  return (
    <Card>
      <CardHeader title="Apps with no Kubernetes API access" subtitle="Their ServiceAccount has no permissions at all, so even if one is compromised it cannot read or change anything in the cluster. This is the safe default." action={<Badge tone="success">{accounts.length}</Badge>} />
      {accounts.length === 0 ? (
        <CardBody className="text-sm text-muted">Every app&apos;s ServiceAccount has some permission.</CardBody>
      ) : (
        <TableWrap>
          <Table>
            <thead><tr><Th>ServiceAccount</Th><Th>Used by</Th></tr></thead>
            <tbody>
              {accounts.map((a) => (
                <tr key={`${a.namespace}/${a.name}`}>
                  <Td className="font-mono text-xs"><Link href={nsHref(a.namespace)} className="hover:text-accent">{a.namespace}</Link>/{a.name}</Td>
                  <Td wrap className="font-mono text-xs text-muted">{a.usedBy.join(", ")}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      )}
    </Card>
  );
}

export function CapabilityLegend() {
  return (
    <Card>
      <CardBody className="space-y-1.5 text-xs text-muted">
        <p className="font-medium text-text">What each capability means</p>
        <ul className="grid gap-x-8 gap-y-1 md:grid-cols-2">
          {Object.values(CAPABILITIES).map((c) => (
            <li key={c.label}><span className="font-medium text-text">{c.label}</span>: {c.meaning.replace(/`/g, "")}</li>
          ))}
        </ul>
        <p>Colour: red can take over the cluster, amber is powerful cluster-wide, blue is powerful in some namespaces, grey is minor. Hover a chip for details; open a row to see every binding and rule behind it.</p>
      </CardBody>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// The Access tab of a namespace page
// ---------------------------------------------------------------------------

function ReachLine({ title, reach }: { title: string; reach: Reach }) {
  const parts = [
    reach.people.length ? <span key="p"><span className="text-muted">People:</span> {reach.people.map((p) => p.replace("DigitalOcean team role: ", "")).join(", ").replace("DigitalOcean-issued kubeconfig (doctl / control panel download)", "DigitalOcean-issued kubeconfig")}</span> : null,
    reach.apps.length ? <span key="a"><span className="text-muted">Apps and operators:</span> <span className="font-mono text-xs">{reach.apps.join(", ")}</span></span> : null,
    reach.system ? <span key="s" className="text-muted">{reach.system} system component{reach.system === 1 ? "" : "s"}</span> : null,
  ].filter(Boolean);
  return (
    <li className="px-4 py-2.5">
      <p className="text-sm font-medium">{title}</p>
      <p className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-sm">{parts}</p>
    </li>
  );
}

export function NamespaceAccessView({ ns, view }: { ns: string; view: NamespaceAccess }) {
  const reachTitle: Partial<Record<string, string>> = {
    rbac: "Can grant themselves any access",
    "secrets-read": `Can read the Secrets in ${ns}`,
    "secrets-write": "Can create, change or delete its Secrets",
    exec: "Can exec into its pods",
    workloads: "Can change its workloads",
    tokens: "Can create tokens for its ServiceAccounts",
    roles: "Can create roles and bindings here",
  };
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="This namespace's apps" subtitle="The ServiceAccount each workload here runs as, and what it can do in the cluster. No API access is the safe default for an ordinary app." />
        {view.apps.length === 0 ? (
          <CardBody className="text-sm text-muted">No pod runs in this namespace.</CardBody>
        ) : (
          <ul className="divide-y divide-border">
            {view.apps.map((a) => (
              <li key={a.name}>
                <Expander
                  summary={
                    <span className="grid min-w-0 flex-1 gap-1.5 md:grid-cols-[minmax(0,18rem)_1fr]">
                      <span className="min-w-0">
                        <span className="block truncate font-mono text-sm font-medium">{a.name}</span>
                        <span className="block truncate text-[11px] text-muted">used by {a.usedBy.join(", ")}</span>
                      </span>
                      {a.capabilities.length ? (
                        <div className="flex flex-wrap gap-1">{a.capabilities.map((c) => <CapabilityChip key={c.id} c={c} />)}</div>
                      ) : a.grants.length ? (
                        <span className="text-xs text-muted">bound to roles, but nothing notable</span>
                      ) : (
                        <span className="justify-self-start"><Badge tone="success">No Kubernetes API access</Badge></span>
                      )}
                    </span>
                  }
                >
                  {a.grants.length ? <GrantsTable grants={a.grants} /> : <p className="px-4 text-xs text-muted">No Role or ClusterRole is bound to this ServiceAccount, so it cannot read or change anything through the Kubernetes API.</p>}
                </Expander>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader title="Granted inside this namespace" subtitle="RoleBindings that live in this namespace, whoever they grant to, and what they allow here." />
        {view.boundHere.length === 0 ? (
          <CardBody className="text-sm text-muted">No RoleBindings in this namespace. Anything below comes from cluster-wide access.</CardBody>
        ) : (
          <ul className="divide-y divide-border">
            {view.boundHere.map((b) => (
              <li key={b.label}>
                <Expander
                  summary={
                    <span className="grid min-w-0 flex-1 gap-1.5 md:grid-cols-[minmax(0,18rem)_1fr]">
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium" title={b.label}>{b.label}</span>
                        <span className="block truncate text-[11px] text-muted">{b.kind} · {b.category === "system" ? "system" : b.category === "people" ? "people" : "app or operator"}</span>
                      </span>
                      {b.capabilities.length ? <div className="flex flex-wrap gap-1">{b.capabilities.map((c) => <CapabilityChip key={c.id} c={c} />)}</div> : <span className="text-xs text-muted">nothing notable</span>}
                    </span>
                  }
                >
                  <GrantsTable grants={b.grants} />
                </Expander>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Who else can reach in"
          subtitle="People and other namespaces' accounts whose access covers this namespace, mostly through cluster-wide roles. The full admins can do everything listed. Grants limited to a few named objects are left out."
          action={<Link href="/access" className="whitespace-nowrap text-xs text-accent hover:underline">All access</Link>}
        />
        <ul className="divide-y divide-border">
          {view.admins.people.length + view.admins.apps.length + view.admins.system > 0 ? <ReachLine title="Full admins: can do everything here" reach={view.admins} /> : null}
          {view.reach.map((r) => (
            <ReachLine key={r.id} title={reachTitle[r.id] ?? CAPABILITIES[r.id].label} reach={r} />
          ))}
          {view.reach.length === 0 && view.admins.people.length + view.admins.apps.length + view.admins.system === 0 ? <li className="px-4 py-3 text-sm text-muted">Nobody outside this namespace has notable access to it.</li> : null}
        </ul>
      </Card>
    </div>
  );
}
