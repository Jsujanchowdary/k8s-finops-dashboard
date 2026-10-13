// TLS certificates managed by cert-manager: what each one covers, who issues it, when it expires and renews,
// and which Ingress serves it. Pure: built from the Certificate, Issuer, ClusterIssuer and Challenge objects that
// cert-manager keeps in the cluster. The Secrets that hold the certificates and private keys are never read.

import type { V1Ingress } from "@kubernetes/client-node";
import type { Health } from "./types";

/** cert-manager's objects as the API returns them (only the fields used here are typed). */
export interface CertManagerRaw {
  certificates: RawObject[];
  issuers: RawObject[];
  clusterIssuers: RawObject[];
  challenges: RawObject[];
}

export interface RawObject {
  metadata?: { name?: string; namespace?: string; creationTimestamp?: string | Date; ownerReferences?: { kind?: string; name?: string }[] };
  spec?: Record<string, unknown>;
  status?: Record<string, unknown>;
}

export type CertificatesData =
  | { state: "ok"; certificates: CertificateView[]; issuers: IssuerView[]; challenges: ChallengeView[] }
  | { state: "not-installed" }
  | { state: "error"; message: string };

export type CertificateState = "valid" | "expiring" | "renewal-overdue" | "expired" | "not-ready" | "pending";

export interface CertificateView {
  name: string;
  namespace: string;
  dnsNames: string[];
  /** Name of the Secret cert-manager writes the certificate into (the name only; it is never read). */
  secretName: string;
  issuer: { kind: string; name: string };
  ready: boolean;
  readyReason?: string;
  readyMessage?: string;
  notBefore?: string;
  notAfter?: string;
  renewalTime?: string;
  /** How many times it has been issued (1 = never renewed yet). */
  revision?: number;
  /** Whole days until it expires (negative once expired). Null when it has not been issued. */
  daysLeft: number | null;
  daysToRenewal: number | null;
  /** The Ingresses that serve this certificate (their TLS section names its Secret). */
  ingresses: { name: string; hosts: string[] }[];
  /** What created it, e.g. Ingress/infisical-ingress through cert-manager's ingress-shim. */
  owner?: string;
  state: CertificateState;
  health: Health;
  /** One line saying why it is not healthy. */
  problem?: string;
}

export interface IssuerView {
  kind: "ClusterIssuer" | "Issuer";
  name: string;
  namespace?: string;
  /** "Let's Encrypt (production)", "Self-signed", "CA"… */
  type: string;
  /** ACME HTTP-01 / DNS-01. */
  solvers: string[];
  ready: boolean;
  reason?: string;
  message?: string;
  certificates: number;
  health: Health;
}

export interface ChallengeView {
  name: string;
  namespace: string;
  dnsName: string;
  type: string;
  state: string;
  reason?: string;
  presented?: boolean;
  createdAt?: string;
}

const DAY = 86_400_000;
export const CRITICAL_DAYS = 7;
export const WARNING_DAYS = 14;
/** cert-manager renews at renewalTime; a day later without a new certificate means renewal is stuck. */
const OVERDUE_GRACE_MS = DAY;

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);
const iso = (v: unknown): string | undefined => {
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v.toISOString() : undefined;
  const s = str(v);
  return s && Number.isFinite(Date.parse(s)) ? new Date(s).toISOString() : undefined;
};

function readyCondition(status: Obj): { ready: boolean; reason?: string; message?: string; known: boolean } {
  const c = arr(status.conditions).map(obj).find((x) => x.type === "Ready");
  if (!c) return { ready: false, known: false };
  return { ready: c.status === "True", reason: str(c.reason), message: str(c.message), known: true };
}

const days = (from: number, to: number | undefined) => (to === undefined ? null : Math.floor((to - from) / DAY));

/** State and health from readiness and dates. Order matters: the most serious explanation wins. */
export function certificateState(input: { ready: boolean; readyKnown: boolean; notAfter?: string; renewalTime?: string }, now: number): { state: CertificateState; health: Health; problem?: string } {
  const notAfter = input.notAfter ? Date.parse(input.notAfter) : undefined;
  const renewal = input.renewalTime ? Date.parse(input.renewalTime) : undefined;
  if (notAfter !== undefined && notAfter <= now) return { state: "expired", health: "critical", problem: "Expired. Browsers reject this site until it is renewed." };
  if (!input.ready) {
    if (notAfter === undefined) return { state: "pending", health: input.readyKnown ? "critical" : "warning", problem: "Not issued yet. cert-manager is still requesting it, or the request is failing (see Challenges)." };
    return { state: "not-ready", health: "critical", problem: "cert-manager reports it is not ready." };
  }
  const left = days(now, notAfter);
  if (left !== null && left < CRITICAL_DAYS) return { state: "expiring", health: "critical", problem: `Expires in ${Math.max(0, left)} day${left === 1 ? "" : "s"}.` };
  if (renewal !== undefined && now - renewal > OVERDUE_GRACE_MS) return { state: "renewal-overdue", health: "warning", problem: "Its renewal time has passed but it has not been renewed. Check cert-manager's logs and Challenges." };
  if (left !== null && left < WARNING_DAYS) return { state: "expiring", health: "warning", problem: `Expires in ${left} days.` };
  return { state: "valid", health: "healthy" };
}

