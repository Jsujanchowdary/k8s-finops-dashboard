import "server-only";
import { getSetting } from "@/lib/settings/store";
import { clusterIdFromServer } from "./node-pools-core";
import {
  parseBalance,
  parseClusterName,
  parseInsights,
  parseInvoiceItems,
  parseInvoiceList,
  parseSizes,
  type Balance,
  type InsightPoint,
  type InvoiceItem,
  type InvoiceList,
  type SizePrice,
} from "@/lib/finops/parse";
import { monthWindow, previousPeriod } from "@/lib/finops/spend";

/**
 * The only file that reads DigitalOcean billing. Every call is a GET with the token from DIGITALOCEAN_TOKEN,
 * which stays on the server:
 *   /v2/customers/my/balance, /v2/customers/my/invoices, /v2/customers/my/invoices/preview,
 *   /v2/billing/<team>/insights/<from>/<to>, /v2/sizes (the public price list), /v2/kubernetes/clusters/<id> (its name)
 * Nothing is created, changed or deleted, and no Droplet, Volume or Load Balancer endpoint is ever called: what those
 * cost comes from the invoice. Each part fails on its own, so one missing scope never hides the rest.
 */

export type Part<T> = { ok: true; value: T } | { ok: false; message: string };

export interface FinopsSource {
  fetchedAt: string;
  clusterName: Part<string | undefined>;
  balance: Part<Balance>;
  invoices: Part<InvoiceList>;
  /** Lines of the current month's invoice. */
  items: Part<InvoiceItem[]>;
  /** Billing Insights for this month (so far) and the whole of last month. */
  insights: Part<{ current: InsightPoint[]; previous: InsightPoint[] }>;
  sizes: Part<SizePrice[]>;
}

export type FinopsResult = { state: "no-token" } | { state: "not-doks" } | { state: "ok"; data: FinopsSource };

const TIMEOUT_MS = 15_000;
const PER_PAGE = 200;
const MAX_PAGES = 20;

class DoError extends Error {
  constructor(
    message: string,
    /** DigitalOcean's HTTP status, when it answered. */
    readonly status?: number,
  ) {
    super(message);
  }
}

function statusMessage(status: number, scope: string): string {
  if (status === 401) return "DigitalOcean rejected the token. Check DIGITALOCEAN_TOKEN in .env.local.";
  if (status === 403) return `The token is not allowed to read this. Add the ${scope} scope to it.`;
  if (status === 404) return "DigitalOcean has nothing here for this token's team.";
  if (status === 429) return "DigitalOcean's rate limit was reached. It will retry shortly.";
  return `DigitalOcean answered ${status}.`;
}

export interface Client {
  get(path: string, scope: string): Promise<unknown>;
}

export function createClient(options: { baseUrl: string; token: string; timeoutMs?: number; fetchImpl?: typeof fetch }): Client {
  const doFetch = options.fetchImpl ?? fetch;
  const base = options.baseUrl.replace(/\/$/, "");
  return {
    async get(path, scope) {
      let response: Response;
      try {
        response = await doFetch(`${base}${path}`, {
          method: "GET",
          headers: { Authorization: `Bearer ${options.token}`, Accept: "application/json" },
          signal: AbortSignal.timeout(options.timeoutMs ?? TIMEOUT_MS),
          cache: "no-store",
        });
      } catch (error) {
        throw new DoError(`Could not reach the DigitalOcean API: ${error instanceof Error ? error.message : String(error)}`);
      }
      if (!response.ok) throw new DoError(statusMessage(response.status, scope), response.status);
      try {
        return await response.json();
      } catch {
        throw new DoError("DigitalOcean answered with something that is not JSON.");
      }
    },
  };
}

