// Who and what can act on the cluster, from its RBAC: every subject (people through DigitalOcean team roles,
// ServiceAccounts used by apps and operators, system components), the roles bound to it, and what those roles let it
// do, summarised as a few capabilities that matter (full admin, granting access, reading or changing Secrets, exec
// into pods, changing workloads...). Pure: it reads Role, ClusterRole, binding and ServiceAccount objects and the pod
// specs already loaded (which ServiceAccount each pod runs as). Secrets themselves are never read; only which roles
// may read them.

import type { RbacV1Subject, V1ClusterRole, V1ClusterRoleBinding, V1Pod, V1PolicyRule, V1Role, V1RoleBinding } from "@kubernetes/client-node";

export interface RbacRaw {
  clusterRoles: V1ClusterRole[];
  clusterRoleBindings: V1ClusterRoleBinding[];
  roles: V1Role[];
  roleBindings: V1RoleBinding[];
}

export type AccessData = { state: "ok"; report: AccessReport } | { state: "error"; message: string };

export type Severity = "critical" | "high" | "medium" | "low";

export type CapabilityId = "admin" | "rbac" | "roles" | "tokens" | "secrets-read" | "secrets-write" | "exec" | "workloads" | "nodes" | "read" | "auth-checks";

export const CAPABILITIES: Record<CapabilityId, { label: string; meaning: string }> = {
  admin: { label: "Full admin", meaning: "Can do anything to anything (the cluster-admin role or `*` on everything)." },
  rbac: { label: "Can grant itself any access", meaning: "Has `escalate`, `bind` or `impersonate` on roles, bindings or users, so it can give itself (or anyone) any permission." },
  roles: { label: "Manages roles", meaning: "Can create roles and bindings. Kubernetes only lets it hand out permissions it already has, so it can spread its own access but not raise it." },
  tokens: { label: "Creates ServiceAccount tokens", meaning: "Can mint tokens for ServiceAccounts and act as them." },
  "secrets-read": { label: "Reads Secrets", meaning: "Can read Secret values: passwords, API keys, TLS private keys." },
  "secrets-write": { label: "Changes Secrets", meaning: "Can create, change or delete Secrets." },
  exec: { label: "Exec into pods", meaning: "Can open a shell in running containers (and see everything they can)." },
  workloads: { label: "Changes workloads", meaning: "Can create, change or delete pods, Deployments, StatefulSets, DaemonSets or Jobs." },
  nodes: { label: "Changes nodes", meaning: "Can change or remove nodes." },
  read: { label: "Reads most resources", meaning: "Can see pods, Deployments, Services and ConfigMaps (not Secrets unless listed separately)." },
  "auth-checks": { label: "Checks tokens", meaning: "Can ask Kubernetes whether a token or request is valid (TokenReview / SubjectAccessReview), as login integrations need." },
};

export interface Capability {
  id: CapabilityId;
  /** "cluster" or the namespaces it applies in. */
  scope: "cluster" | string[];
  /** Only for a few named objects (resourceNames), so much narrower. */
  limited: boolean;
  severity: Severity;
}

export interface Grant {
  binding: string;
  bindingKind: "ClusterRoleBinding" | "RoleBinding";
  /** Where it applies: "cluster" for a ClusterRoleBinding, otherwise the RoleBinding's namespace. */
  scope: string;
  roleKind: string;
  role: string;
  rules: RuleView[];
  /** The role it points to does not exist. */
  missingRole: boolean;
}

export interface RuleView {
  verbs: string[];
  resources: string[];
  apiGroups: string[];
  resourceNames: string[];
  nonResourceURLs: string[];
}

export type SubjectCategory = "people" | "apps" | "system";

export interface SubjectAccess {
  kind: "ServiceAccount" | "User" | "Group";
  name: string;
  namespace?: string;
  /** Plain-language name, e.g. "DigitalOcean team Owners". */
  label: string;
  category: SubjectCategory;
  grants: Grant[];
  capabilities: Capability[];
  /** The most serious capability, or null when it can do nothing notable. */
  severity: Severity | null;
  /** For ServiceAccounts: the workloads whose pods run as it. */
  usedBy: string[];
}

export interface AccessReport {
  subjects: SubjectAccess[];
  /** ServiceAccounts your pods run as that have no permissions at all (cannot use the Kubernetes API). */
  noAccess: { namespace: string; name: string; usedBy: string[] }[];
}

