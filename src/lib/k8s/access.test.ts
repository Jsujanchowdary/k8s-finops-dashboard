import type { V1ClusterRole, V1ClusterRoleBinding, V1Pod, V1Role, V1RoleBinding } from "@kubernetes/client-node";
import { describe, expect, it } from "vitest";
import { allows, buildAccessReport, capabilitiesOf, describeSubject, namespaceAccess } from "./access";

// Shapes and rules taken from the real cluster.
const clusterRole = (name: string, rules: V1ClusterRole["rules"]): V1ClusterRole => ({ metadata: { name }, rules });
const crb = (name: string, role: string, subjects: V1ClusterRoleBinding["subjects"]): V1ClusterRoleBinding => ({ metadata: { name }, roleRef: { apiGroup: "rbac.authorization.k8s.io", kind: "ClusterRole", name: role }, subjects });
const sa = (namespace: string, name: string) => ({ kind: "ServiceAccount", namespace, name });
const group = (name: string) => ({ kind: "Group", apiGroup: "rbac.authorization.k8s.io", name });

const clusterRoles: V1ClusterRole[] = [
  clusterRole("cluster-admin", [{ apiGroups: ["*"], resources: ["*"], verbs: ["*"] }, { nonResourceURLs: ["*"], verbs: ["*"] }]),
  clusterRole("view", [{ apiGroups: [""], resources: ["pods", "services", "configmaps", "endpoints"], verbs: ["get", "list", "watch"] }, { apiGroups: ["apps"], resources: ["deployments", "statefulsets"], verbs: ["get", "list", "watch"] }]),
  clusterRole("do:modifier", [
    { apiGroups: [""], resources: ["configmaps", "pods", "pods/exec", "pods/log", "secrets", "services"], verbs: ["create", "get", "list", "patch", "update", "watch"] },
    { apiGroups: ["apps"], resources: ["deployments", "statefulsets"], verbs: ["create", "get", "list", "patch", "update", "watch"] },
  ]),
  clusterRole("infisical-opera-manager-role", [
    { apiGroups: [""], resources: ["configmaps", "secrets"], verbs: ["create", "delete", "get", "list", "update", "watch"] },
    { apiGroups: [""], resources: ["pods"], verbs: ["get", "list"] },
    { apiGroups: [""], resources: ["serviceaccounts/token"], verbs: ["create"] },
    { apiGroups: ["apps"], resources: ["daemonsets", "deployments", "statefulsets"], verbs: ["get", "list", "update", "watch"] },
    { apiGroups: ["authentication.k8s.io"], resources: ["tokenreviews"], verbs: ["create"] },
  ]),
  clusterRole("ingress-nginx", [{ apiGroups: [""], resources: ["configmaps", "endpoints", "nodes", "pods", "secrets", "namespaces"], verbs: ["list", "watch"] }, { apiGroups: ["networking.k8s.io"], resources: ["ingresses"], verbs: ["get", "list", "watch"] }]),
  clusterRole("system:auth-delegator", [{ apiGroups: ["authentication.k8s.io"], resources: ["tokenreviews"], verbs: ["create"] }, { apiGroups: ["authorization.k8s.io"], resources: ["subjectaccessreviews"], verbs: ["create"] }]),
  clusterRole("cilium", [{ apiGroups: ["*"], resources: ["*"], verbs: ["get", "list", "watch"] }, { apiGroups: [""], resources: ["nodes"], verbs: ["update", "patch"] }]),
];

const clusterRoleBindings: V1ClusterRoleBinding[] = [
  crb("k8saas:credentials:cluster-admin", "cluster-admin", [group("k8saas:authenticated"), group("do-role-name:Owner"), group("do-role-name:Member")]),
  crb("do:modifier", "do:modifier", [group("do-role-name:Modifier")]),
  crb("do:biller:cluster-view-only", "view", [group("do-role-name:Resource Viewer"), group("do-role-name:Biller")]),
  crb("infisical-opera-manager-rolebinding", "infisical-opera-manager-role", [sa("infisical-operator", "infisical-opera-controller-manager")]),
  crb("infisical-token-reviewer-binding", "system:auth-delegator", [sa("infisical-operator", "infisical-token-reviewer")]),
  crb("ingress-nginx", "ingress-nginx", [sa("ingress-nginx", "ingress-nginx")]),
  crb("cilium", "cilium", [sa("kube-system", "cilium")]),
  crb("cluster-admin", "cluster-admin", [group("system:masters")]),
  crb("dangling", "does-not-exist", [sa("apps", "ghost")]),
];

