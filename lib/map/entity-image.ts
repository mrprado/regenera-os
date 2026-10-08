// Entity pictures (Atlas inspector): the image an organization or article publishes for sharing (Open Graph /
// Twitter card) plus its logo or icon, read from the page head of the entity's own website. Only URLs already on a
// Regenera record are fetched (never a URL from the browser), only the first 256 KB, cached 30 days, logged.
import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import { sourceCache } from "@/db/schema";
import { assertIntegrationAllowed } from "@/lib/integrations/engine";
import { logCall, USER_AGENT } from "@/lib/sources/http";

export type EntityImage = { site: string; image: string | null; logo: string | null; title: string | null };

const attr = (tag: string, name: string) => tag.match(new RegExp(`${name}\s*=\s*["']([^"']+)["']`, "i"))?.[1] ?? null;

/** Pure: Open Graph / Twitter image, best icon and title from a page head, resolved against the page URL. */
export function parseHead(html: string, pageUrl: string): Omit<EntityImage, "site"> {
  const metas = html.match(/<meta\b[^>]*>/gi) ?? [];
  const meta = (keys: string[]) => {
    for (const m of metas) { const k = (attr(m, "property") ?? attr(m, "name") ?? "").toLowerCase(); if (keys.includes(k)) { const c = attr(m, "content"); if (c) return c; } }
    return null;
  };
  const links = html.match(/<link\b[^>]*>/gi) ?? [];
  const icon = (rels: RegExp) => { for (const l of links) if (rels.test(attr(l, "rel") ?? "")) { const h = attr(l, "href"); if (h) return h; } return null; };
  const abs = (u: string | null) => { if (!u) return null; try { const x = new URL(u.replace(/&amp;/g, "&"), pageUrl); return x.protocol === "https:" || x.protocol === "http:" ? x.toString() : null; } catch { return null; } };
  const title = meta(["og:site_name", "og:title"]) ?? html.match(/<title[^>]*>([^<]{1,200})<\/title>/i)?.[1]?.trim() ?? null;
  return {
    image: abs(meta(["og:image", "og:image:url", "og:image:secure_url", "twitter:image", "twitter:image:src"])),
    logo: abs(icon(/apple-touch-icon/i) ?? icon(/(^|\s)icon(\s|$)|shortcut icon/i)) ?? abs("/favicon.ico"),
    title,
  };
}

export function normalizeSite(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try { const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`); return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null; } catch { return null; }
}

export async function entityImage(db: Db, siteUrl: string, fetchImpl: typeof fetch = fetch): Promise<EntityImage> {
  const key = `website_preview:${siteUrl.toLowerCase()}`;
  const [hit] = await db.select().from(sourceCache).where(eq(sourceCache.key, key));
  if (hit && hit.expiresAt > new Date().toISOString()) return JSON.parse(hit.value) as EntityImage;
  await assertIntegrationAllowed(db, "website_preview");
  let out: EntityImage = { site: siteUrl, image: null, logo: null, title: null };
  try {
    const res = await fetchImpl(siteUrl, { headers: { "user-agent": USER_AGENT, accept: "text/html" }, redirect: "follow", signal: AbortSignal.timeout(7000) });
    if (res.ok && /html/i.test(res.headers.get("content-type") ?? "html") && res.body) {
      const reader = res.body.getReader(); const dec = new TextDecoder(); let html = "";
      while (html.length < 262_144) { const { done, value } = await reader.read(); if (done) break; html += dec.decode(value, { stream: true }); if (/<\/head>/i.test(html)) break; }
      await reader.cancel().catch(() => undefined);
      out = { site: res.url || siteUrl, ...parseHead(html, res.url || siteUrl) };
    }
    await logCall(db, { provider: "website_preview", endpoint: "head", ok: res.ok, httpStatus: res.status });
  } catch (e) {
    await logCall(db, { provider: "website_preview", endpoint: "head", ok: false, detail: (e as Error).message.slice(0, 200) });
  }
  const value = JSON.stringify(out), expiresAt = new Date(Date.now() + 30 * 86_400_000).toISOString();
  await db.insert(sourceCache).values({ key, provider: "website_preview", value, expiresAt }).onConflictDoUpdate({ target: sourceCache.key, set: { value, expiresAt } });
  return out;
}