const SYSTEM_NAMESPACES = new Set(["kube-system", "kube-public", "kube-node-lease"]);
const SEVERITY_RANK: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

// ---------------------------------------------------------------------------
// Matching rules
// ---------------------------------------------------------------------------

const has = (list: string[] | undefined, value: string) => (list ?? []).includes("*") || (list ?? []).includes(value);

function resourceMatches(resources: string[] | undefined, resource: string): boolean {
  const list = resources ?? [];
  if (list.includes("*") || list.includes(resource)) return true;
  const slash = resource.indexOf("/");
  return slash > 0 && list.includes(`*${resource.slice(slash)}`);
}

/** Does any rule allow one of `verbs` on `group`/`resource`? `limited` when only through resourceNames. */
export function allows(rules: V1PolicyRule[], group: string, resource: string, verbs: string[]): { allowed: boolean; limited: boolean } {
  let limited = false;
  for (const r of rules) {
    if (!has(r.apiGroups, group) || !resourceMatches(r.resources, resource) || !verbs.some((v) => has(r.verbs, v))) continue;
    if ((r.resourceNames ?? []).length === 0) return { allowed: true, limited: false };
    limited = true;
  }
  return { allowed: limited, limited };
}

const WRITE = ["create", "update", "patch", "delete", "deletecollection"];
const READ = ["get", "list", "watch"];

/** The capabilities a set of rules gives, in the order of how serious they are. */
export function capabilitiesOf(rules: V1PolicyRule[]): { id: CapabilityId; limited: boolean }[] {
  const out: { id: CapabilityId; limited: boolean }[] = [];
  const push = (id: CapabilityId, r: { allowed: boolean; limited: boolean }) => r.allowed && out.push({ id, limited: r.limited });
  const any = (...checks: { allowed: boolean; limited: boolean }[]) => {
    const hit = checks.filter((c) => c.allowed);
    return { allowed: hit.length > 0, limited: hit.length > 0 && hit.every((c) => c.limited) };
  };

  if (rules.some((r) => has(r.apiGroups, "*") && (r.resources ?? []).includes("*") && (r.verbs ?? []).includes("*") && (r.resourceNames ?? []).length === 0)) {
    return [{ id: "admin", limited: false }];
  }
  const rbacGroup = "rbac.authorization.k8s.io";
  // Kubernetes refuses to let anyone grant permissions they do not hold, unless they have `escalate` (roles) or
  // `bind` (bindings), or can impersonate someone who does. Only those let a subject raise its own access.
  push("rbac", any(
    ...["roles", "clusterroles"].map((res) => allows(rules, rbacGroup, res, ["escalate"])),
    ...["rolebindings", "clusterrolebindings", "roles", "clusterroles"].map((res) => allows(rules, rbacGroup, res, ["bind"])),
    allows(rules, "", "users", ["impersonate"]), allows(rules, "", "groups", ["impersonate"]), allows(rules, "", "serviceaccounts", ["impersonate"]),
  ));
  if (!out.some((c) => c.id === "rbac")) push("roles", any(...["roles", "rolebindings", "clusterroles", "clusterrolebindings"].map((res) => allows(rules, rbacGroup, res, ["create", "update", "patch"]))));
  push("tokens", allows(rules, "", "serviceaccounts/token", ["create"]));
  push("secrets-read", allows(rules, "", "secrets", READ));
  push("secrets-write", allows(rules, "", "secrets", WRITE));
  push("exec", any(allows(rules, "", "pods/exec", ["create", "get"]), allows(rules, "", "pods/attach", ["create", "get"])));
  push("workloads", any(
    allows(rules, "", "pods", WRITE),
    ...["deployments", "statefulsets", "daemonsets", "replicasets"].map((res) => allows(rules, "apps", res, WRITE)),
    ...["jobs", "cronjobs"].map((res) => allows(rules, "batch", res, WRITE)),
  ));
  push("nodes", allows(rules, "", "nodes", ["update", "patch", "delete"]));
  const reads = [allows(rules, "", "pods", READ), allows(rules, "apps", "deployments", READ), allows(rules, "", "services", READ), allows(rules, "", "configmaps", READ)];
  if (reads.every((r) => r.allowed && !r.limited)) out.push({ id: "read", limited: false });
  push("auth-checks", any(allows(rules, "authentication.k8s.io", "tokenreviews", ["create"]), allows(rules, "authorization.k8s.io", "subjectaccessreviews", ["create"])));
  return out;
}

