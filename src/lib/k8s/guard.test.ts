import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// The dashboard must never change a cluster and must never read Secret contents.
// These checks scan the source so a mistake fails the test run.

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const srcFiles = walk(path.resolve(__dirname, "../..")).filter((f) => /\.(ts|tsx)$/.test(f) && !f.endsWith(".test.ts"));

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("read-only guarantees", () => {
  it("source files only call list/read/get Kubernetes API methods", () => {
    const forbidden = /\.(create|delete|patch|replace|connect|evict|apply|scale|rollback)\w*\s*\(/;
    const offenders = srcFiles.filter((f) => /k8s\/(live|source)\.ts$|lib\/data\.ts$/.test(f)).filter((f) => forbidden.test(stripComments(readFileSync(f, "utf8"))));
    expect(offenders).toEqual([]);
  });

  it("never requests Secrets, exec, port-forward or logs", () => {
    const forbidden = /(Secret\w*\(|\bExec\b|PortForward|Attach|readNamespacedPodLog|\bLog\b\s*\()/;
    const offenders = srcFiles.filter((f) => /k8s\/(live|source)\.ts$|lib\/data\.ts$/.test(f)).filter((f) => forbidden.test(stripComments(readFileSync(f, "utf8"))));
    expect(offenders).toEqual([]);
  });

  it("the live source wraps every API client in readOnlyClient", () => {
    const live = stripComments(readFileSync(path.resolve(__dirname, "live.ts"), "utf8"));
    const made = live.match(/makeApiClient\(/g)?.length ?? 0;
    const wrapped = live.match(/readOnlyClient\(kc\.makeApiClient\(/g)?.length ?? 0;
    expect(made).toBeGreaterThan(0);
    expect(wrapped).toBe(made);
  });

  it("pod logs are read in exactly one place, with one read-only GET", () => {
    const read = (f: string) => stripComments(readFileSync(f, "utf8"));
    // Only the log reader and its endpoint may know about logs.
    const mentionsLogs = srcFiles.filter((f) => /openPodLog|\/pods\/\$\{[^}]*\}\/log|readNamespacedPodLog/.test(read(f)));
    expect(mentionsLogs.map((f) => path.relative(path.resolve(__dirname, "../.."), f)).sort()).toEqual(
      ["app/api/logs/[ns]/[pod]/route.ts", "lib/k8s/logs.ts"].sort(),
    );

    const reader = read(path.resolve(__dirname, "logs.ts"));
    expect(reader).toMatch(/HttpMethod\.GET/);
    expect(reader).not.toMatch(/HttpMethod\.(POST|PUT|PATCH|DELETE)/);
    expect(reader).not.toMatch(/method:\s*["'](POST|PUT|PATCH|DELETE)/i);
    expect(reader).toMatch(/\/log`\)/); // the only path it builds ends in /log

    const route = read(path.resolve(__dirname, "../../app/api/logs/[ns]/[pod]/route.ts"));
    expect(route).not.toMatch(/export\s+(async\s+)?function\s+(POST|PUT|PATCH|DELETE)/);
    expect(route).toMatch(/export\s+async\s+function\s+GET/);
  });

  it("never uses the library's log helper, which leaves an unhandled AbortError on stop", () => {
    const offenders = srcFiles.filter((f) => /\bnew\s+Log\s*\(|import\s*\{[^}]*\bLog\b[^}]*\}\s*from\s*["']@kubernetes\/client-node/.test(stripComments(readFileSync(f, "utf8"))));
    expect(offenders).toEqual([]);
  });

  it("the DigitalOcean token is used in two files only: node pools, and billing for the FinOps page, with GET requests only", () => {
    const read = (f: string) => stripComments(readFileSync(f, "utf8"));
    const rel = (f: string) => path.relative(path.resolve(__dirname, "../.."), f);
    const usesToken = srcFiles.filter((f) => /process\.env\.DIGITALOCEAN_TOKEN|api\.digitalocean\.com/.test(read(f))).map(rel);
    expect(usesToken.sort()).toEqual(["lib/do/billing.ts", "lib/do/node-pools.ts"]);

    const client = read(path.resolve(__dirname, "../do/node-pools.ts"));
    expect(client).toMatch(/method:\s*"GET"/);
    expect(client).not.toMatch(/method:\s*["'](POST|PUT|PATCH|DELETE)/i);
    expect(client).toMatch(/\/v2\/kubernetes\/clusters\/\$\{[^}]*\}\/node_pools/);

    const billing = read(path.resolve(__dirname, "../do/billing.ts"));
    expect(billing.match(/method:\s*"/g)).toEqual(['method: "']);
    expect(billing).toMatch(/method:\s*"GET"/);
    // Every path it builds is billing, the size price list, or this cluster's own record.
    const paths = billing.match(/["`]\/v2\/[^"`]*["`]/g) ?? [];
    expect(paths.length).toBeGreaterThan(0);
    for (const p of paths) expect(p).toMatch(/^["`]\/v2\/(customers\/my\/|billing\/|sizes["`?]|kubernetes\/clusters\/\$\{)/);
  });

  it("settings (DigitalOcean token, Gemini key, auto-refresh) are read and saved through one store, used only where needed", () => {
    const read = (f: string) => stripComments(readFileSync(f, "utf8"));
    const rel = (f: string) => path.relative(path.resolve(__dirname, "../.."), f);
    const using = (re: RegExp) => srcFiles.filter((f) => re.test(read(f))).map(rel).sort();
    expect(using(/getSetting\("DIGITALOCEAN_TOKEN"\)/)).toEqual(["lib/do/billing.ts", "lib/do/node-pools.ts"]);
    expect(using(/getSetting\("GEMINI_API_KEY"\)/)).toEqual(["lib/ai/config.ts"]);
    // Only the Settings endpoint saves, and only the store touches .env.local.
    expect(using(/saveSettings\(/)).toEqual(["app/api/settings/route.ts", "lib/settings/store.ts"]);
    // Nothing else in the app writes to disk.
    expect(using(/\b(writeFile|writeFileSync|appendFile|appendFileSync|createWriteStream)\b|\.rename\(/)).toEqual(["lib/clusters/store.ts", "lib/settings/store.ts"]);
    // The endpoint only answers this machine and never sends a stored secret back.
    const route = read(path.resolve(__dirname, "../../app/api/settings/route.ts"));
    expect(route.match(/isLocalRequest\(request\.headers\)/g)?.length).toBe(2);
    expect(route).not.toMatch(/json\([^)]*getSetting/);
    expect(route).not.toMatch(/console\.\w+\([^)]*value/);
  });

  it("clusters are added in one place, checked read-only first, and their credentials never go back to the browser", () => {
    const read = (f: string) => stripComments(readFileSync(f, "utf8"));
    const rel = (f: string) => path.relative(path.resolve(__dirname, "../.."), f);
    const using = (re: RegExp) => srcFiles.filter((f) => re.test(read(f))).map(rel).sort();
    // Only the clusters endpoint saves or removes, and only the store touches .dashboard/clusters.json.
    expect(using(/addStoredCluster\(|removeStoredCluster\(/)).toEqual(["app/api/clusters/route.ts", "lib/clusters/store.ts"]);
    // (Pages and components may name the file in help text; code that could open it may not.)
    expect(using(/clusters\.json/).filter((f) => f.startsWith("lib/") || f.startsWith("app/api/"))).toEqual(["lib/clusters/store.ts"]);

    // The connection check is read-only, like the live source.
    const check = read(path.resolve(__dirname, "check.ts"));
    expect(check.match(/makeApiClient\(/g)?.length).toBe(check.match(/readOnlyClient\(kc\.makeApiClient\(/g)?.length);

    // A saved kubeconfig is built from embedded credentials only, with TLS always verified.
    const kubeconfig = read(path.resolve(__dirname, "kubeconfig.ts"));
    expect(kubeconfig).toMatch(/skipTLSVerify:\s*false/);
    expect(kubeconfig).not.toMatch(/skipTLSVerify:\s*true|caFile|certFile|keyFile|exec:|authProvider/);

    // What the browser gets is a summary without credentials, and the endpoint never echoes them.
    const store = read(path.resolve(__dirname, "../clusters/store.ts"));
    const summarize = store.slice(store.indexOf("export function summarize"));
    expect(summarize).not.toMatch(/token:|certData|keyData|caData/);
    const route = read(path.resolve(__dirname, "../../app/api/clusters/route.ts"));
    expect(route).not.toMatch(/json\([^)]*(input|body)\b/);
    expect(route).not.toMatch(/console\.\w+\([^)]*(token|kubeconfig|input\.value\b(?!\.server))/);
    // Changing saved clusters (and listing them) answers this machine only; selecting just sets a cookie.
    expect(route.match(/isLocalRequest\(request\.headers\)/g)?.length).toBe(2);
    // No client component imports the server side of clusters.
    const offenders = srcFiles
      .filter((f) => /\.tsx$/.test(f) && /^["']use client["']/.test(readFileSync(f, "utf8").trimStart()))
      .filter((f) => /^import\s+(?!type\b)[^;]*from\s+["']@\/lib\/(clusters\/(store|registry)|k8s\/(kubeconfig|check))["']/m.test(readFileSync(f, "utf8")))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it("nothing in the app can reach Droplets (server-001 is off limits) or other DigitalOcean resources", () => {
    const offenders = srcFiles.filter((f) => /\/v2\/(droplets|volumes|snapshots|firewalls|load_balancers|databases|actions)/i.test(stripComments(readFileSync(f, "utf8"))));
    expect(offenders).toEqual([]);
  });

  it("Secrets are touched in one place only: the labels of Helm release Secrets, requested as metadata only", () => {
    const read = (f: string) => stripComments(readFileSync(f, "utf8"));
    const rel = (f: string) => path.relative(path.resolve(__dirname, "../.."), f);
    const touching = srcFiles.filter((f) => /\/api\/v1\/secrets|listSecret|listNamespacedSecret|readNamespacedSecret|listSecretForAllNamespaces/.test(read(f))).map(rel);
    expect(touching).toEqual(["lib/k8s/helm.ts"]);

    const helm = read(path.resolve(__dirname, "helm.ts"));
    expect(helm).toMatch(/HttpMethod\.GET/);
    expect(helm).not.toMatch(/HttpMethod\.(POST|PUT|PATCH|DELETE)/);
    expect(helm).toMatch(/method:\s*"GET"/);
    expect(helm).toMatch(/as=PartialObjectMetadataList/);
    expect(helm).toMatch(/owner=helm/);
    // There must be no fallback to a plain JSON request, which would return the Secret contents.
    expect(helm).not.toMatch(/Accept:\s*["']application\/json["']/);
  });

  it("the AI assistant talks to Google in one file, with one POST that asks Google not to store the conversation", () => {
    const read = (f: string) => stripComments(readFileSync(f, "utf8"));
    const rel = (f: string) => path.relative(path.resolve(__dirname, "../.."), f);
    expect(srcFiles.filter((f) => /generativelanguage\.googleapis\.com|googleapis\.com/.test(read(f))).map(rel)).toEqual(["lib/ai/gemini.ts"]);
    // The key is read from the environment in one file (messages that mention its name for the user are fine).
    expect(srcFiles.filter((f) => /env\.(GEMINI|GOOGLE)_API_KEY|process\.env\.(GEMINI|GOOGLE)/.test(read(f))).map(rel)).toEqual(["lib/ai/config.ts"]);

    const client = read(path.resolve(__dirname, "../ai/gemini.ts"));
    // One POST (a question, with store: false) and one GET (checking a key against the model's record, no data sent).
    expect(client.match(/method:\s*"\w+"/g)?.sort()).toEqual(['method: "GET"', 'method: "POST"']);
    expect(client).toMatch(/store:\s*false/);

    const route = read(path.resolve(__dirname, "../../app/api/chat/route.ts"));
    expect(route).toMatch(/export\s+async\s+function\s+POST/);
    expect(route).not.toMatch(/export\s+(async\s+)?function\s+(GET|PUT|PATCH|DELETE)/);
    expect(route).toMatch(/isLocalRequest/);
  });

  it("what the assistant is sent never includes environment values, Secrets, ConfigMaps, annotations or logs", () => {
    const snapshot = stripComments(readFileSync(path.resolve(__dirname, "../ai/snapshot.ts"), "utf8"));
    expect(snapshot).not.toMatch(/\.env\b|envFrom|secretKeyRef|configMapKeyRef|valueFrom|EnvVarView|annotations|\.raw\b|openPodLog|\/log\b|containers\b/);
    expect(snapshot).not.toMatch(/process\.env/);
  });

  it("browser code never imports the server side of the assistant (key, Google client, snapshot, prompt)", () => {
    const rel = (f: string) => path.relative(path.resolve(__dirname, "../.."), f);
    const offenders = srcFiles
      .filter((f) => /\.tsx$/.test(f) && /^["']use client["']/.test(readFileSync(f, "utf8").trimStart()))
      .filter((f) => /^import\s+(?!type\b)[^;]*from\s+["']@\/lib\/ai\/(config|gemini|chat|snapshot|prompt)["']/m.test(readFileSync(f, "utf8")))
      .map(rel);
    expect(offenders).toEqual([]);
  });
});
