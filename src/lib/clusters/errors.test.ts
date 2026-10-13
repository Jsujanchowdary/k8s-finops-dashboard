import { describe, expect, it } from "vitest";
import { unavailableReason } from "@/lib/providers";
import { describeConnectionError, statusOf } from "./errors";

const withCode = (message: string, code: string) => Object.assign(new Error(message), { code });

describe("describeConnectionError", () => {
  it("explains HTTP answers from the API server", () => {
    expect(statusOf({ code: 401 })).toBe(401);
    expect(statusOf(withCode("x", "ENOTFOUND"))).toBeUndefined();
    expect(describeConnectionError({ code: 401, message: "HTTP-Code: 401" })).toMatch(/refused the credentials/);
    expect(describeConnectionError({ code: 403 })).toMatch(/read-only-rbac\.yaml/);
    expect(describeConnectionError({ code: 500 })).toMatch(/\(500\)/);
  });

  it("explains TLS, DNS and network failures, looking into the cause", () => {
    expect(describeConnectionError(new Error("request failed", { cause: withCode("self-signed certificate in certificate chain", "SELF_SIGNED_CERT_IN_CHAIN") }))).toMatch(/not signed by the CA/);
    expect(describeConnectionError(withCode("Hostname/IP does not match certificate's altnames", "ERR_TLS_CERT_ALTNAME_INVALID"))).toMatch(/different address/);
    expect(describeConnectionError(withCode("getaddrinfo ENOTFOUND x.example.com", "ENOTFOUND"))).toMatch(/DNS/);
    expect(describeConnectionError(withCode("connect ECONNREFUSED", "ECONNREFUSED"))).toMatch(/refused the connection/);
    expect(describeConnectionError(new Error("version timed out after 10s"))).toMatch(/private/);
    expect(describeConnectionError(withCode("ENOENT: no such file or directory, open '/home/me/kube/me.crt'", "ENOENT"))).toBe("This kubeconfig context points to a file that does not exist: /home/me/kube/me.crt. Fix the path in the kubeconfig, or remove the context.");
    expect(describeConnectionError("weird")).toBe("Could not connect: weird");
  });
});

describe("unavailableReason", () => {
  it("lets DigitalOcean through and explains the others", () => {
    expect(unavailableReason("digitalocean", "finops")).toBeUndefined();
    expect(unavailableReason("aws", "finops")).toMatch(/not available for AWS clusters yet.*Cost Explorer/);
    expect(unavailableReason("azure", "nodePools")).toMatch(/Node pools .* Azure/);
    expect(unavailableReason("kubernetes", "finops")).toMatch(/not recognised/);
    expect(unavailableReason(undefined, "finops")).toMatch(/not recognised/);
  });
});
