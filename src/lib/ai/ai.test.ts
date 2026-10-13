import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BALANCE, INSIGHTS_CURRENT, INVOICES, NOW, PREVIEW_ITEMS, SIZES } from "@/test/finops-sample";
import { sampleLoadedCluster as cluster } from "@/test/loaded-cluster";
import type { FinopsSource } from "@/lib/do/billing";
import { usd } from "@/lib/finops/format";
import { parseBalance, parseInsights, parseInvoiceItems, parseInvoiceList, parseSizes } from "@/lib/finops/parse";
import { buildFinopsView } from "@/lib/finops/view";
import { ANSWER_SCHEMA, answerToHistory, answerToMarkdown, commandChangesCluster, emptyIndex, normalizeAnswer } from "./answer";
import { answerQuestion, validateMessages } from "./chat";
import { aiConfig, DEFAULT_FALLBACKS, DEFAULT_MODEL } from "./config";
import { AiError, askGemini, checkGeminiKey, extractText, parseJsonText } from "./gemini";
import { buildInput } from "./prompt";
import { buildSnapshot } from "./snapshot";

describe("buildSnapshot", () => {
  const snap = buildSnapshot(cluster(), Date.UTC(2026, 9, 8));

  it("describes nodes, node pools, pods, services, ingresses, volumes and connections", () => {
    expect(snap.text).toContain("## Nodes");
    expect(snap.text).toMatch(/autoscaling on, min 1 max 2/);
    expect(snap.text).toMatch(/do-dms-staging\/do-dms-staging-dms-api-\S+ \| Running \| 1\/1/);
    expect(snap.text).toMatch(/memory .*% of limit/);
    expect(snap.text).toMatch(/do-dms-staging\/do-dms-staging-dms-ui \| ClusterIP .* selects 1 pods, 1 ready/);
    expect(snap.text).toContain("do-dms-staging.app-test.wldd.in/ -> service do-dms-staging-dms-ui:3000");
    expect(snap.text).toMatch(/infisical\/data-postgresql-0 \| Bound \| 8Gi/);
    expect(snap.text).toMatch(/configured link: workload do-dms-staging-dms-ui -> service do-dms-staging-dms-api/);
    expect(snap.text).toMatch(/CrashLoopBackOff/);
  });

  it("lists TLS certificates with expiry, renewal, issuer and problems, and issuers and challenges", () => {
    expect(snap.text).toContain("## TLS certificates");
    expect(snap.text).toMatch(/- infisical\/infisical-tls \| valid \(healthy\) \| hosts pandora\.wldd\.in \| issuer ClusterIssuer\/letsencrypt-prod \| ready yes \| expires 2026-11-17T08:45:02\.000Z \(34 days\) \| renews 2026-10-18T08:45:02\.000Z \(4 days\)/);
    expect(snap.text).toMatch(/served by ingress infisical-ingress/);
    expect(snap.text).toMatch(/shop\/shop-tls \| expiring \(critical\)/);
    expect(snap.text).toMatch(/ClusterIssuer letsencrypt-prod \| Let's Encrypt \(production\) \(HTTP-01\) \| ready yes/);
    expect(snap.text).toMatch(/api\.example\.com \| HTTP-01 \| pending \| Waiting for HTTP-01/);
    expect(snap.text).not.toContain("someone@example.com");
  });

  it("says who can do what: people through DigitalOcean roles, apps' ServiceAccounts, and apps with no API access", () => {
    expect(snap.text).toContain("## Access (RBAC");
    expect(snap.text).toMatch(/- \[people\] DigitalOcean team role: Owner \| Full admin \(cluster-wide\) \| via ClusterRoleBinding k8saas:credentials:cluster-admin -> ClusterRole cluster-admin/);
    expect(snap.text).toMatch(/- \[apps\] ingress-nginx\/ingress-nginx \| Reads Secrets \(cluster-wide\)/);
    expect(snap.text).toMatch(/with no permissions at all .*do-dms-staging\/default/);
  });

  it("tells the model what it cannot see", () => {
    expect(snap.text).toMatch(/Not available to the assistant/);
    expect(snap.text).toMatch(/logs/);
  });

  it("indexes every object so references can be checked", () => {
    expect(snap.index.node.has("wldd-16gb-3oj16x")).toBe(true);
    expect(snap.index.namespace.has("do-dms-staging")).toBe(true);
    expect(snap.index.service.has("do-dms-staging/do-dms-staging-dms-ui")).toBe(true);
    expect([...snap.index.pod].some((k) => k.startsWith("do-dms-staging/do-dms-staging-dms-api-"))).toBe(true);
    expect(snap.counts.pods).toBe(snap.index.pod.size);
  });

  it("stays small enough for one request", () => {
    expect(snap.text.length).toBeLessThan(120_000);
  });

  it("never includes environment values, and shows only host and port of a database URL", () => {
    const patched = cluster((b) => ({
      ...b,
      pods: b.pods.map((p) =>
        p.metadata?.name?.startsWith("do-dms-staging-dms-api-")
          ? {
              ...p,
              metadata: { ...p.metadata, annotations: { note: "ANNOTATIONSECRET" } },
              spec: { ...p.spec!, containers: p.spec!.containers.map((c, i) => (i === 0 ? { ...c, env: [{ name: "JWT_SECRET", value: "SUPERSECRETVALUE123" }, { name: "DB_URL", value: "mongodb+srv://admin:p4ssw0rd@cluster0.ab12c.mongodb.net/dms" }] } : c)) },
            }
          : p,
      ),
    }));
    const text = buildSnapshot(patched).text;
    expect(text).not.toContain("SUPERSECRETVALUE123");
    expect(text).not.toContain("ANNOTATIONSECRET");
    expect(text).not.toMatch(/p4ssw0rd|admin:/);
    expect(text).toContain("cluster0.ab12c.mongodb.net");
  });
});

describe("buildSnapshot with costs", () => {
  const source: FinopsSource = {
    fetchedAt: new Date(NOW).toISOString(),
    clusterName: { ok: true, value: "wldd" },
    balance: { ok: true, value: parseBalance(BALANCE)! },
    invoices: { ok: true, value: parseInvoiceList(INVOICES) },
    items: { ok: true, value: parseInvoiceItems(PREVIEW_ITEMS).items },
    insights: { ok: true, value: { current: parseInsights(INSIGHTS_CURRENT).points, previous: [] } },
    sizes: { ok: true, value: parseSizes(SIZES) },
  };
  const c = cluster();
  const view = buildFinopsView(source, c);
  const text = buildSnapshot(c, Date.UTC(2026, 9, 8), { state: "ok", view }).text;

  it("gives the model the same figures as the FinOps page", () => {
    expect(text).toContain("## Costs (DigitalOcean billing for the whole account, USD)");
    expect(text).toContain(`Spent this month (account balance): $111.51`);
    expect(text).toContain(`Projected for the whole month: ${usd(view.spend!.projectedTotal)}`);
    expect(text).toContain("Past invoices: 2026-09 $137.99, 2026-08 $0.00.");
    expect(text).toMatch(/- Droplets \| server-001 \(s-8vcpu-16gb\) \| - \| Transition \| still billed \| \$0\.1428 \| \$41\.14 \| \$95\.99/);
    expect(text).toMatch(/never above rate x 672/);
  });

  it("states the node pool resize with before and after rates and full-month amounts", () => {
    // 10.82 / 151 h and 19.62 / 137 h, times 672 hours.
    expect(text).toContain(`"1 node - 8 GB / 4 vCPU / 160 GB SSD" replaced by "1 node - 16 GB / 8 vCPU / 320 GB SSD"`);
    expect(text).toContain(`Rate $0.0717/h -> $0.1432/h; a full month ${usd((10.82 / 151) * 672)} -> ${usd((19.62 / 137) * 672)} (difference ${usd((19.62 / 137 - 10.82 / 151) * 672)} a month)`);
  });

  it("includes daily spend and the per-namespace estimate", () => {
    expect(text).toMatch(/2026-10 up to 2026-10-12: 01: \$6\.37/);
    expect(text).toContain("### Cluster cost per namespace right now");
    expect(text).toMatch(/- idle capacity/);
  });

  it("no longer says costs are unavailable, but still says past per-namespace costs are", () => {
    const notAvailable = text.slice(text.indexOf("## Not available to the assistant"));
    expect(notAvailable).not.toMatch(/costs and billing/);
    expect(notAvailable).toMatch(/cost per namespace in the past/);
  });

  it("says why when there is no billing, and says nothing about money when it was not asked for", () => {
    const missing = buildSnapshot(c, Date.UTC(2026, 9, 8), { state: "unavailable", reason: "no DigitalOcean API token is configured." }).text;
    expect(missing).toContain("## Costs\nNot available: no DigitalOcean API token is configured.");
    const plain = buildSnapshot(c, Date.UTC(2026, 9, 8)).text;
    expect(plain).not.toContain("## Costs");
    expect(plain).toMatch(/costs and billing/);
  });

  it("stays small enough for one request", () => {
    expect(text.length).toBeLessThan(120_000);
  });
});

describe("normalizeAnswer", () => {
  const index = emptyIndex();
  index.pod.add("ns/api-1");
  index.node.add("node-a");

  const raw = {
    summary: "  One pod is unhealthy.  ",
    status: "warning",
    sections: [
      { heading: "Findings", type: "bullets", items: [{ text: "api-1 restarted 5 times", severity: "warning" }, { text: "" }] },
      { heading: "Pods", type: "table", columns: ["Pod", "Restarts"], rows: [{ cells: ["api-1", "5"] }, { cells: ["api-2"] }] },
      { heading: "Check", type: "commands", commands: [{ command: "kubectl get pods -n ns", purpose: "list" }, { command: "kubectl delete pod api-1 -n ns", purpose: "restart it" }] },
      { heading: "", type: "text", text: "dropped: no heading" },
      { heading: "Empty", type: "bullets", items: [] },
    ],
    evidence: [{ kind: "pod", namespace: "ns", name: "api-1" }, { kind: "pod", namespace: "ns", name: "invented-pod" }, { kind: "node", name: "node-a" }],
    followUps: ["Why?", "", "What next?", "c", "d"],
  };

  it("keeps good content, drops empty or malformed sections, and trims text", () => {
    const { answer } = normalizeAnswer(raw, index)!;
    expect(answer.summary).toBe("One pod is unhealthy.");
    expect(answer.status).toBe("warning");
    expect(answer.sections.map((s) => s.heading)).toEqual(["Findings", "Pods", "Check"]);
    expect(answer.sections[0].items).toEqual([{ text: "api-1 restarted 5 times", severity: "warning" }]);
    expect(answer.sections[1].rows).toEqual([["api-1", "5"], ["api-2", ""]]);
    expect(answer.followUps).toEqual(["Why?", "What next?", "c"]);
  });

  it("links only objects that exist in the snapshot and counts the rest", () => {
    const result = normalizeAnswer(raw, index)!;
    expect(result.answer.evidence).toEqual([
      { kind: "pod", namespace: "ns", name: "api-1", href: "/namespaces/ns/pods/api-1" },
      { kind: "node", namespace: undefined, name: "node-a", href: "/nodes/node-a" },
    ]);
    expect(result.droppedReferences).toBe(1);
  });

  it("flags commands that would change the cluster", () => {
    const commands = normalizeAnswer(raw, index)!.answer.sections[2].commands!;
    expect(commands.map((c) => c.changesCluster)).toEqual([false, true]);
    for (const risky of ["kubectl scale deploy x --replicas=0", "helm upgrade app .", "kubectl rollout restart deploy/x", "kubectl get pods | sh", "kubectl get secret x > out.txt", "doctl kubernetes cluster delete x"]) {
      expect(commandChangesCluster(risky), risky).toBe(true);
    }
    for (const safe of ["kubectl get pods -A", "kubectl describe pod x -n y", "kubectl logs x -n y --tail=100", "kubectl top pods -n y", "kubectl get events --sort-by=.lastTimestamp"]) {
      expect(commandChangesCluster(safe), safe).toBe(false);
    }
  });

  it("rejects output with no summary and tolerates wrong types", () => {
    expect(normalizeAnswer({ sections: [] }, index)).toBeNull();
    expect(normalizeAnswer("nope", index)).toBeNull();
    const odd = normalizeAnswer({ summary: "ok", status: "banana", sections: "x", evidence: 5, followUps: null }, index)!;
    expect(odd.answer).toMatchObject({ status: "info", sections: [], evidence: [], followUps: [] });
  });

  it("turns an answer into Markdown and a short history line", () => {
    const { answer } = normalizeAnswer(raw, index)!;
    const md = answerToMarkdown(answer);
    expect(md).toContain("**One pod is unhealthy.**");
    expect(md).toContain("| Pod | Restarts |");
    expect(md).toContain("Based on: ns/api-1, node-a");
    expect(answerToHistory(answer).length).toBeLessThanOrEqual(1500);
  });

  it("has a schema Gemini can follow: lowercase types and no nullable keyword", () => {
    const text = JSON.stringify(ANSWER_SCHEMA);
    expect(text).not.toMatch(/"type":"(OBJECT|STRING|ARRAY)"/);
    expect(text).not.toContain("nullable");
    expect(ANSWER_SCHEMA.required).toEqual(["summary", "status", "sections"]);
  });
});

describe("request checks and configuration", () => {
  it("validates the messages the browser sends", () => {
    expect(validateMessages({ messages: [{ role: "user", text: "hi" }] })).toEqual({ ok: true, turns: [], question: "hi" });
    expect(validateMessages({ messages: [{ role: "user", text: "a" }, { role: "assistant", text: "b" }, { role: "user", text: " c " }] })).toMatchObject({ ok: true, question: "c", turns: [{ role: "user" }, { role: "assistant" }] });
    expect(validateMessages({ messages: [] }).ok).toBe(false);
    expect(validateMessages({ messages: [{ role: "assistant", text: "x" }] }).ok).toBe(false);
    expect(validateMessages({ messages: [{ role: "system", text: "x" }] }).ok).toBe(false);
    expect(validateMessages({ messages: [{ role: "user", text: "x".repeat(4001) }] }).ok).toBe(false);
    expect(validateMessages({ messages: Array.from({ length: 17 }, () => ({ role: "user", text: "x" })) }).ok).toBe(false);
    expect(validateMessages(undefined).ok).toBe(false);
  });

  it("reads settings from the environment", () => {
    expect(aiConfig({})).toEqual({ enabled: true, apiKey: undefined, model: DEFAULT_MODEL, fallbackModels: DEFAULT_FALLBACKS });
    expect(aiConfig({ GEMINI_API_KEY: " k ", GEMINI_MODEL: "m", ENABLE_AI: "false" })).toEqual({ enabled: false, apiKey: "k", model: "m", fallbackModels: DEFAULT_FALLBACKS });
    expect(aiConfig({ GEMINI_FALLBACK_MODELS: " a , b ," }).fallbackModels).toEqual(["a", "b"]);
    expect(aiConfig({ GEMINI_FALLBACK_MODELS: "" }).fallbackModels).toEqual([]);
  });

  it("puts the snapshot, the history and the question in one input, snapshot first", () => {
    const input = buildInput("SNAP", [{ role: "user", text: "q1" }, { role: "assistant", text: "a1" }], "q2");
    expect(input.indexOf("SNAP")).toBeLessThan(input.indexOf("q1"));
    expect(input).toContain("User: q1");
    expect(input).toContain("Assistant: a1");
    expect(input.endsWith("LATEST QUESTION\nq2")).toBe(true);
  });
});

describe("parsing the model's reply", () => {
  it("finds the text in an Interactions response", () => {
    const body = { id: "i1", status: "completed", steps: [{ type: "thought", summary: "hmm" }, { type: "model_output", content: [{ type: "text", text: "{\"a\":" }, { type: "text", text: "1}" }] }] };
    expect(extractText(body)).toBe("{\"a\":1}");
    expect(extractText({ output_text: "x" })).toBe("x");
    expect(extractText({ candidates: [{ content: { parts: [{ text: "t", thought: true }, { text: "real" }] } }] })).toBe("real");
    expect(extractText({})).toBe("");
  });

  it("reads JSON wrapped in a code fence or a sentence", () => {
    expect(parseJsonText("{\"a\":1}")).toEqual({ a: 1 });
    expect(parseJsonText("```json\n{\"a\":1}\n```")).toEqual({ a: 1 });
    expect(parseJsonText("Here you go: {\"a\":1} done")).toEqual({ a: 1 });
    expect(() => parseJsonText("no json here")).toThrow(AiError);
  });
});

describe("askGemini against a fake Google", () => {
  const KEY = "AIzaSy-test-key-123456789";
  let server: Server;
  let baseUrl: string;
  let seen: { url?: string; headers?: IncomingMessage["headers"]; body?: Record<string, unknown> } = {};
  let reply: { status: number; body: unknown; delayMs?: number } = { status: 200, body: {} };

  beforeAll(async () => {
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        seen = { url: req.url, headers: req.headers, body: JSON.parse(Buffer.concat(chunks).toString() || "{}") };
        setTimeout(() => {
          res.writeHead(reply.status, { "content-type": "application/json" });
          res.end(JSON.stringify(reply.body));
        }, reply.delayMs ?? 0);
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const ask = (extra: Partial<Parameters<typeof askGemini>[0]> = {}) => askGemini({ apiKey: KEY, model: "gemini-test", system: "SYS", input: "INPUT", baseUrl, retryDelayMs: 0, ...extra });
  const ok = (text: string) => ({ id: "i1", status: "completed", steps: [{ type: "model_output", content: [{ type: "text", text }] }], usage: { total_input_tokens: 1200, total_output_tokens: 80 } });

  it("sends one POST with the key in a header, asks Google not to store it, and requests JSON in the schema", async () => {
    reply = { status: 200, body: ok("{\"summary\":\"hi\"}") };
    const result = await ask();
    expect(result).toEqual({ text: "{\"summary\":\"hi\"}", model: "gemini-test", usage: { inputTokens: 1200, outputTokens: 80 } });
    expect(seen.url).toBe("/v1beta/interactions");
    expect(seen.headers?.["x-goog-api-key"]).toBe(KEY);
    expect(seen.headers?.["api-revision"]).toBeTruthy();
    expect(seen.body).toMatchObject({ model: "gemini-test", input: "INPUT", system_instruction: "SYS", store: false });
    expect(seen.body?.response_format).toMatchObject({ type: "text", mime_type: "application/json" });
    expect(JSON.stringify(seen.body)).not.toContain(KEY);
    expect(seen.url).not.toContain(KEY);
  });

  it("explains each kind of failure and never repeats the key", async () => {
    const cases: [number, string, RegExp][] = [
      [401, "API key not valid", /rejected the API key \(HTTP 401: API key not valid\)/],
      [403, `key ${KEY} blocked`, /rejected the API key/],
      [404, "model missing", /does not know the model "gemini-test"/],
      [429, "quota", /rate limit/],
      [503, "The model is overloaded", /problem on its side \(HTTP 503: The model is overloaded\)/],
      [400, `bad request near ${KEY}`, /rejected the request/],
    ];
    for (const [status, message, pattern] of cases) {
      reply = { status, body: { error: { message } } };
      const error = (await ask().catch((e) => e)) as AiError;
      expect(error).toBeInstanceOf(AiError);
      expect(error.message).toMatch(pattern);
      expect(error.message).not.toContain(KEY);
    }
  });

  it("retries once when Google fails on its side, and tells the user what Google said when it keeps failing", async () => {
    let calls = 0;
    const flaky: typeof fetch = async (input, init) => {
      calls += 1;
      if (calls === 1) return new Response(JSON.stringify({ error: { message: "The model is overloaded. Please try again later." } }), { status: 503 });
      return fetch(input, init);
    };
    reply = { status: 200, body: ok("{\"summary\":\"second try\"}") };
    expect((await ask({ fetchImpl: flaky })).text).toContain("second try");
    expect(calls).toBe(2);

    reply = { status: 500, body: { error: { message: "Internal error encountered." } } };
    let hits = 0;
    const counting: typeof fetch = (input, init) => (hits += 1, fetch(input, init));
    const error = (await ask({ fetchImpl: counting }).catch((e) => e)) as AiError;
    expect(hits).toBe(2);
    expect(error.message).toMatch(/HTTP 500: Internal error encountered\)/);
    expect(error.upstream).toEqual({ status: 500, message: "Internal error encountered" });

    // A key problem is not retried.
    reply = { status: 401, body: { error: { message: "nope" } } };
    hits = 0;
    await ask({ fetchImpl: counting }).catch(() => undefined);
    expect(hits).toBe(1);
  });

  it("moves to a lighter model when the first one is overloaded, and says which one answered", async () => {
    const seenModels: string[] = [];
    const overloaded: typeof fetch = async (input, init) => {
      const model = JSON.parse(String(init?.body)).model as string;
      seenModels.push(model);
      if (model === "big") return new Response(JSON.stringify({ error: { message: "big is currently experiencing high demand." } }), { status: 503 });
      if (model === "gone") return new Response(JSON.stringify({ error: { message: "not found" } }), { status: 404 });
      return fetch(input, init);
    };
    reply = { status: 200, body: ok("{\"summary\":\"from the small model\"}") };

    const result = await ask({ model: "big", fallbackModels: ["gone", "small"], fetchImpl: overloaded });
    expect(result.model).toBe("small");
    expect(seenModels).toEqual(["big", "big", "gone", "small"]); // big is tried twice (one retry), an unknown fallback is skipped

    const data = cluster();
    reply = { status: 200, body: ok(JSON.stringify({ summary: "ok", status: "ok", sections: [] })) };
    const answered = await answerQuestion(data, [], "q", { enabled: true, apiKey: KEY, model: "big", fallbackModels: ["small"] }, { baseUrl, fetchImpl: overloaded, retryDelayMs: 0 });
    expect(answered.meta).toMatchObject({ model: "small", fellBackFrom: "big" });
  });

  it("lists every model it tried when all of them are busy, and does not fall back on a bad key or request", async () => {
    reply = { status: 503, body: { error: { message: "high demand." } } };
    const busy = (await ask({ model: "a", fallbackModels: ["b"] }).catch((e) => e)) as AiError;
    expect(busy.message).toMatch(/a: HTTP 503, b: HTTP 503/);
    expect(busy.message).not.toContain(KEY);

    let hits = 0;
    const counting: typeof fetch = (input, init) => (hits += 1, fetch(input, init));
    reply = { status: 401, body: { error: { message: "bad key" } } };
    await ask({ model: "a", fallbackModels: ["b"], fetchImpl: counting }).catch(() => undefined);
    expect(hits).toBe(1);
    reply = { status: 400, body: { error: { message: "bad schema" } } };
    hits = 0;
    await ask({ model: "a", fallbackModels: ["b"], fetchImpl: counting }).catch(() => undefined);
    expect(hits).toBe(1);

    // An unknown first choice is reported, not silently replaced.
    reply = { status: 404, body: { error: { message: "no such model" } } };
    const missing = (await ask({ model: "typo", fallbackModels: ["b"] }).catch((e) => e)) as AiError;
    expect(missing.code).toBe("model");
  });

  it("reports an empty answer, a timeout and an unreachable server", async () => {
    reply = { status: 200, body: { id: "i", status: "failed", steps: [] } };
    expect(((await ask().catch((e) => e)) as AiError).code).toBe("empty");

    reply = { status: 200, body: ok("{}"), delayMs: 400 };
    expect(((await ask({ timeoutMs: 50 }).catch((e) => e)) as AiError).code).toBe("timeout");

    const error = (await ask({ baseUrl: "http://127.0.0.1:1" }).catch((e) => e)) as AiError;
    expect(error.code).toBe("network");
    expect(error.message).not.toContain(KEY);
  });

  it("answers a question end to end and rejects references to things that do not exist", async () => {
    const data = cluster();
    const pod = data.rows.find((r) => r.name.startsWith("do-dms-staging-dms-api-"))!;
    reply = {
      status: 200,
      body: ok(JSON.stringify({
        summary: "The API pod is healthy.",
        status: "ok",
        sections: [{ heading: "State", type: "bullets", items: [{ text: "Running 1/1", severity: "ok" }] }],
        evidence: [{ kind: "pod", namespace: pod.namespace, name: pod.name }, { kind: "pod", namespace: pod.namespace, name: "made-up" }],
        followUps: ["Anything else?"],
      })),
    };
    const { answer, meta } = await answerQuestion(data, [], "How is the API?", { enabled: true, apiKey: KEY, model: "gemini-test", fallbackModels: [] }, { baseUrl, now: Date.UTC(2026, 9, 8), retryDelayMs: 0 });
    expect(answer.summary).toBe("The API pod is healthy.");
    expect(answer.evidence).toHaveLength(1);
    expect(answer.evidence[0].href).toBe(`/namespaces/${pod.namespace}/pods/${pod.name}`);
    expect(meta).toMatchObject({ model: "gemini-test", unverifiedReferences: 1, inputTokens: 1200, outputTokens: 80 });
    expect(String(seen.body?.input)).toContain("How is the API?");
    expect(String(seen.body?.input)).toContain(pod.name);

    await expect(answerQuestion(data, [], "x", { enabled: true, model: "m", fallbackModels: [] })).rejects.toBeInstanceOf(AiError);
  });
});

describe("checkGeminiKey", () => {
  const answer = (status: number) => (async (input: RequestInfo | URL, init?: RequestInit) => {
    seenCheck.push({ url: String(input), method: init?.method, key: (init?.headers as Record<string, string>)["x-goog-api-key"] });
    return new Response("{}", { status });
  }) as typeof fetch;
  const seenCheck: { url: string; method?: string; key?: string }[] = [];

  it("asks for the model's record with one GET, the key in a header", async () => {
    seenCheck.length = 0;
    expect(await checkGeminiKey("AIzaTestKey123456789012345", "gemini-3.8-flash", { fetchImpl: answer(200) })).toEqual({ ok: true, model: "gemini-3.8-flash" });
    expect(seenCheck).toEqual([{ url: "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash", method: "GET", key: "AIzaTestKey123456789012345" }]);
  });

  it("tells a bad key from a missing model and a busy quota", async () => {
    expect(await checkGeminiKey("k".repeat(30), "m", { fetchImpl: answer(400) })).toMatchObject({ ok: false, reason: "invalid-key" });
    expect(await checkGeminiKey("k".repeat(30), "m", { fetchImpl: answer(403) })).toMatchObject({ ok: false, reason: "invalid-key" });
    expect(await checkGeminiKey("k".repeat(30), "nope", { fetchImpl: answer(404) })).toMatchObject({ ok: false, reason: "model-not-found" });
    expect(await checkGeminiKey("k".repeat(30), "m", { fetchImpl: answer(429) })).toMatchObject({ ok: false, reason: "quota" });
  });

  it("never repeats the key in an error", async () => {
    const failing = (async () => {
      throw new Error("connect failed for key SECRETKEY1234567890123");
    }) as typeof fetch;
    const check = await checkGeminiKey("SECRETKEY1234567890123", "m", { fetchImpl: failing });
    expect(check).toMatchObject({ ok: false, reason: "unreachable" });
    expect(JSON.stringify(check)).not.toContain("SECRETKEY1234567890123");
  });
});