const roles: V1Role[] = [
  { metadata: { namespace: "infisical", name: "infisical-infisical" }, rules: [{ apiGroups: ["batch"], resources: ["jobs"], verbs: ["get", "watch", "list"] }] },
  { metadata: { namespace: "kube-system", name: "cilium-gateway-secrets" }, rules: [{ apiGroups: [""], resources: ["secrets"], resourceNames: ["cilium-ca"], verbs: ["get"] }] },
  { metadata: { namespace: "team", name: "deployer" }, rules: [{ apiGroups: ["apps"], resources: ["deployments"], verbs: ["update", "patch"] }, { apiGroups: [""], resources: ["secrets"], verbs: ["get"] }] },
];
const rb = (namespace: string, name: string, roleKind: string, role: string, subjects: V1RoleBinding["subjects"]): V1RoleBinding => ({ metadata: { namespace, name }, roleRef: { apiGroup: "rbac.authorization.k8s.io", kind: roleKind, name: role }, subjects });
const roleBindings: V1RoleBinding[] = [
  rb("infisical", "infisical-infisical", "Role", "infisical-infisical", [{ kind: "ServiceAccount", name: "infisical-infisical", namespace: "infisical" }]),
  rb("kube-system", "cilium-gateway-secrets", "Role", "cilium-gateway-secrets", [sa("kube-system", "cilium")]),
  // A ServiceAccount subject without a namespace takes the binding's.
  rb("team", "ci", "Role", "deployer", [{ kind: "ServiceAccount", name: "ci" }]),
];

const pod = (namespace: string, name: string, serviceAccountName: string | undefined, owner?: string): V1Pod => ({
  metadata: { namespace, name, ownerReferences: owner ? [{ apiVersion: "apps/v1", kind: "ReplicaSet", name: owner, uid: "u", controller: true }] : [] },
  spec: { containers: [], serviceAccountName },
  status: { phase: "Running" },
});
const pods = [
  pod("ingress-nginx", "ingress-nginx-controller-5cd9869bf8-5hd6w", "ingress-nginx", "ingress-nginx-controller-5cd9869bf8"),
  pod("infisical-operator", "op-574cb4d4f6-vhhfx", "infisical-opera-controller-manager", "infisical-opera-controller-manager-574cb4d4f6"),
  pod("do-dms-staging", "dms-api-7598b7c694-l2x4n", undefined, "do-dms-staging-dms-api-7598b7c694"),
  pod("do-dms-staging", "dms-ui-797bd484b5-8bf2q", "default", "do-dms-staging-dms-ui-797bd484b5"),
];

const report = buildAccessReport({ clusterRoles, clusterRoleBindings, roles, roleBindings }, pods);
const find = (label: string) => {
  const s = report.subjects.find((x) => x.label === label);
  if (!s) throw new Error(`no subject ${label}`);
  return s;
};
const ids = (label: string) => find(label).capabilities.map((c) => c.id);

describe("people", () => {
  it("DigitalOcean Owners, Members and DigitalOcean-issued kubeconfigs are full admins", () => {
    for (const who of ["DigitalOcean team role: Owner", "DigitalOcean team role: Member", "DigitalOcean-issued kubeconfig (doctl / control panel download)"]) {
      expect(find(who)).toMatchObject({ category: "people", severity: "critical", capabilities: [{ id: "admin", scope: "cluster", limited: false, severity: "critical" }] });
    }
  });

  it("the Modifier role can read and change Secrets, exec into pods and change workloads everywhere", () => {
    expect(ids("DigitalOcean team role: Modifier")).toEqual(["secrets-read", "secrets-write", "exec", "workloads", "read"]);
    expect(find("DigitalOcean team role: Modifier").severity).toBe("high");
  });

  it("viewer roles can read, but not Secrets", () => {
    expect(ids("DigitalOcean team role: Biller")).toEqual(["read"]);
    expect(find("DigitalOcean team role: Resource Viewer").severity).toBe("low");
  });
});

