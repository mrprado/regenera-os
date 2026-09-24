"use server";

import { and, eq, inArray } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { savedSearches, searchResults } from "@/db/schema";
import { audit } from "@/lib/audit";
import { withOsUser } from "@/lib/auth";
import { apolloConfig } from "@/lib/config";
import { upsertContact, upsertOrganization } from "@/lib/crm/entities";
import { appDb, mandateCondition } from "@/lib/db/scoped";
import { issueExtensionToken, revokeExtensionToken } from "@/lib/extension";
import { enqueue } from "@/lib/jobs/queue";
import type { ApolloPerson } from "@/lib/sources/apollo";
import { runSavedSearch } from "@/lib/radar/saved-searches";
import { SourceError } from "@/lib/sources/http";

const zId = z.string().uuid();
const note = (path: string, text: string) => `${path}${path.includes("?") ? "&" : "?"}notice=${encodeURIComponent(text)}`;

export async function runSearchNowAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  let text = "";
  await withOsUser(async user => {
    const cfg = apolloConfig();
    if (!cfg) { text = "Set APOLLO_API_KEY (free plan) to run Apollo searches."; return; }
    const db = appDb();
    const [s] = await db.select().from(savedSearches).where(and(eq(savedSearches.id, id), mandateCondition(user.scope, savedSearches.mandateId)));
    if (!s) throw new Error("Search not found");
    try {
      const n = await runSavedSearch(db, cfg, id);
      text = `${s.name}: ${n} new ${n === 1 ? "person" : "people"} not yet in the CRM.`;
    } catch (e) {
      text = e instanceof SourceError ? e.message : "Apollo search failed.";
    }
  });
  redirect(note(`/searches?search=${id}`, text));
}

export async function toggleSearchAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  await withOsUser(async user => {
    const db = appDb();
    const [s] = await db.select().from(savedSearches).where(and(eq(savedSearches.id, id), mandateCondition(user.scope, savedSearches.mandateId)));
    if (!s) throw new Error("Search not found");
    await db.update(savedSearches).set({ enabled: !s.enabled, updatedAt: new Date().toISOString() }).where(eq(savedSearches.id, id));
  }, { owner: true });
  redirect("/searches");
}

/** Saves reviewed results as people (and their organizations). No credits: enrichment stays a separate choice. */
export async function saveResultsAction(formData: FormData) {
  const ids = z.array(zId).max(200).parse(formData.getAll("ids"));
  const dismiss = formData.get("do") === "dismiss";
  const back = z.string().startsWith("/searches").catch("/searches").parse(formData.get("back"));
  let text = "";
  await withOsUser(async user => {
    const db = appDb();
    const rows = await db.select().from(searchResults).where(and(inArray(searchResults.id, ids), mandateCondition(user.scope, searchResults.mandateId), eq(searchResults.status, "new")));
    if (dismiss) {
      if (rows.length) await db.update(searchResults).set({ status: "dismissed" }).where(inArray(searchResults.id, rows.map(r => r.id)));
      text = `Dismissed ${rows.length}.`;
      return;
    }
    let saved = 0;
    for (const r of rows) {
      const [s] = await db.select({ segmentId: savedSearches.segmentId }).from(savedSearches).where(eq(savedSearches.id, r.savedSearchId));
      const p = r.payload as unknown as ApolloPerson;
      let orgId: string | null = null;
      if (p.organization?.name) {
        const o = await upsertOrganization(db, r.mandateId, {
          name: p.organization.name, domain: p.organization.primary_domain, website: p.organization.website_url, industry: p.organization.industry,
          headcount: p.organization.estimated_num_employees ?? null, apolloOrgId: p.organization.id ?? null, linkedinUrl: p.organization.linkedin_url,
          location: [p.organization.city, p.organization.country].filter(Boolean).join(", ") || null, segmentId: s?.segmentId ?? null,
        }, "apollo", { source: "apollo" });
        orgId = o.row.id;
      }
      await upsertContact(db, r.mandateId, {
        fullName: r.name, firstName: p.first_name, lastName: p.last_name, title: p.title, seniority: p.seniority, linkedinUrl: p.linkedin_url,
        location: [p.city, p.state, p.country].filter(Boolean).join(", ") || null, country: p.country, apolloPersonId: p.id, orgId, segmentId: s?.segmentId ?? null,
      }, "apollo", { source: "apollo" });
      await db.update(searchResults).set({ status: "saved" }).where(eq(searchResults.id, r.id));
      saved++;
    }
    await audit(db, { actor: user.email, action: "search_results_saved", entity: "search_results", after: { saved } });
    text = `Saved ${saved} to People. Enrich emails from People when you are ready to contact them.`;
  });
  redirect(note(back, text));
}

export async function runListNowAction(formData: FormData) {
  const key = z.enum(["sbti", "tnfd"]).parse(formData.get("key"));
  await withOsUser(async user => {
    await enqueue(appDb(), "lists.diff.source", { key }, { dedupeKey: `listdiff:${key}:manual:${new Date().toISOString().slice(0, 13)}` });
    await audit(appDb(), { actor: user.email, action: "list_diff_requested", entity: "list_sources", entityId: key });
  }, { owner: true });
  redirect(note("/searches?tab=lists", "Queued. It runs on the next job tick (the SBTi file takes a few seconds to read)."));
}

// ---------- extension tokens ----------
export async function issueExtensionTokenAction() {
  let token = "";
  await withOsUser(async user => {
    token = await issueExtensionToken(appDb(), user.email);
    await audit(appDb(), { actor: user.email, action: "extension_token_issued", entity: "extension_tokens" });
  });
  // Shown once, in the URL fragment so it never reaches server logs.
  redirect(`/settings/extension#token=${token}`);
}

export async function revokeExtensionTokenAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  await withOsUser(async user => {
    await revokeExtensionToken(appDb(), id, user.email);
    await audit(appDb(), { actor: user.email, action: "extension_token_revoked", entity: "extension_tokens", entityId: id });
  });
  redirect("/settings/extension");
}

export async function weeklyReportNowAction() {
  await withOsUser(async user => {
    await enqueue(appDb(), "reports.weekly", {}, { dedupeKey: `weekly:manual:${new Date().toISOString().slice(0, 13)}` });
    await audit(appDb(), { actor: user.email, action: "weekly_report_requested", entity: "reports" });
  }, { owner: true });
  redirect(note("/reports", "The weekly report for last week is queued and appears here after the next job tick."));
}
