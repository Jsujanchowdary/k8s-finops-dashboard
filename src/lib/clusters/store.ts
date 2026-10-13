import "server-only";
import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { ProviderId } from "@/lib/providers/detect";
import type { ClusterSummary } from "./types";
import type { ConnectionInput } from "./validate";

/**
 * Clusters added from the Settings page, saved in .dashboard/clusters.json (readable by this user only, ignored by
 * git). The credentials in it are read-only tokens or certificates; they are used on the server only and never sent
 * to the browser. Writes go through a temporary file and a rename, so a crash never leaves half a file.
 */

export interface StoredCluster extends ConnectionInput {
  id: string;
  provider: ProviderId;
  addedAt: string;
}

interface StoreFile {
  version: 1;
  clusters: StoredCluster[];
}

const MAX_CLUSTERS = 50;

const dir = () => path.join(process.cwd(), ".dashboard");
const file = () => path.join(dir(), "clusters.json");

// Kept across dev hot reloads, like the other per-process state.
const globalState = globalThis as unknown as { __dashboardClusters?: { loaded?: Promise<StoredCluster[]>; list?: StoredCluster[] } };
const state = () => (globalState.__dashboardClusters ??= {});

async function readFromDisk(): Promise<StoredCluster[]> {
  try {
    const parsed = JSON.parse(await fs.readFile(file(), "utf8")) as Partial<StoreFile>;
    return Array.isArray(parsed.clusters) ? parsed.clusters.filter((c) => typeof c?.id === "string" && typeof c.server === "string") : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    // A broken file is reported, not overwritten: the next save would replace it, so refuse to save until it is fixed.
    throw new Error(`.dashboard/clusters.json could not be read: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function storedClusters(): Promise<StoredCluster[]> {
  const s = state();
  if (s.list) return s.list;
  s.loaded ??= readFromDisk().then((list) => (s.list = list));
  try {
    return await s.loaded;
  } catch (error) {
    s.loaded = undefined;
    throw error;
  }
}

async function writeToDisk(list: StoredCluster[]): Promise<void> {
  await fs.mkdir(dir(), { recursive: true, mode: 0o700 });
  const body: StoreFile = { version: 1, clusters: list };
  const temp = `${file()}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temp, `${JSON.stringify(body, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(temp, file());
  await fs.chmod(file(), 0o600).catch(() => {});
  state().list = list;
}

export async function addStoredCluster(input: ConnectionInput, provider: ProviderId): Promise<StoredCluster> {
  const list = await storedClusters();
  if (list.length >= MAX_CLUSTERS) throw new Error(`At most ${MAX_CLUSTERS} clusters can be saved.`);
  if (list.some((c) => c.name.toLowerCase() === input.name.toLowerCase())) throw new Error(`A cluster called “${input.name}” is already saved. Pick another name.`);
  const cluster: StoredCluster = {
    id: `saved:${randomBytes(6).toString("hex")}`,
    name: input.name,
    server: input.server,
    caData: input.caData,
    ...(input.token ? { token: input.token } : { certData: input.certData, keyData: input.keyData }),
    ...(input.tlsServerName ? { tlsServerName: input.tlsServerName } : {}),
    provider,
    addedAt: new Date().toISOString(),
  };
  await writeToDisk([...list, cluster]);
  return cluster;
}

/** True when something was removed. */
export async function removeStoredCluster(id: string): Promise<boolean> {
  const list = await storedClusters();
  const next = list.filter((c) => c.id !== id);
  if (next.length === list.length) return false;
  await writeToDisk(next);
  return true;
}

/** The browser's view of a saved cluster: no token, certificate or key. */
export function summarize(c: StoredCluster): ClusterSummary {
  return { id: c.id, name: c.name, server: c.server, kind: "saved", provider: c.provider, auth: c.token ? "token" : "client certificate", addedAt: c.addedAt };
}
