// Checking what someone types to add a cluster: an API server, a token and a CA certificate, or a whole kubeconfig.
// Pure, so every rule is tested. A pasted kubeconfig is parsed here as plain YAML (not by the Kubernetes client),
// so it can never make the server read a local file or run a program: only credentials written inside it are used.

import { parse } from "yaml";

export interface ConnectionInput {
  name: string;
  server: string;
  /** Base64 PEM of the cluster's CA, as in kubeconfig's certificate-authority-data. */
  caData: string;
  /** A bearer token (a ServiceAccount token, usually). */
  token?: string;
  /** Or a client certificate and key, base64 PEM. */
  certData?: string;
  keyData?: string;
  tlsServerName?: string;
}

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

const NAME = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,62}$/;
// A ServiceAccount token is a JWT: base64url parts joined by dots. Other bearer tokens use the same characters.
const TOKEN = /^[A-Za-z0-9._~+/=-]{20,8192}$/;
const isPem = (s: string, kind: "CERTIFICATE" | "KEY") => (kind === "CERTIFICATE" ? /-----BEGIN CERTIFICATE-----[\s\S]+-----END CERTIFICATE-----/ : /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]+-----END [A-Z ]*PRIVATE KEY-----/).test(s);

export function validateName(raw: string): Result<string> {
  const value = raw.trim();
  return NAME.test(value) ? { ok: true, value } : { ok: false, error: "Give the cluster a short name: letters, digits, spaces, “.”, “_” or “-”, up to 63 characters." };
}

/** The API server: https only (the client refuses plain http with TLS verification on), no credentials, path or query. */
export function validateApiServer(raw: string): Result<string> {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, error: "The API server must be a full URL, like https://xxxx.k8s.ondigitalocean.com or https://xxxx.gr7.us-east-1.eks.amazonaws.com." };
  }
  if (url.protocol !== "https:") return { ok: false, error: "The API server must use https://." };
  if (url.username || url.password) return { ok: false, error: "Leave any user name or password out of the URL; the token is pasted separately." };
  if ((url.pathname !== "/" && url.pathname !== "") || url.search || url.hash) return { ok: false, error: "Use only the API server's address, with no path." };
  return { ok: true, value: `${url.protocol}//${url.host}` };
}

export function validateToken(raw: string): Result<string> {
  const value = raw.trim();
  return TOKEN.test(value) ? { ok: true, value } : { ok: false, error: "That does not look like a token: paste the decoded token (a ServiceAccount token starts with “ey”), with no spaces or quotes." };
}

/** A certificate or key as PEM text or base64 of PEM; returned as one line of base64. */
function pemData(raw: string, kind: "CERTIFICATE" | "KEY", what: string): Result<string> {
  const text = raw.trim();
  if (isPem(text, kind)) return { ok: true, value: Buffer.from(`${text}\n`, "utf8").toString("base64") };
  const compact = text.replace(/\s+/g, "");
  if (!compact || !/^[A-Za-z0-9+/]+={0,2}$/.test(compact) || compact.length > 32_768) return { ok: false, error: `Paste the ${what} as PEM text or as base64.` };
  if (!isPem(Buffer.from(compact, "base64").toString("utf8"), kind)) return { ok: false, error: `That base64 value is not a ${what}.` };
  return { ok: true, value: compact };
}

export const validateCa = (raw: string) => pemData(raw, "CERTIFICATE", "CA certificate");

/** The fields of the "read-only token" form. */
export function validateTokenForm(input: { name?: unknown; server?: unknown; token?: unknown; ca?: unknown }): Result<ConnectionInput> {
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const name = validateName(str(input.name));
  if (!name.ok) return name;
  const server = validateApiServer(str(input.server));
  if (!server.ok) return server;
  const token = validateToken(str(input.token));
  if (!token.ok) return token;
  const ca = validateCa(str(input.ca));
  if (!ca.ok) return ca;
  return { ok: true, value: { name: name.value, server: server.value, token: token.value, caData: ca.value } };
}

// ---------------------------------------------------------------------------
// Pasted kubeconfig
// ---------------------------------------------------------------------------

const MAX_KUBECONFIG = 64_000;

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);
const named = (list: unknown, name: string | undefined) => arr(list).map(obj).find((e) => e.name === name);