function severityOf(id: CapabilityId, scope: "cluster" | string[], limited: boolean): Severity {
  if (id === "admin" || id === "rbac") return limited ? "medium" : "critical";
  if (limited) return "low";
  if (id === "read" || id === "auth-checks") return "low";
  return scope === "cluster" ? "high" : "medium";
}

// ---------------------------------------------------------------------------
// Who is who
// ---------------------------------------------------------------------------

const DO_ROLE = /^do-role-name:(.+)$/;

/** People reach the cluster through DigitalOcean: team roles and DigitalOcean-issued credentials. */
export function describeSubject(s: { kind: string; name: string; namespace?: string }): { label: string; category: SubjectCategory } {
  if (s.kind === "ServiceAccount") return { label: `${s.namespace}/${s.name}`, category: SYSTEM_NAMESPACES.has(s.namespace ?? "") ? "system" : "apps" };
  const doRole = DO_ROLE.exec(s.name);
  if (doRole) return { label: `DigitalOcean team role: ${doRole[1]}`, category: "people" };
  if (s.name === "k8saas:authenticated") return { label: "DigitalOcean-issued kubeconfig (doctl / control panel download)", category: "people" };
  if (s.name === "k8saas:authenticated-support") return { label: "DigitalOcean support staff", category: "people" };
  if (s.kind === "Group" && !s.name.startsWith("system:") && !s.name.startsWith("k8saas:")) return { label: `Group ${s.name}`, category: "people" };
  if (s.kind === "User" && !s.name.startsWith("system:") && !s.namespace && !/^(kubelet|cilium|kube-)/.test(s.name)) return { label: `User ${s.name}`, category: "people" };
  return { label: `${s.kind} ${s.namespace ? `${s.namespace}/` : ""}${s.name}`, category: "system" };
}

const keyOf = (s: { kind: string; name: string; namespace?: string }) => `${s.kind}|${s.kind === "ServiceAccount" ? (s.namespace ?? "") : ""}|${s.name}`;

/** The workload a pod belongs to (a ReplicaSet's hash removed to name its Deployment). */
function workloadOf(pod: V1Pod): string {
  const ref = (pod.metadata?.ownerReferences ?? []).find((o) => o.controller) ?? pod.metadata?.ownerReferences?.[0];
  if (!ref) return pod.metadata?.name ?? "";
  if (ref.kind === "ReplicaSet") return /^(.*)-[a-z0-9]{6,10}$/.exec(ref.name)?.[1] ?? ref.name;
  return ref.name;
}

const ruleView = (r: V1PolicyRule): RuleView => ({ verbs: r.verbs ?? [], resources: r.resources ?? [], apiGroups: (r.apiGroups ?? []).map((g) => g || "core"), resourceNames: r.resourceNames ?? [], nonResourceURLs: r.nonResourceURLs ?? [] });

