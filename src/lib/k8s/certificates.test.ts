import { describe, expect, it } from "vitest";
import { CERT_INGRESSES, CERT_MANAGER, CERT_NOW } from "@/test/cert-manager-sample";
import { buildCertificateViews, certificateState, issuerType } from "./certificates";

const data = buildCertificateViews(CERT_MANAGER, CERT_INGRESSES, CERT_NOW);
const byName = Object.fromEntries(data.certificates.map((c) => [c.name, c]));

describe("certificate views", () => {
  it("reads hosts, issuer, dates, renewal and the Ingress that serves it", () => {
    const c = byName["infisical-tls"];
    expect(c).toMatchObject({
      namespace: "infisical",
      dnsNames: ["pandora.wldd.in"],
      secretName: "infisical-tls",
      issuer: { kind: "ClusterIssuer", name: "letsencrypt-prod" },
      ready: true,
      notAfter: "2026-11-17T08:45:02.000Z",
      renewalTime: "2026-10-18T08:45:02.000Z",
      revision: 1,
      owner: "Ingress/infisical-ingress",
      state: "valid",
      health: "healthy",
      daysLeft: 34,
      daysToRenewal: 4,
    });
    // Only the Ingress in the same namespace that names this Secret.
    expect(c.ingresses).toEqual([{ name: "infisical-ingress", hosts: ["pandora.wldd.in"] }]);
  });

  it("flags expired, expiring, overdue and never-issued certificates", () => {
    expect(byName["old-tls"]).toMatchObject({ state: "expired", health: "critical" });
    expect(byName["shop-tls"]).toMatchObject({ state: "expiring", health: "critical", daysLeft: 3 });
    expect(byName["blog-tls"]).toMatchObject({ state: "renewal-overdue", health: "warning" });
    expect(byName["api-tls"]).toMatchObject({ state: "pending", health: "critical", daysLeft: null });
    expect(byName["api-tls"].problem).toContain("Issuing certificate as Secret does not exist");
  });

  it("lists the most urgent first", () => {
    expect(data.certificates.map((c) => c.health)).toEqual(["critical", "critical", "critical", "warning", "healthy", "healthy"]);
    expect(data.certificates.slice(-2).map((c) => c.name)).toEqual(["infisical-tls", "cluster-operator-serving-cert"]);
  });

  it("describes issuers and counts the certificates each one issues", () => {
    const prod = data.issuers.find((i) => i.name === "letsencrypt-prod")!;
    expect(prod).toMatchObject({ kind: "ClusterIssuer", type: "Let's Encrypt (production)", solvers: ["HTTP-01"], ready: true, health: "healthy", certificates: 5 });
    expect(data.issuers.find((i) => i.name === "letsencrypt-staging")).toMatchObject({ type: "Let's Encrypt (staging)", solvers: ["DNS-01"], ready: false, health: "critical" });
    expect(data.issuers.find((i) => i.name === "selfsigned-issuer")).toMatchObject({ kind: "Issuer", namespace: "rabbitmq-system", type: "Self-signed", certificates: 1 });
  });

  it("never exposes the ACME account email", () => {
    expect(JSON.stringify(data)).not.toContain("someone@example.com");
  });

  it("shows ACME challenges that are in progress, with cert-manager's reason", () => {
    expect(data.challenges).toEqual([
      { name: "api-tls-1-123-456", namespace: "api", dnsName: "api.example.com", type: "HTTP-01", state: "pending", reason: "Waiting for HTTP-01 challenge propagation: wrong status code '404', expected '200'", presented: true, createdAt: "2026-10-13T09:00:00.000Z" },
    ]);
  });
});

describe("certificateState thresholds", () => {
  const at = (days: number) => new Date(CERT_NOW + days * 86_400_000).toISOString();
  it("is critical under 7 days, a warning under 14, healthy after", () => {
    expect(certificateState({ ready: true, readyKnown: true, notAfter: at(6.5) }, CERT_NOW).health).toBe("critical");
    expect(certificateState({ ready: true, readyKnown: true, notAfter: at(13.5) }, CERT_NOW).health).toBe("warning");
    expect(certificateState({ ready: true, readyKnown: true, notAfter: at(30) }, CERT_NOW).health).toBe("healthy");
  });

  it("gives renewal a day of grace before calling it overdue", () => {
    expect(certificateState({ ready: true, readyKnown: true, notAfter: at(30), renewalTime: at(-0.5) }, CERT_NOW).state).toBe("valid");
    expect(certificateState({ ready: true, readyKnown: true, notAfter: at(30), renewalTime: at(-1.5) }, CERT_NOW).state).toBe("renewal-overdue");
  });

  it("an expired certificate is expired even if cert-manager still says Ready", () => {
    expect(certificateState({ ready: true, readyKnown: true, notAfter: at(-1) }, CERT_NOW).state).toBe("expired");
  });
});

describe("issuerType", () => {
  it("names the common issuers", () => {
    expect(issuerType({ acme: { server: "https://acme.zerossl.com/v2/DV90" } })).toBe("ACME (acme.zerossl.com)");
    expect(issuerType({ ca: { secretName: "x" } })).toBe("CA");
    expect(issuerType({})).toBe("Other");
  });
});
