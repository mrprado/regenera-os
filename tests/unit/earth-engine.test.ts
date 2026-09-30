// Earth Engine provider: configuration states, service-account JWT (RS256) and token exchange, token caching,
// expression graphs sent to value:compute, result normalisation, and cosine similarity. Google is faked; the RSA key is real.
import { describe, expect, it } from "vitest";
import { accessToken, cosine, eeConfig, eeStatus, expression, F, K, testConnection, vegetation } from "@/lib/providers/earth-engine";

async function serviceAccount() {
  const kp = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const der = new Uint8Array(await crypto.subtle.exportKey("pkcs8", kp.privateKey));
  let s = ""; for (const b of der) s += String.fromCharCode(b);
  const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(s).match(/.{1,64}/g)!.join("\n")}\n-----END PRIVATE KEY-----\n`;
  return { kp, json: JSON.stringify({ client_email: "atlas@regenera-ee.iam.gserviceaccount.com", private_key: pem }) };
}

describe("configuration", () => {
  it("reports NOT CONNECTED with the missing piece, and parses a valid key", async () => {
    expect(eeStatus({}).reason).toMatch(/EARTH_ENGINE_SERVICE_ACCOUNT/);
    expect(eeStatus({ EARTH_ENGINE_SERVICE_ACCOUNT: "{}" }).reason).toMatch(/EARTH_ENGINE_PROJECT_ID/);
    expect(eeStatus({ EARTH_ENGINE_SERVICE_ACCOUNT: "not json", EARTH_ENGINE_PROJECT_ID: "p" }).connected).toBe(false);
    const { json } = await serviceAccount();
    expect(eeConfig({ EARTH_ENGINE_SERVICE_ACCOUNT: json, EARTH_ENGINE_PROJECT_ID: "regenera-ee" })?.projectId).toBe("regenera-ee");
  });
});

describe("auth and compute", () => {
  it("signs a verifiable JWT, exchanges it once, and posts expression graphs", async () => {
    const { kp, json } = await serviceAccount();
    const cfg = eeConfig({ EARTH_ENGINE_SERVICE_ACCOUNT: json, EARTH_ENGINE_PROJECT_ID: "regenera-ee" })!;
    const calls: { url: string; body: string }[] = [];
    const fake: typeof fetch = async (input, init) => {
      const url = String(input), body = String(init?.body ?? "");
      calls.push({ url, body });
      if (url.includes("oauth2")) {
        const jwt = new URLSearchParams(body).get("assertion")!;
        const [h, c, sig] = jwt.split(".");
        const dec = (x: string) => Uint8Array.from(atob(x.replace(/-/g, "+").replace(/_/g, "/")), ch => ch.charCodeAt(0));
        const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", kp.publicKey, dec(sig), new TextEncoder().encode(`${h}.${c}`));
        const claims = JSON.parse(new TextDecoder().decode(dec(c)));
        if (!ok || claims.scope !== "https://www.googleapis.com/auth/earthengine") return new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 });
        return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), { status: 200 });
      }
      const expr = JSON.parse(body).expression;
      const fn = expr.values["0"].functionInvocationValue.functionName;
      if (fn === "Number.add") return new Response(JSON.stringify({ result: 2 }), { status: 200 });
      if (fn === "Image.reduceRegion") return new Response(JSON.stringify({ result: { nd_mean: 0.41, nd_stdDev: 0.08 } }), { status: 200 });
      return new Response(JSON.stringify({ error: { message: "unexpected" } }), { status: 400 });
    };
    expect(await testConnection(cfg, fake)).toEqual({ ok: true });
    await accessToken(cfg, fake);
    expect(calls.filter(c => c.url.includes("oauth2")).length).toBe(1);   // cached token reused
    const site = { type: "Polygon" as const, coordinates: [[[-89.6, 20.9], [-89.5, 20.9], [-89.5, 21], [-89.6, 20.9]]] };
    const v = await vegetation(cfg, site, "2025-01-01", "2026-01-01", fake);
    expect(v).toMatchObject({ ndviMean: 0.41, ndviStd: 0.08, scaleM: 10 });
    const last = JSON.parse(calls.at(-1)!.body).expression.values["0"].functionInvocationValue;
    expect(last.arguments.geometry.functionInvocationValue.functionName).toBe("GeometryConstructors.Polygon");
    expect(calls.at(-1)!.url).toContain("/projects/regenera-ee/value:compute");
  });

  it("builds graphs and compares embeddings", () => {
    expect(expression(F("Number.add", { left: K(1), right: K(1), unused: undefined }))).toEqual({ expression: { result: "0", values: { "0": { functionInvocationValue: { functionName: "Number.add", arguments: { left: { constantValue: 1 }, right: { constantValue: 1 } } } } } } });
    expect(cosine([1, 0], [1, 0])).toBe(1);
    expect(cosine([1, 0], [0, 1])).toBe(0);
  });
});