describe("apps and operators", () => {
  it("the Infisical operator reads and writes Secrets cluster-wide, mints tokens and changes workloads", () => {
    const op = find("infisical-operator/infisical-opera-controller-manager");
    expect(op.category).toBe("apps");
    expect(ids("infisical-operator/infisical-opera-controller-manager")).toEqual(["tokens", "secrets-read", "secrets-write", "workloads", "auth-checks"]);
    expect(op.usedBy).toEqual(["infisical-opera-controller-manager"]);
  });

  it("ingress-nginx can read every Secret (it needs the TLS keys), and nothing more serious", () => {
    expect(ids("ingress-nginx/ingress-nginx")).toEqual(["secrets-read"]);
    expect(find("ingress-nginx/ingress-nginx").capabilities[0]).toMatchObject({ scope: "cluster", severity: "high" });
  });

  it("the token reviewer can only check tokens, and is not used by any pod", () => {
    expect(find("infisical-operator/infisical-token-reviewer")).toMatchObject({ severity: "low", usedBy: [] });
    expect(ids("infisical-operator/infisical-token-reviewer")).toEqual(["auth-checks"]);
  });

  it("a namespaced role is limited to its namespace, and a subject without a namespace takes the binding's", () => {
    const ci = find("team/ci");
    expect(ci.capabilities).toEqual([
      { id: "secrets-read", scope: ["team"], limited: false, severity: "medium" },
      { id: "workloads", scope: ["team"], limited: false, severity: "medium" },
    ]);
  });

  it("a role that only reads jobs is not flagged", () => {
    expect(find("infisical/infisical-infisical").severity).toBe(null);
  });

  it("reports a binding whose role does not exist", () => {
    expect(find("apps/ghost").grants[0]).toMatchObject({ role: "does-not-exist", missingRole: true });
  });
});

describe("system", () => {
  it("puts kube-system accounts and system: groups in their own category", () => {
    expect(find("kube-system/cilium")).toMatchObject({ category: "system" });
    expect(find("Group system:masters")).toMatchObject({ category: "system", severity: "critical" });
  });

  it("a Secret readable only by name is a narrow, low finding", () => {
    const cilium = find("kube-system/cilium");
    // Reads everything cluster-wide through `*` (so including Secrets), and changes nodes.
    expect(cilium.capabilities.find((c) => c.id === "secrets-read")).toMatchObject({ scope: "cluster", limited: false });
    const narrow = capabilitiesOf(roles[1].rules!);
    expect(narrow).toEqual([{ id: "secrets-read", limited: true }]);
  });
});

describe("apps without any API access", () => {
  it("lists the ServiceAccounts your pods run as that nothing grants anything to", () => {
    // A pod without serviceAccountName runs as "default".
    expect(report.noAccess).toEqual([{ namespace: "do-dms-staging", name: "default", usedBy: ["do-dms-staging-dms-api", "do-dms-staging-dms-ui"] }]);
  });
});

