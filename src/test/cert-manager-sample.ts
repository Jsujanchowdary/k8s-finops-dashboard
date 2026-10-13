// cert-manager objects shaped exactly like the real cluster's, for the certificate tests.
// The clock is 13 Oct 2026; infisical-tls renews on 18 Oct and expires on 17 Nov.

import type { V1Ingress } from "@kubernetes/client-node";
import type { CertManagerRaw, RawObject } from "@/lib/k8s/certificates";

export const CERT_NOW = Date.parse("2026-10-13T10:00:00Z");

const ready = (status: "True" | "False", reason: string, message?: string) => ({ conditions: [{ type: "Ready", status, reason, message, lastTransitionTime: "2026-08-19T09:43:36Z" }] });

const cert = (namespace: string, name: string, o: { hosts: string[]; secret?: string; issuer?: { kind: string; name: string }; status?: Record<string, unknown>; owner?: string }): RawObject => ({
  metadata: { name, namespace, ...(o.owner ? { ownerReferences: [{ kind: "Ingress", name: o.owner }] } : {}) },
  spec: { dnsNames: o.hosts, secretName: o.secret ?? name, issuerRef: o.issuer ?? { group: "cert-manager.io", kind: "ClusterIssuer", name: "letsencrypt-prod" } },
  status: o.status ?? {},
});

export const CERT_MANAGER: CertManagerRaw = {
  certificates: [
    cert("infisical", "infisical-tls", {
      hosts: ["pandora.wldd.in"],
      owner: "infisical-ingress",
      status: { ...ready("True", "Ready", "Certificate is up to date and has not expired"), notBefore: "2026-08-19T08:45:03Z", notAfter: "2026-11-17T08:45:02Z", renewalTime: "2026-10-18T08:45:02Z", revision: 1 },
    }),
    cert("rabbitmq-system", "cluster-operator-serving-cert", {
      hosts: ["cluster-operator-webhook-service.rabbitmq-system.svc"],
      secret: "cluster-operator-webhook-server-cert",
      issuer: { kind: "Issuer", name: "selfsigned-issuer" },
      status: { ...ready("True", "Ready"), notBefore: "2026-08-26T12:55:17Z", notAfter: "2026-11-24T12:55:17Z", renewalTime: "2026-10-25T12:55:17Z", revision: 1 },
    }),
    // Expires in 3 days: critical.
    cert("shop", "shop-tls", { hosts: ["shop.example.com"], status: { ...ready("True", "Ready"), notAfter: "2026-10-16T10:00:00Z", renewalTime: "2026-09-16T10:00:00Z", revision: 2 } }),
    // Renewal was due 3 days ago and has not happened: warning.
    cert("blog", "blog-tls", { hosts: ["blog.example.com"], status: { ...ready("True", "Ready"), notAfter: "2026-11-09T10:00:00Z", renewalTime: "2026-10-10T10:00:00Z", revision: 1 } }),
    // Never issued, cert-manager says why.
    cert("api", "api-tls", { hosts: ["api.example.com"], status: ready("False", "DoesNotExist", "Issuing certificate as Secret does not exist") }),
    // Expired.
    cert("old", "old-tls", { hosts: ["old.example.com"], status: { ...ready("True", "Ready"), notAfter: "2026-10-01T00:00:00Z", renewalTime: "2026-09-01T00:00:00Z" } }),
  ],
  issuers: [{ metadata: { name: "selfsigned-issuer", namespace: "rabbitmq-system" }, spec: { selfSigned: {} }, status: ready("True", "IsReady") }],
  clusterIssuers: [
    { metadata: { name: "letsencrypt-prod" }, spec: { acme: { server: "https://acme-v02.api.letsencrypt.org/directory", email: "someone@example.com", solvers: [{ http01: { ingress: { class: "nginx" } } }] } }, status: ready("True", "ACMEAccountRegistered", "The ACME account was registered with the ACME server") },
    { metadata: { name: "letsencrypt-staging" }, spec: { acme: { server: "https://acme-staging-v02.api.letsencrypt.org/directory", solvers: [{ dns01: {} }] } }, status: ready("False", "ErrRegisterACMEAccount", "Failed to register ACME account") },
  ],
  challenges: [{ metadata: { name: "api-tls-1-123-456", namespace: "api", creationTimestamp: "2026-10-13T09:00:00Z" }, spec: { dnsName: "api.example.com", type: "HTTP-01" }, status: { state: "pending", reason: "Waiting for HTTP-01 challenge propagation: wrong status code '404', expected '200'", presented: true } }],
};

export const CERT_INGRESSES: V1Ingress[] = [
  { metadata: { name: "infisical-ingress", namespace: "infisical" }, spec: { tls: [{ hosts: ["pandora.wldd.in"], secretName: "infisical-tls" }] } },
  // Same Secret name, other namespace: must not be linked.
  { metadata: { name: "decoy", namespace: "other" }, spec: { tls: [{ hosts: ["x.example.com"], secretName: "infisical-tls" }] } },
];
