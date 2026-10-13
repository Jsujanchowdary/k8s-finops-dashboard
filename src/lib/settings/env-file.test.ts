import { describe, expect, it } from "vitest";
import { isSettingKey, maskSecret, updateEnvText, validateSetting } from "./env-file";

const DO_TOKEN = "dop_v1_0123456789abcdef0123456789abcdef0123456789abcdef0123456789ab";
const GEMINI = "AIzaSyA1b2C3d4E5f6G7h8I9j0KlMnOpQrStUvW";

describe("validateSetting", () => {
  it("accepts real-looking keys and trims surrounding spaces", () => {
    expect(validateSetting("DIGITALOCEAN_TOKEN", `  ${DO_TOKEN}\n`)).toEqual({ ok: true, value: DO_TOKEN });
    expect(validateSetting("GEMINI_API_KEY", GEMINI)).toEqual({ ok: true, value: GEMINI });
  });

  it("refuses anything that could break out of its line in .env.local", () => {
    for (const bad of [`${DO_TOKEN}\nENABLE_AI=false`, `${DO_TOKEN} x`, `"${DO_TOKEN}"`, `${DO_TOKEN}=1`, `${DO_TOKEN};rm`]) {
      expect(validateSetting("DIGITALOCEAN_TOKEN", bad).ok).toBe(false);
    }
    expect(validateSetting("GEMINI_API_KEY", "short").ok).toBe(false);
    expect(validateSetting("GEMINI_API_KEY", "").ok).toBe(false);
  });

  it("wants a DigitalOcean token to look like one", () => {
    expect(validateSetting("DIGITALOCEAN_TOKEN", GEMINI)).toEqual({ ok: false, error: "DigitalOcean personal access tokens start with “dop_v1_”." });
  });

  it("allows the same auto-refresh values as the top bar", () => {
    expect(validateSetting("NEXT_PUBLIC_REFRESH_SECONDS", "30")).toEqual({ ok: true, value: "30" });
    expect(validateSetting("NEXT_PUBLIC_REFRESH_SECONDS", "0")).toEqual({ ok: true, value: "0" });
    for (const bad of ["1", "5000", "abc", "", "2.5", "-5"]) expect(validateSetting("NEXT_PUBLIC_REFRESH_SECONDS", bad).ok).toBe(false);
  });

  it("knows which keys are editable", () => {
    expect(isSettingKey("GEMINI_API_KEY")).toBe(true);
    expect(isSettingKey("KUBECONFIG")).toBe(false);
    expect(isSettingKey(42)).toBe(false);
  });
});

describe("maskSecret", () => {
  it("shows only the last four characters", () => {
    expect(maskSecret(DO_TOKEN)).toBe("…89ab");
    expect(maskSecret("short")).toBe("…");
    expect(maskSecret(undefined)).toBeUndefined();
  });
});

describe("updateEnvText", () => {
  const file = [
    "# Copy to .env.local",
    "NEXT_PUBLIC_REFRESH_SECONDS=30",
    "",
    "# DIGITALOCEAN_TOKEN=",
    "DIGITALOCEAN_TOKEN=dop_v1_old",
    "KUBE_CONTEXT=do-blr1-wldd",
    "",
  ].join("\n");

  it("changes a setting in place and keeps comments, blank lines and other settings", () => {
    expect(updateEnvText(file, { DIGITALOCEAN_TOKEN: DO_TOKEN })).toBe(
      ["# Copy to .env.local", "NEXT_PUBLIC_REFRESH_SECONDS=30", "", "# DIGITALOCEAN_TOKEN=", `DIGITALOCEAN_TOKEN=${DO_TOKEN}`, "KUBE_CONTEXT=do-blr1-wldd", ""].join("\n"),
    );
  });

  it("adds a new setting at the end, and removes one with null", () => {
    const out = updateEnvText(file, { GEMINI_API_KEY: GEMINI, NEXT_PUBLIC_REFRESH_SECONDS: null });
    expect(out).toBe(["# Copy to .env.local", "", "# DIGITALOCEAN_TOKEN=", "DIGITALOCEAN_TOKEN=dop_v1_old", "KUBE_CONTEXT=do-blr1-wldd", `GEMINI_API_KEY=${GEMINI}`, ""].join("\n"));
  });

  it("drops duplicates and handles 'export', spaces around '=' and Windows line endings", () => {
    const messy = "export GEMINI_API_KEY = old1\r\nOTHER=1\r\nGEMINI_API_KEY=old2\r\n";
    expect(updateEnvText(messy, { GEMINI_API_KEY: GEMINI })).toBe(`GEMINI_API_KEY=${GEMINI}\nOTHER=1\n`);
  });

  it("does not touch a key that only starts the same way", () => {
    expect(updateEnvText("GEMINI_API_KEY_BACKUP=x\n", { GEMINI_API_KEY: GEMINI })).toBe(`GEMINI_API_KEY_BACKUP=x\nGEMINI_API_KEY=${GEMINI}\n`);
  });

  it("starts an empty file, and empties it when the last setting goes", () => {
    expect(updateEnvText("", { NEXT_PUBLIC_REFRESH_SECONDS: "10" })).toBe("NEXT_PUBLIC_REFRESH_SECONDS=10\n");
    expect(updateEnvText("NEXT_PUBLIC_REFRESH_SECONDS=10\n", { NEXT_PUBLIC_REFRESH_SECONDS: null })).toBe("");
  });

  it("refuses a value with a line break even if validation was skipped", () => {
    expect(() => updateEnvText("", { GEMINI_API_KEY: "a\nENABLE_AI=false" })).toThrow(/line break/);
  });
});