describe("rule matching", () => {
  it("understands wildcards, sub-resources and resourceNames", () => {
    expect(allows([{ apiGroups: ["*"], resources: ["*"], verbs: ["get"] }], "", "secrets", ["get"])).toEqual({ allowed: true, limited: false });
    expect(allows([{ apiGroups: [""], resources: ["*/exec"], verbs: ["create"] }], "", "pods/exec", ["create"])).toEqual({ allowed: true, limited: false });
    expect(allows([{ apiGroups: [""], resources: ["pods"], verbs: ["create"] }], "", "pods/exec", ["create"])).toEqual({ allowed: false, limited: false });
    expect(allows([{ apiGroups: [""], resources: ["secrets"], resourceNames: ["one"], verbs: ["get"] }], "", "secrets", ["get"])).toEqual({ allowed: true, limited: true });
    expect(allows([{ apiGroups: ["apps"], resources: ["secrets"], verbs: ["get"] }], "", "secrets", ["get"])).toEqual({ allowed: false, limited: false });
  });

  it("only escalate, bind or impersonate let a subject raise its own access", () => {
    const rbac = "rbac.authorization.k8s.io";
    expect(capabilitiesOf([{ apiGroups: [rbac], resources: ["clusterroles"], verbs: ["escalate"] }]).map((c) => c.id)).toEqual(["rbac"]);
    expect(capabilitiesOf([{ apiGroups: [rbac], resources: ["clusterrolebindings"], verbs: ["bind"] }]).map((c) => c.id)).toEqual(["rbac"]);
    expect(capabilitiesOf([{ apiGroups: [rbac], resources: ["*"], verbs: ["*"] }]).map((c) => c.id)).toEqual(["rbac"]);
    expect(capabilitiesOf([{ apiGroups: [""], resources: ["users"], verbs: ["impersonate"] }]).map((c) => c.id)).toEqual(["rbac"]);
  });

  it("creating roles and bindings without escalate or bind only spreads access it already has", () => {
    // The RabbitMQ cluster operator's rule.
    const caps = capabilitiesOf([{ apiGroups: ["rbac.authorization.k8s.io"], resources: ["rolebindings", "roles"], verbs: ["create", "delete", "get", "list", "update", "watch"] }]);
    expect(caps).toEqual([{ id: "roles", limited: false }]);
  });

  it("names people and system subjects", () => {
    expect(describeSubject({ kind: "Group", name: "k8saas:authenticated-support" })).toEqual({ label: "DigitalOcean support staff", category: "people" });
    expect(describeSubject({ kind: "User", name: "kubelet" }).category).toBe("system");
    expect(describeSubject({ kind: "User", name: "jane@wldd.in" })).toEqual({ label: "User jane@wldd.in", category: "people" });
  });
});

describe("one namespace", () => {
  it("shows the namespace's own apps, with no API access when nothing is granted", () => {
    const view = namespaceAccess(report, "do-dms-staging", pods);
    expect(view.apps).toEqual([{ name: "default", usedBy: ["do-dms-staging-dms-api", "do-dms-staging-dms-ui"], capabilities: [], grants: [] }]);
    expect(view.boundHere).toEqual([]);
  });

  it("lists full admins once, and who else can read or change things here, grouped by capability", () => {
    const view = namespaceAccess(report, "do-dms-staging", pods);
    expect(view.admins).toEqual({
      people: ["DigitalOcean team role: Member", "DigitalOcean team role: Owner", "DigitalOcean-issued kubeconfig (doctl / control panel download)"],
      apps: [],
      system: 1,
    });
    const secrets = view.reach.find((r) => r.id === "secrets-read")!;
    expect(secrets.people).toEqual(["DigitalOcean team role: Modifier"]);
    expect(secrets.apps).toEqual(["infisical-operator/infisical-opera-controller-manager", "ingress-nginx/ingress-nginx"]);
    // cilium reads everything cluster-wide; system components are counted, not listed.
    expect(secrets.system).toBe(1);
    // A namespaced grant elsewhere does not reach in.
    expect(secrets.apps).not.toContain("team/ci");
    expect(view.reach.map((r) => r.id)).toEqual(["secrets-read", "secrets-write", "exec", "workloads", "tokens"]);
  });

  it("shows RoleBindings that live in the namespace with what they allow there, and keeps the namespace's own accounts out of the outside list", () => {
    const view = namespaceAccess(report, "team", pods);
    expect(view.boundHere).toEqual([
      {
        label: "team/ci",
        kind: "ServiceAccount",
        category: "apps",
        grants: [expect.objectContaining({ binding: "team/ci", role: "deployer", scope: "team" })],
        capabilities: [
          { id: "secrets-read", scope: ["team"], limited: false, severity: "medium" },
          { id: "workloads", scope: ["team"], limited: false, severity: "medium" },
        ],
      },
    ]);
    expect(view.reach.flatMap((r) => r.apps)).not.toContain("team/ci");
  });

  it("marks a grant limited to named objects as narrow", () => {
    const view = namespaceAccess(report, "kube-system", pods);
    const cilium = view.boundHere.find((b) => b.label === "kube-system/cilium")!;
    expect(cilium.capabilities).toEqual([{ id: "secrets-read", scope: ["kube-system"], limited: true, severity: "low" }]);
  });
});