export function buildCertificateViews(raw: CertManagerRaw, ingresses: V1Ingress[], now: number = Date.now()): Extract<CertificatesData, { state: "ok" }> {
  const certificates = raw.certificates
    .map((c): CertificateView => {
      const spec = obj(c.spec);
      const status = obj(c.status);
      const name = c.metadata?.name ?? "";
      const namespace = c.metadata?.namespace ?? "";
      const secretName = str(spec.secretName) ?? "";
      const issuerRef = obj(spec.issuerRef);
      const ready = readyCondition(status);
      const notAfter = iso(status.notAfter);
      const renewalTime = iso(status.renewalTime);
      const { state, health, problem } = certificateState({ ready: ready.ready, readyKnown: ready.known, notAfter, renewalTime }, now);
      const owner = (c.metadata?.ownerReferences ?? [])[0];
      const servedBy = ingresses
        .filter((ing) => ing.metadata?.namespace === namespace && (ing.spec?.tls ?? []).some((t) => t.secretName === secretName))
        .map((ing) => ({ name: ing.metadata?.name ?? "", hosts: (ing.spec?.tls ?? []).filter((t) => t.secretName === secretName).flatMap((t) => t.hosts ?? []) }));
      return {
        name,
        namespace,
        dnsNames: arr(spec.dnsNames).filter((d): d is string => typeof d === "string"),
        secretName,
        issuer: { kind: str(issuerRef.kind) ?? "Issuer", name: str(issuerRef.name) ?? "" },
        ready: ready.ready,
        readyReason: ready.reason,
        readyMessage: ready.message,
        notBefore: iso(status.notBefore),
        notAfter,
        renewalTime,
        revision: typeof status.revision === "number" ? status.revision : undefined,
        daysLeft: days(now, notAfter ? Date.parse(notAfter) : undefined),
        daysToRenewal: days(now, renewalTime ? Date.parse(renewalTime) : undefined),
        ingresses: servedBy,
        owner: owner?.kind && owner.name ? `${owner.kind}/${owner.name}` : undefined,
        state,
        health,
        problem: problem && !ready.ready && ready.message ? `${problem} ${ready.message}` : problem,
      };
    })
    // Most urgent first: problems, then soonest expiry.
    .sort((a, b) => rank(a.health) - rank(b.health) || (a.notAfter ?? "").localeCompare(b.notAfter ?? "") || a.namespace.localeCompare(b.namespace) || a.name.localeCompare(b.name));

  const issuer = (kind: IssuerView["kind"]) => (i: RawObject): IssuerView => {
    const spec = obj(i.spec);
    const ready = readyCondition(obj(i.status));
    const name = i.metadata?.name ?? "";
    const namespace = kind === "Issuer" ? i.metadata?.namespace : undefined;
    const used = certificates.filter((c) => c.issuer.kind === kind && c.issuer.name === name && (kind === "ClusterIssuer" || c.namespace === namespace)).length;
    return {
      kind,
      name,
      namespace,
      type: issuerType(spec),
      solvers: arr(obj(spec.acme).solvers).flatMap((s) => Object.keys(obj(s)).filter((k) => k === "http01" || k === "dns01")).map((k) => (k === "http01" ? "HTTP-01" : "DNS-01")),
      ready: ready.ready,
      reason: ready.reason,
      message: ready.message,
      certificates: used,
      health: ready.ready ? "healthy" : ready.known ? "critical" : "unknown",
    };
  };

  const challenges = raw.challenges
    .map((ch): ChallengeView => {
      const spec = obj(ch.spec);
      const status = obj(ch.status);
      return {
        name: ch.metadata?.name ?? "",
        namespace: ch.metadata?.namespace ?? "",
        dnsName: str(spec.dnsName) ?? "",
        type: str(spec.type) ?? "",
        state: str(status.state) ?? "pending",
        reason: str(status.reason),
        presented: typeof status.presented === "boolean" ? status.presented : undefined,
        createdAt: iso(ch.metadata?.creationTimestamp),
      };
    })
    .sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""));

  return {
    state: "ok",
    certificates,
    issuers: [...raw.clusterIssuers.map(issuer("ClusterIssuer")), ...raw.issuers.map(issuer("Issuer"))].sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name)),
    challenges,
  };
}

const rank = (h: Health) => (h === "critical" ? 0 : h === "warning" ? 1 : h === "unknown" ? 2 : 3);

export function issuerType(spec: Obj): string {
  const acme = obj(spec.acme);
  if (Object.keys(acme).length) {
    const server = str(acme.server) ?? "";
    if (/letsencrypt/.test(server)) return /staging/.test(server) ? "Let's Encrypt (staging)" : "Let's Encrypt (production)";
    return `ACME${server ? ` (${server.replace(/^https?:\/\//, "").split("/")[0]})` : ""}`;
  }
  if ("selfSigned" in spec) return "Self-signed";
  if ("ca" in spec) return "CA";
  if ("vault" in spec) return "Vault";
  if ("venafi" in spec) return "Venafi";
  return "Other";
}
