import { describe, expect, it } from "vitest";
import { detectProvider } from "@/lib/providers/detect";
import { parsePastedKubeconfig, validateApiServer, validateCa, validateName, validateToken, validateTokenForm } from "./validate";

const PEM = "-----BEGIN CERTIFICATE-----\nMIIBszCCAVmgAwIBAgIUTEST\n-----END CERTIFICATE-----";
const CA = Buffer.from(`${PEM}\n`).toString("base64");
const KEY_PEM = "-----BEGIN EC PRIVATE KEY-----\nMHcCAQEEIKEY\n-----END EC PRIVATE KEY-----";
const JWT = "eyJhbGciOiJSUzI1NiIsImtpZCI6IngifQ.eyJzdWIiOiJzeXN0ZW06c2VydmljZWFjY291bnQ6eCJ9.c2lnbmF0dXJlc2lnbmF0dXJl";

const kubeconfig = (user: string, cluster = `    server: https://2527c9f4-cb99-445f-a085-e48f17aab7cb.k8s.ondigitalocean.com\n    certificate-authority-data: ${CA}`) => `apiVersion: v1
kind: Config
current-context: do-blr1-wldd
clusters:
- name: do-blr1-wldd
  cluster:
${cluster}
users:
- name: reader
  user:
${user}
contexts:
- name: do-blr1-wldd
  context:
    cluster: do-blr1-wldd
    user: reader
`;

describe("form fields", () => {
  it("keeps only the API server's address and insists on https", () => {
    expect(validateApiServer(" https://abc.gr7.us-east-1.eks.amazonaws.com/ ")).toEqual({ ok: true, value: "https://abc.gr7.us-east-1.eks.amazonaws.com" });
    expect(validateApiServer("https://34.123.45.67:443")).toEqual({ ok: true, value: "https://34.123.45.67" });
    expect(validateApiServer("https://10.0.0.1:6443")).toEqual({ ok: true, value: "https://10.0.0.1:6443" });
    for (const bad of ["http://cluster.example.com", "http://127.0.0.1:6443", "https://u:p@cluster.example.com", "https://cluster.example.com/api", "cluster.example.com", "https://x.com/?a=1"]) {
      expect(validateApiServer(bad).ok).toBe(false);
    }
  });

  it("accepts tokens and certificates in their usual shapes", () => {
    expect(validateToken(` ${JWT}\n`)).toEqual({ ok: true, value: JWT });
    expect(validateToken("ey J").ok).toBe(false);
    expect(validateCa(PEM)).toEqual({ ok: true, value: CA });
    expect(validateCa(`${CA.slice(0, 30)}\n${CA.slice(30)}`)).toEqual({ ok: true, value: CA });
    expect(validateCa(Buffer.from("hello").toString("base64")).ok).toBe(false);
    expect(validateName("prod eks-1").ok).toBe(true);
    expect(validateName("../etc").ok).toBe(false);
  });

  it("checks the whole token form", () => {
    expect(validateTokenForm({ name: "wldd", server: "https://x.k8s.ondigitalocean.com", token: JWT, ca: PEM })).toEqual({ ok: true, value: { name: "wldd", server: "https://x.k8s.ondigitalocean.com", token: JWT, caData: CA } });
    expect(validateTokenForm({ name: "wldd", server: "https://x.k8s.ondigitalocean.com", token: JWT })).toMatchObject({ ok: false });
  });
});

