import { describe, expect, it } from "vitest";
import { sanitizeAnnotations, sanitizePod } from "./sanitize";

describe("sanitizeAnnotations", () => {
  it("drops last-applied-configuration", () => {
    expect(sanitizeAnnotations({ "kubectl.kubernetes.io/last-applied-configuration": "{...}", keep: "yes" })).toEqual({ keep: "yes" });
  });
});

describe("sanitizePod", () => {
  const pod = {
    metadata: { name: "p", managedFields: [{ manager: "x" }], annotations: { "kubectl.kubernetes.io/last-applied-configuration": "{...}", keep: "yes" }, creationTimestamp: new Date("2026-01-01T00:00:00Z") },
    spec: { containers: [{ name: "c", env: [{ name: "A", value: "plain-value" }], command: ["server"], args: ["--port=8080", "--token=abc"] }] },
  };

  it("drops managedFields and last-applied, and converts dates", () => {
    const out = sanitizePod(pod) as { metadata: { creationTimestamp: string; annotations: Record<string, string> } };
    const text = JSON.stringify(out);
    expect(text).not.toContain("managedFields");
    expect(text).not.toContain("last-applied");
    expect(out.metadata.annotations).toEqual({ keep: "yes" });
    expect(out.metadata.creationTimestamp).toBe("2026-01-01T00:00:00.000Z");
  });

  it("shows environment values, commands and arguments exactly as written", () => {
    const out = sanitizePod(pod) as { spec: { containers: { env: { value: string }[]; command: string[]; args: string[] }[] } };
    expect(out.spec.containers[0].env[0].value).toBe("plain-value");
    expect(out.spec.containers[0].command).toEqual(["server"]);
    expect(out.spec.containers[0].args).toEqual(["--port=8080", "--token=abc"]);
  });
});