async function part<T>(fn: () => Promise<T>): Promise<Part<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (error) {
    return { ok: false, message: error instanceof DoError ? error.message : `Unexpected answer from DigitalOcean: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/** Follows `page=` until every item is in (meta.total) or a page comes back short. */
async function allPages<T>(client: Client, path: string, scope: string, parse: (body: unknown) => T[]): Promise<T[]> {
  const out: T[] = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const join = path.includes("?") ? "&" : "?";
    const body = await client.get(`${path}${join}per_page=${PER_PAGE}&page=${page}`, scope);
    const items = parse(body);
    out.push(...items);
    const total = Number((body as { meta?: { total?: unknown } })?.meta?.total);
    if (items.length < PER_PAGE || (Number.isFinite(total) && out.length >= total)) break;
  }
  return out;
}

async function insightsRange(client: Client, urn: string, from: string, to: string): Promise<InsightPoint[]> {
  const out: InsightPoint[] = [];
  const path = `/v2/billing/${encodeURIComponent(urn)}/insights/${from}/${to}`;
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const { points, totalPages } = parseInsights(await client.get(`${path}?per_page=${PER_PAGE}&page=${page}`, "billing:read"));
    out.push(...points);
    if (page >= totalPages || points.length === 0) break;
  }
  return out;
}

const day = (t: number) => new Date(t).toISOString().slice(0, 10);

export async function fetchFinops(client: Client, clusterId: string, now: number = Date.now()): Promise<FinopsSource> {
  const [clusterName, balance, invoices, sizes] = await Promise.all([
    part(async () => parseClusterName(await client.get(`/v2/kubernetes/clusters/${encodeURIComponent(clusterId)}`, "kubernetes:read"))),
    part(async () => {
      const b = parseBalance(await client.get("/v2/customers/my/balance", "billing:read"));
      if (!b) throw new DoError("DigitalOcean's balance answer had no month-to-date usage.");
      return b;
    }),
    part(async () => parseInvoiceList(await client.get(`/v2/customers/my/invoices?per_page=${PER_PAGE}`, "billing:read"))),
    part(() => allPages(client, "/v2/sizes", "sizes:read", parseSizes)),
  ]);

  const preview = invoices.ok ? invoices.value.preview : undefined;
  const period = preview?.period ?? new Date(now).toISOString().slice(0, 7);
  const urn = preview?.accountUrn;
  const prev = previousPeriod(period);

  const [items, insights] = await Promise.all([
    part(() => allPages(client, "/v2/customers/my/invoices/preview", "billing:read", (body) => parseInvoiceItems(body).items)),
    part(async () => {
      if (!urn) throw new DoError("DigitalOcean did not say which team the invoices belong to, so daily spend can't be read.");
      const today = day(Math.min(now, monthWindow(period).end - 1));
      const [current, previous] = await Promise.all([
        insightsRange(client, urn, `${period}-01`, today),
        insightsRange(client, urn, `${prev}-01`, day(monthWindow(prev).end - 1)),
      ]);
      return { current, previous };
    }),
  ]);

  return { fetchedAt: new Date(now).toISOString(), clusterName, balance, invoices, items, insights, sizes };
}

// Billing changes about once a day, so a short cache keeps auto-refresh from calling DigitalOcean every 30 seconds.
const OK_TTL_MS = 15 * 60_000;
const ERROR_TTL_MS = 60_000;
const cache = new Map<string, { at: number; value: FinopsSource }>();

/** After the token changes, the next page load asks DigitalOcean again. */
export function forgetFinops(): void {
  cache.clear();
}

const failed = (s: FinopsSource) => [s.balance, s.invoices, s.items, s.insights, s.sizes, s.clusterName].some((p) => !p.ok);

/** Everything the FinOps page needs from DigitalOcean for the cluster behind `server`. Never throws. */
export async function loadFinops(server: string): Promise<FinopsResult> {
  const token = getSetting("DIGITALOCEAN_TOKEN");
  if (!token) return { state: "no-token" };
  const clusterId = clusterIdFromServer(server);
  if (!clusterId) return { state: "not-doks" };

  const hit = cache.get(clusterId);
  if (hit && Date.now() - hit.at < (failed(hit.value) ? ERROR_TTL_MS : OK_TTL_MS)) return { state: "ok", data: hit.value };

  const client = createClient({ baseUrl: process.env.DIGITALOCEAN_API_URL ?? "https://api.digitalocean.com", token });
  const data = await fetchFinops(client, clusterId);
  cache.set(clusterId, { at: Date.now(), value: data });
  return { state: "ok", data };
}

export type ScopeCheck = "ok" | "missing" | "error";

export interface TokenCheck {
  /** False when DigitalOcean rejected the token outright (401). */
  valid: boolean;
  message?: string;
  /** What each scope the dashboard uses allowed. */
  scopes: { kubernetes: ScopeCheck; billing: ScopeCheck; sizes: ScopeCheck };
  /** The cluster's DigitalOcean name, when kubernetes:read works. */
  clusterName?: string;
}

/**
 * Tries a token before it is saved, with one read-only request per scope the dashboard relies on:
 * kubernetes:read (this cluster's record), billing:read (the balance) and sizes:read (one size). Never throws.
 */
export async function checkDigitalOceanToken(token: string, server: string, options: { baseUrl?: string; fetchImpl?: typeof fetch; timeoutMs?: number } = {}): Promise<TokenCheck> {
  const client = createClient({ baseUrl: options.baseUrl ?? process.env.DIGITALOCEAN_API_URL ?? "https://api.digitalocean.com", token, fetchImpl: options.fetchImpl, timeoutMs: options.timeoutMs ?? 10_000 });
  const clusterId = clusterIdFromServer(server);
  type Probe = { result: ScopeCheck; body?: unknown; status?: number; message?: string };
  const probe = async (path: string, scope: string): Promise<Probe> => {
    try {
      return { result: "ok", body: await client.get(path, scope) };
    } catch (error) {
      const status = error instanceof DoError ? error.status : undefined;
      return { result: status === 403 ? "missing" : "error", status, message: error instanceof Error ? error.message : String(error) };
    }
  };
  const [kube, billing, sizes] = await Promise.all([
    clusterId ? probe(`/v2/kubernetes/clusters/${encodeURIComponent(clusterId)}`, "kubernetes:read") : Promise.resolve<Probe>({ result: "error", message: "The connected cluster is not a DigitalOcean Kubernetes cluster." }),
    probe("/v2/customers/my/balance", "billing:read"),
    probe("/v2/sizes?per_page=1", "sizes:read"),
  ]);
  const all = [kube, billing, sizes];
  if (all.some((p) => p.status === 401)) return { valid: false, message: "DigitalOcean rejected this token (it is wrong, expired or revoked).", scopes: { kubernetes: "error", billing: "error", sizes: "error" } };
  const unreachable = all.find((p) => p.result === "error" && p.status === undefined && p !== kube);
  return {
    valid: true,
    message: unreachable?.message,
    scopes: { kubernetes: kube.result, billing: billing.result, sizes: sizes.result },
    clusterName: kube.result === "ok" ? parseClusterName(kube.body) : undefined,
  };
}