describe("pasted kubeconfig", () => {
  it("takes a token written in the file", () => {
    const r = parsePastedKubeconfig(kubeconfig(`    token: ${JWT}`));
    expect(r).toEqual({ ok: true, value: { name: "do-blr1-wldd", context: "do-blr1-wldd", server: "https://2527c9f4-cb99-445f-a085-e48f17aab7cb.k8s.ondigitalocean.com", caData: CA, token: JWT, tlsServerName: undefined } });
    expect(parsePastedKubeconfig(kubeconfig(`    token: ${JWT}`), "prod")).toMatchObject({ ok: true, value: { name: "prod" } });
  });

  it("takes a client certificate and key written in the file", () => {
    const r = parsePastedKubeconfig(kubeconfig(`    client-certificate-data: ${CA}\n    client-key-data: ${Buffer.from(`${KEY_PEM}\n`).toString("base64")}`));
    expect(r).toMatchObject({ ok: true, value: { certData: CA } });
  });

  it("explains, per cloud, why a kubeconfig that runs a program cannot work on a server", () => {
    const exec = (command: string) => parsePastedKubeconfig(kubeconfig(`    exec:\n      apiVersion: client.authentication.k8s.io/v1beta1\n      command: ${command}\n      args: [token]`));
    expect(exec("aws")).toMatchObject({ ok: false, error: expect.stringContaining("AWS (EKS) logins run the aws CLI") });
    expect(exec("kubelogin")).toMatchObject({ ok: false, error: expect.stringContaining("Azure (AKS)") });
    expect(exec("gke-gcloud-auth-plugin")).toMatchObject({ ok: false, error: expect.stringContaining("Google (GKE)") });
    expect(exec("/opt/homebrew/bin/doctl")).toMatchObject({ ok: false, error: expect.stringContaining("doctl") });
    expect(exec("something-else")).toMatchObject({ ok: false, error: expect.stringContaining("read-only ServiceAccount") });
  });

  it("never follows a file path, and refuses weakened TLS", () => {
    expect(parsePastedKubeconfig(kubeconfig("    tokenFile: /etc/passwd")).ok).toBe(false);
    expect(parsePastedKubeconfig(kubeconfig("    client-certificate: /root/.kube/cert\n    client-key: /root/.kube/key")).ok).toBe(false);
    expect(parsePastedKubeconfig(kubeconfig(`    token: ${JWT}`, "    server: https://x.example.com\n    certificate-authority: /etc/ssl/ca.pem"))).toMatchObject({ ok: false, error: expect.stringContaining("CA certificate file") });
    expect(parsePastedKubeconfig(kubeconfig(`    token: ${JWT}`, "    server: https://x.example.com\n    insecure-skip-tls-verify: true"))).toMatchObject({ ok: false, error: expect.stringContaining("TLS verification") });
    expect(parsePastedKubeconfig(kubeconfig("    username: admin\n    password: hunter2")).ok).toBe(false);
  });

  it("explains broken or ambiguous kubeconfigs", () => {
    expect(parsePastedKubeconfig("")).toMatchObject({ ok: false });
    expect(parsePastedKubeconfig("{ not: [valid")).toMatchObject({ ok: false, error: expect.stringContaining("not valid YAML") });
    const two = kubeconfig(`    token: ${JWT}`).replace("current-context: do-blr1-wldd\n", "").replace("contexts:\n", "contexts:\n- name: other\n  context:\n    cluster: do-blr1-wldd\n    user: reader\n");
    expect(parsePastedKubeconfig(two)).toMatchObject({ ok: false, error: expect.stringContaining("none is current") });
    expect(parsePastedKubeconfig(kubeconfig("    {}"))).toMatchObject({ ok: false });
  });
});

describe("detectProvider", () => {
  it("knows each cloud by its nodes", () => {
    expect(detectProvider({ server: "https://1.2.3.4", providerIds: ["digitalocean://606862596"] })).toBe("digitalocean");
    expect(detectProvider({ server: "https://1.2.3.4", providerIds: ["aws:///us-east-1a/i-0abc"] })).toBe("aws");
    expect(detectProvider({ server: "https://1.2.3.4", providerIds: ["azure:///subscriptions/x/resourceGroups/y"] })).toBe("azure");
    expect(detectProvider({ server: "https://34.1.2.3", providerIds: [undefined, "gce://project/zone/gke-node"] })).toBe("gcp");
  });

  it("falls back to the API server's host, then to plain Kubernetes", () => {
    expect(detectProvider({ server: "https://2527c9f4.k8s.ondigitalocean.com", providerIds: [] })).toBe("digitalocean");
    expect(detectProvider({ server: "https://ABC.gr7.us-east-1.eks.amazonaws.com", providerIds: [] })).toBe("aws");
    expect(detectProvider({ server: "https://wldd-dns-1.hcp.westeurope.azmk8s.io:443", providerIds: [] })).toBe("azure");
    expect(detectProvider({ server: "https://kind-control-plane:6443", providerIds: ["kind://docker/kind/kind-worker"] })).toBe("kubernetes");
    expect(detectProvider({ server: "not a url", providerIds: [] })).toBe("kubernetes");
  });
});
