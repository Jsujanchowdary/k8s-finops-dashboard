// Finds the places a value points at (a URL, a host:port) without keeping the rest of it.
// Credentials in a URL such as mongodb+srv://user:password@host/db are dropped on the spot: only scheme, host
// and port leave this module.

export interface Endpoint {
  scheme: string;
  host: string;
  port?: number;
}

const SCHEMES = new Set([
  "http", "https", "ws", "wss", "grpc", "grpcs",
  "mongodb", "mongodb+srv", "redis", "rediss", "amqp", "amqps",
  "postgres", "postgresql", "mysql", "mariadb", "kafka", "nats", "smtp", "smtps", "ftp", "sftp",
]);

const URL_RE = /\b([a-z][a-z0-9+.-]*):\/\/(?:[^\s/@?#]*@)?(\[[0-9a-f:]+\]|[^\s/:?#,;'"`)]+)(?::(\d{1,5}))?/gi;

/** Every URL in `value` whose scheme is one we recognise, reduced to scheme, host and port. */
export function extractEndpoints(value: string): Endpoint[] {
  const out: Endpoint[] = [];
  for (const m of value.matchAll(URL_RE)) {
    const scheme = m[1].toLowerCase();
    if (!SCHEMES.has(scheme)) continue;
    const host = m[2].replace(/^\[|\]$/g, "").toLowerCase();
    if (!host) continue;
    const port = m[3] ? Number(m[3]) : undefined;
    out.push({ scheme, host, port: port !== undefined && port <= 65535 ? port : undefined });
  }
  return out;
}

/** "redis", "redis:6379", "redis.cache.svc.cluster.local:6379": a bare host with an optional port. */
export function bareHost(value: string): { host: string; port?: number } | null {
  const m = /^([a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*)(?::(\d{1,5}))?$/i.exec(value.trim());
  if (!m) return null;
  return { host: m[1].toLowerCase(), port: m[5] ? Number(m[5]) : undefined };
}

export interface ServiceRef {
  name: string;
  namespace: string;
}

/**
 * Cluster DNS names for a Service: `name`, `name.ns`, `name.ns.svc`, `name.ns.svc.cluster.local`,
 * and pod names behind a headless Service (`pod-0.name.ns.svc...`). Returns null for any other host.
 */
export function serviceFromHost(host: string, ownNamespace: string): ServiceRef | null {
  const parts = host.toLowerCase().split(".");
  if (parts.length === 1) return { name: parts[0], namespace: ownNamespace };
  const svc = parts.indexOf("svc");
  if (svc >= 2) return { name: parts[svc - 2], namespace: parts[svc - 1] };
  if (parts.length === 2) return { name: parts[0], namespace: parts[1] };
  return null;
}

const LOCAL = /^(localhost|0\.0\.0\.0|127\.\d+\.\d+\.\d+|::1|host\.docker\.internal)$/;

export function isLocalHost(host: string): boolean {
  return LOCAL.test(host);
}