/** Why a login that runs a program cannot work on a server, in the words of the cloud it belongs to. */
function execMessage(command: string): string {
  const base = command.split("/").pop() ?? command;
  const which =
    /^aws$|aws-iam-authenticator/.test(base) ? "AWS (EKS) logins run the aws CLI"
    : /kubelogin/.test(base) ? "Azure (AKS) logins run kubelogin"
    : /gke-gcloud-auth-plugin|gcloud/.test(base) ? "Google (GKE) logins run gke-gcloud-auth-plugin"
    : /doctl/.test(base) ? "DigitalOcean kubeconfigs saved by doctl run doctl"
    : `This kubeconfig runs “${base}”`;
  return `${which} on your own computer to get a token. That program and your login are not on the server, so this kubeconfig cannot be used here. Create a read-only ServiceAccount (deploy/read-only-rbac.yaml) and add the cluster with its token instead.`;
}

/**
 * Takes the kubeconfig's current context (or its only one) and returns the connection inside it. Only credentials
 * written in the file are accepted; file paths, programs (exec), auth providers, passwords and skipped TLS checks are
 * refused with an explanation.
 */
export function parsePastedKubeconfig(text: string, nameOverride?: string): Result<ConnectionInput & { context: string }> {
  if (!text.trim()) return { ok: false, error: "Paste the kubeconfig's contents first." };
  if (text.length > MAX_KUBECONFIG) return { ok: false, error: "That kubeconfig is too large." };
  let doc: Obj;
  try {
    doc = obj(parse(text, { maxAliasCount: 20 }));
  } catch {
    return { ok: false, error: "That is not valid YAML. Paste the whole kubeconfig file as it is." };
  }
  const contexts = arr(doc.contexts).map(obj);
  if (contexts.length === 0) return { ok: false, error: "That kubeconfig has no contexts." };
  const current = str(doc["current-context"]);
  const context = (current ? contexts.find((c) => c.name === current) : undefined) ?? (contexts.length === 1 ? contexts[0] : undefined);
  if (!context) return { ok: false, error: "That kubeconfig has several contexts and none is current. Set current-context, or paste a kubeconfig with one context." };
  const contextName = str(context.name) ?? "context";
  const ctx = obj(context.context);
  const cluster = obj(named(doc.clusters, str(ctx.cluster))?.cluster);
  const user = obj(named(doc.users, str(ctx.user))?.user);
  if (!Object.keys(cluster).length) return { ok: false, error: `The context “${contextName}” points to a cluster that is not in the file.` };
  if (!Object.keys(user).length) return { ok: false, error: `The context “${contextName}” points to a user that is not in the file.` };

  // Things that would reach outside the pasted text, or weaken TLS.
  if (cluster["insecure-skip-tls-verify"] === true) return { ok: false, error: "This kubeconfig turns off TLS verification (insecure-skip-tls-verify). Use one with the cluster's CA certificate." };
  if (cluster["certificate-authority"]) return { ok: false, error: "This kubeconfig points to a CA certificate file. Use certificate-authority-data (the certificate written inside the file) instead." };
  if (cluster["proxy-url"]) return { ok: false, error: "Kubeconfigs that use a proxy are not supported." };
  const exec = obj(user.exec);
  if (Object.keys(exec).length) return { ok: false, error: execMessage(str(exec.command) ?? "a program") };
  if (user["auth-provider"]) return { ok: false, error: "This kubeconfig uses an auth provider plugin, which needs your own login. Use a read-only ServiceAccount token instead." };
  if (user.tokenFile || user["token-file"] || user["client-certificate"] || user["client-key"]) return { ok: false, error: "This kubeconfig points to files for its credentials. Use one with the token or certificate written inside it." };
  if (user.username || user.password) return { ok: false, error: "User name and password logins are not supported. Use a token." };

  const server = validateApiServer(str(cluster.server) ?? "");
  if (!server.ok) return server;
  const ca = validateCa(str(cluster["certificate-authority-data"]) ?? "");
  if (!ca.ok) return { ok: false, error: "This kubeconfig has no CA certificate (certificate-authority-data)." };
  const name = validateName(nameOverride?.trim() || contextName.slice(0, 63).replace(/[^A-Za-z0-9 ._-]/g, "-"));
  if (!name.ok) return name;

  const base = { name: name.value, server: server.value, caData: ca.value, context: contextName, tlsServerName: str(cluster["tls-server-name"]) };
  const token = str(user.token);
  if (token) {
    const t = validateToken(token);
    if (!t.ok) return t;
    return { ok: true, value: { ...base, token: t.value } };
  }
  const cert = str(user["client-certificate-data"]);
  const key = str(user["client-key-data"]);
  if (cert && key) {
    const c = pemData(cert, "CERTIFICATE", "client certificate");
    if (!c.ok) return c;
    const k = pemData(key, "KEY", "client key");
    if (!k.ok) return k;
    return { ok: true, value: { ...base, certData: c.value, keyData: k.value } };
  }
  return { ok: false, error: "This kubeconfig has no token or client certificate in it." };
}