export function buildAccessReport(raw: RbacRaw, pods: V1Pod[]): AccessReport {
  const clusterRoles = new Map(raw.clusterRoles.map((r) => [r.metadata?.name ?? "", r]));
  const roles = new Map(raw.roles.map((r) => [`${r.metadata?.namespace}/${r.metadata?.name}`, r]));
  const subjects = new Map<string, SubjectAccess & { raw: { rules: V1PolicyRule[]; scope: "cluster" | string }[] }>();

  // Which workloads run as each ServiceAccount.
  const usedBy = new Map<string, Set<string>>();
  for (const pod of pods) {
    const phase = pod.status?.phase;
    if (phase === "Succeeded" || phase === "Failed") continue;
    const k = `${pod.metadata?.namespace}/${pod.spec?.serviceAccountName || "default"}`;
    const set = usedBy.get(k) ?? new Set<string>();
    set.add(workloadOf(pod));
    usedBy.set(k, set);
  }

  const bind = (subject: RbacV1Subject, defaultNs: string | undefined, grant: Omit<Grant, "rules" | "missingRole">, rules: V1PolicyRule[] | undefined) => {
    const s = { kind: subject.kind as SubjectAccess["kind"], name: subject.name, namespace: subject.kind === "ServiceAccount" ? (subject.namespace ?? defaultNs) : subject.namespace };
    const key = keyOf(s);
    let entry = subjects.get(key);
    if (!entry) {
      const { label, category } = describeSubject(s);
      entry = { ...s, label, category, grants: [], capabilities: [], severity: null, usedBy: s.kind === "ServiceAccount" ? [...(usedBy.get(`${s.namespace}/${s.name}`) ?? [])].sort() : [], raw: [] };
      subjects.set(key, entry);
    }
    entry.grants.push({ ...grant, rules: (rules ?? []).map(ruleView), missingRole: rules === undefined });
    if (rules) entry.raw.push({ rules, scope: grant.scope });
  };

  for (const b of raw.clusterRoleBindings) {
    const role = clusterRoles.get(b.roleRef.name);
    const grant = { binding: b.metadata?.name ?? "", bindingKind: "ClusterRoleBinding" as const, scope: "cluster", roleKind: b.roleRef.kind, role: b.roleRef.name };
    for (const s of b.subjects ?? []) bind(s, undefined, grant, role?.rules ?? (role ? [] : undefined));
  }
  for (const b of raw.roleBindings) {
    const ns = b.metadata?.namespace ?? "";
    const role = b.roleRef.kind === "ClusterRole" ? clusterRoles.get(b.roleRef.name) : roles.get(`${ns}/${b.roleRef.name}`);
    const grant = { binding: `${ns}/${b.metadata?.name ?? ""}`, bindingKind: "RoleBinding" as const, scope: ns, roleKind: b.roleRef.kind, role: b.roleRef.name };
    for (const s of b.subjects ?? []) bind(s, ns, grant, role?.rules ?? (role ? [] : undefined));
  }

  const result: SubjectAccess[] = [];
  for (const entry of subjects.values()) {
    const merged = new Map<CapabilityId, Capability>();
    for (const g of entry.raw) {
      for (const c of capabilitiesOf(g.rules)) {
        const prev = merged.get(c.id);
        const scope: "cluster" | string[] = g.scope === "cluster" ? "cluster" : [g.scope];
        if (!prev) merged.set(c.id, { id: c.id, scope, limited: c.limited, severity: "low" });
        else {
          prev.scope = prev.scope === "cluster" || scope === "cluster" ? "cluster" : [...new Set([...prev.scope, ...scope])].sort();
          prev.limited = prev.limited && c.limited;
        }
      }
    }
    // Full admin covers everything else in the same scope; keep the list short.
    const caps = [...merged.values()].map((c) => ({ ...c, severity: severityOf(c.id, c.scope, c.limited) }));
    const admin = caps.find((c) => c.id === "admin" && c.scope === "cluster");
    const capabilities = (admin ? [admin] : caps).sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
    result.push({ kind: entry.kind, name: entry.name, namespace: entry.namespace, label: entry.label, category: entry.category, grants: entry.grants, usedBy: entry.usedBy, capabilities, severity: capabilities[0]?.severity ?? null });
  }

  const categoryRank: Record<SubjectCategory, number> = { people: 0, apps: 1, system: 2 };
  result.sort((a, b) => categoryRank[a.category] - categoryRank[b.category] || (a.severity ? SEVERITY_RANK[a.severity] : 9) - (b.severity ? SEVERITY_RANK[b.severity] : 9) || a.label.localeCompare(b.label));

  // ServiceAccounts your pods use that nothing grants anything to.
  const granted = new Set(result.filter((s) => s.kind === "ServiceAccount").map((s) => `${s.namespace}/${s.name}`));
  const noAccess = [...usedBy.entries()]
    .filter(([k]) => !granted.has(k) && !SYSTEM_NAMESPACES.has(k.split("/")[0]))
    .map(([k, set]) => ({ namespace: k.split("/")[0], name: k.split("/").slice(1).join("/"), usedBy: [...set].sort() }))
    .sort((a, b) => a.namespace.localeCompare(b.namespace) || a.name.localeCompare(b.name));

  return { subjects: result, noAccess };
}

// ---------------------------------------------------------------------------
// One namespace
// ---------------------------------------------------------------------------

/** What a namespace page shows: its own apps' access, what is granted inside it, and who can reach in from outside. */
export interface NamespaceAccess {
  /** The ServiceAccounts this namespace's pods run as, with what each can do anywhere. Empty capabilities = no API access. */
  apps: { name: string; usedBy: string[]; capabilities: Capability[]; grants: Grant[] }[];
  /** RoleBindings that live in this namespace, whoever they grant to, with what they allow here. */
  boundHere: { label: string; kind: string; category: SubjectCategory; grants: Grant[]; capabilities: Capability[] }[];
  /** Subjects from outside (other namespaces' accounts, people, system) with full admin over this namespace. */
  admins: Reach;
  /** For each serious capability, the outside subjects that have it here (cluster-wide, or bound in this namespace). Full admins are not repeated. */
  reach: ({ id: CapabilityId } & Reach)[];
}

