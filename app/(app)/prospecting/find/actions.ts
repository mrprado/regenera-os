"use server";
// Phase 27: run an Apollo people search (0 credits) for one record's need. Results are suggestions on the record;
// nobody is contacted, and community bodies are filtered out.
import { redirect } from "next/navigation";
import { z } from "zod";
import { withOsUser } from "@/lib/auth";
import { apolloConfig } from "@/lib/config";
import { appDb } from "@/lib/db/scoped";
import { leadContext, LEAD_ENTITY_TYPES, saveLeadSearch } from "@/lib/leads/context";
import { LEAD_INSTRUMENTS, LEAD_SECTORS, LEAD_WORKFLOWS, type LeadInstrument, type LeadSector, type LeadWorkflow } from "@/lib/leads/matrix";
import { runSavedSearch } from "@/lib/radar/saved-searches";

const opt = <T extends string>(keys: T[]) => z.enum(keys as [T, ...T[]]).nullable().catch(null);

export async function findPeopleAction(form: FormData) {
  const type = z.enum(LEAD_ENTITY_TYPES).parse(form.get("type"));
  const id = z.string().min(1).max(64).parse(form.get("id"));
  const workflow = z.enum(Object.keys(LEAD_WORKFLOWS) as [LeadWorkflow, ...LeadWorkflow[]]).parse(form.get("workflow"));
  const sector = opt(Object.keys(LEAD_SECTORS) as LeadSector[]).parse(form.get("sector") || null);
  const instrument = opt(Object.keys(LEAD_INSTRUMENTS) as LeadInstrument[]).parse(form.get("instrument") || null);
  const country = z.string().trim().max(80).nullable().catch(null).parse(form.get("country") || null);
  const organization = z.string().trim().max(160).nullable().catch(null).parse(form.get("organization") || null);
  const back = `/prospecting/find?type=${type}&id=${id}&workflow=${workflow}${sector ? `&sector=${sector}` : ""}${instrument ? `&instrument=${instrument}` : ""}${country ? `&country=${encodeURIComponent(country)}` : ""}${organization ? `&organization=${encodeURIComponent(organization)}` : ""}`;
  let notice = "";
  await withOsUser(async user => {
    const db = appDb();
    const ctx = await leadContext(db, user.scope, type, id);
    if (!ctx) throw new Error("Record not found");
    const searchId = await saveLeadSearch(db, ctx, { workflow, sector, instrument, country, organization }, user.email);
    const cfg = apolloConfig();
    if (!cfg) { notice = "Search saved. Apollo is not configured (APOLLO_API_KEY), so use the LinkedIn and Google links below."; return; }
    try { const added = await runSavedSearch(db, cfg, searchId); notice = added ? `${added} new people suggested below. Nobody has been contacted.` : "No new people for this search (everyone found is already in Network, or none matched). Try another role set or the links below."; }
    catch (e) { notice = `Apollo search did not run: ${(e as Error).message.slice(0, 160)}. The links below still work.`; }
  });
  redirect(`${back}&notice=${encodeURIComponent(notice)}`);
}
