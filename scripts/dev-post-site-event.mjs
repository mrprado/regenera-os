// Local-only helper: posts a signed regenera.bio event to the dev OS webhook, the same way the site does.
// Usage: node scripts/dev-post-site-event.mjs <event-json-file>   (secret from SITE_WEBHOOK_SECRET or "local-site-secret")
import { readFileSync } from "node:fs";
import { webcrypto as crypto } from "node:crypto";

const secret = process.env.SITE_WEBHOOK_SECRET ?? "local-site-secret";
const url = process.env.OS_WEBHOOK_URL ?? "http://localhost:5180/api/webhooks/site";
const body = readFileSync(process.argv[2], "utf8");
const t = Date.now();
const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(`site-webhook:${secret}`), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
const mac = Buffer.from(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${body}`))).toString("base64url");
const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "x-regenera-signature": `t=${t},v1=${mac}` }, body });
console.log(res.status, await res.text());