export interface Reach {
  people: string[];
  apps: string[];
  /** Kubernetes and DigitalOcean components; counted, not listed. */
  system: number;
}

const REACH_ORDER: CapabilityId[] = ["rbac", "secrets-read", "secrets-write", "exec", "workloads", "tokens", "roles"];

const toRule = (r: RuleView): V1PolicyRule => ({ verbs: r.verbs, resources: r.resources, apiGroups: r.apiGroups.map((g) => (g === "core" ? "" : g)), resourceNames: r.resourceNames.length ? r.resourceNames : undefined, nonResourceURLs: r.nonResourceURLs.length ? r.nonResourceURLs : undefined });

/** Capabilities from some grants only (for example the ones bound in one namespace). */
function capabilitiesFromGrants(grants: Grant[]): Capability[] {
  const merged = new Map<CapabilityId, Capability>();
  for (const g of grants) {
    const scope: "cluster" | string[] = g.scope === "cluster" ? "cluster" : [g.scope];
    for (const c of capabilitiesOf(g.rules.map(toRule))) {
      const prev = merged.get(c.id);
      if (!prev) merged.set(c.id, { id: c.id, scope, limited: c.limited, severity: severityOf(c.id, scope, c.limited) });
      else if (prev.limited && !c.limited) merged.set(c.id, { id: c.id, scope, limited: false, severity: severityOf(c.id, scope, false) });
    }
  }
  return [...merged.values()].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}

export function namespaceAccess(report: AccessReport, ns: string, pods: V1Pod[]): NamespaceAccess {
  // ---- this namespace's own apps ----
  const usage = new Map<string, Set<string>>();
  for (const pod of pods) {
    if (pod.metadata?.namespace !== ns) continue;
    const phase = pod.status?.phase;
    if (phase === "Succeeded" || phase === "Failed") continue;
    const name = pod.spec?.serviceAccountName || "default";
    const set = usage.get(name) ?? new Set<string>();
    set.add(workloadOf(pod));
    usage.set(name, set);
  }
  const subjectOf = (name: string) => report.subjects.find((s) => s.kind === "ServiceAccount" && s.namespace === ns && s.name === name);
  const apps = [...usage.entries()]
    .map(([name, set]) => {
      const s = subjectOf(name);
      return { name, usedBy: [...set].sort(), capabilities: s?.capabilities ?? [], grants: s?.grants ?? [] };
    })
    .sort((a, b) => (a.capabilities[0] ? SEVERITY_RANK[a.capabilities[0].severity] : 9) - (b.capabilities[0] ? SEVERITY_RANK[b.capabilities[0].severity] : 9) || a.name.localeCompare(b.name));

  // ---- RoleBindings in this namespace ----
  const boundHere = report.subjects
    .map((s) => ({ s, grants: s.grants.filter((g) => g.bindingKind === "RoleBinding" && g.scope === ns) }))
    .filter((x) => x.grants.length > 0)
    .map(({ s, grants }) => ({ label: s.label, kind: s.kind, category: s.category, grants, capabilities: capabilitiesFromGrants(grants) }))
    .sort((a, b) => a.label.localeCompare(b.label));

  // ---- who else can reach in ----
  const ownAccount = (s: SubjectAccess) => s.kind === "ServiceAccount" && s.namespace === ns;
  const covers = (c: Capability) => c.scope === "cluster" || c.scope.includes(ns);
  const empty = (): Reach => ({ people: [], apps: [], system: 0 });
  const add = (r: Reach, s: SubjectAccess) => {
    if (s.category === "system") r.system += 1;
    else (s.category === "people" ? r.people : r.apps).push(s.label);
  };

  const admins = empty();
  const byCap = new Map<CapabilityId, Reach>(REACH_ORDER.map((id) => [id, empty()]));
  for (const s of report.subjects) {
    if (ownAccount(s)) continue;
    const here = s.capabilities.filter((c) => covers(c) && !c.limited);
    if (here.some((c) => c.id === "admin")) {
      add(admins, s);
      continue;
    }
    for (const c of here) {
      const r = byCap.get(c.id);
      if (r) add(r, s);
    }
  }
  const reach = REACH_ORDER.map((id) => ({ id, ...byCap.get(id)! })).filter((r) => r.people.length + r.apps.length + r.system > 0);

  return { apps, boundHere, admins, reach };
}
