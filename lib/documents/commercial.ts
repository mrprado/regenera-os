// Commercial documents built from records (extended specification §11–12): account brief, opportunity shortlist,
// bid / no-bid memo, audience-specific proposal, capital matching brief, meeting brief. Every fact comes from a record;
// gaps render as [TO CONFIRM: …] so they can never pass silently; prices come only from the opportunity's recorded fee
// or the approved services catalogue band; proof only from disclosure-authorized case records. Drafts, never sent.
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db";
import {
  accountCoverage, accountQualifications, activities, caseRecords, contacts, deals, objectives, opportunityQualifications, organizations, partyProfiles, projects,
  scanResults, scanRuns, services, COVERAGE_ROLES, OBJECTIVE_KINDS, QUALIFICATION_FIELDS, type ObjectiveKind, type QualificationField,
} from "@/db/schema";
import { offer as offerOf, offersFor } from "@/lib/scan/offers";
import { audience } from "@/lib/scan/audiences";
import { DIMENSIONS, QUALIFICATION_LABELS, READINGS } from "@/lib/scan/qualification";
import { PROFILE_ROLES, BASIS_LABELS } from "@/lib/flow/profiles";
import { countryName } from "@/lib/scan/countries";
import { DEAL_STAGES } from "@/lib/vocab";

const TC = (what: string) => `[TO CONFIRM: ${what}]`;
const money = (n: number, cur = "USD") => `${cur} ${Math.round(n).toLocaleString("en-US")}`;
export type Built = { title: string; md: string };

const about = (today: string, sources: string[], unknowns: string[]) => [
  "", "## About this document",
  `- Prepared ${today} by Regenera OS from its records. Draft for review; nothing here has been sent.`,
  `- Sources: ${sources.length ? sources.join("; ") : "records entered in Regenera OS"}.`,
  `- Open items: ${unknowns.length ? unknowns.join("; ") : "none recorded"}.`,
  "- Not legal, engineering, tax or investment advice. Commercial fit is not regulatory eligibility.",
].join("\n");

export const COMMERCIAL_KEYS = ["account-brief", "meeting-brief", "opportunity-shortlist", "bid-no-bid", "proposal", "capital-matching-brief"] as const;

export async function commercialMarkdown(db: Db, key: string, entityId: string, today: string): Promise<Built | null> {
  if (key === "account-brief" || key === "meeting-brief") return accountBrief(db, entityId, today, key === "meeting-brief");
  if (key === "opportunity-shortlist" || key === "capital-matching-brief") return shortlist(db, entityId, today, key === "capital-matching-brief");
  if (key === "bid-no-bid") return bidNoBid(db, entityId, today);
  if (key === "proposal") return proposal(db, entityId, today);
  return null;
}

async function accountBrief(db: Db, idOrDeal: string, today: string, meeting: boolean): Promise<Built | null> {
  // Accepts an organization id, or an opportunity id (its organization).
  let [o] = await db.select().from(organizations).where(eq(organizations.id, idOrDeal));
  let deal: typeof deals.$inferSelect | undefined;
  if (!o) { [deal] = await db.select().from(deals).where(eq(deals.id, idOrDeal)); if (deal?.orgId) [o] = await db.select().from(organizations).where(eq(organizations.id, deal.orgId)); }
  if (!o) return null;
  const [q] = await db.select().from(accountQualifications).where(and(eq(accountQualifications.mandateId, o.mandateId), eq(accountQualifications.orgId, o.id)));
  const [profiles, coverage, objs, log, people] = await Promise.all([
    db.select().from(partyProfiles).where(and(eq(partyProfiles.mandateId, o.mandateId), eq(partyProfiles.orgId, o.id))),
    db.select({ c: accountCoverage, name: contacts.fullName, title: contacts.title }).from(accountCoverage).leftJoin(contacts, eq(contacts.id, accountCoverage.contactId)).where(and(eq(accountCoverage.mandateId, o.mandateId), eq(accountCoverage.orgId, o.id))),
    db.select().from(objectives).where(and(eq(objectives.mandateId, o.mandateId), eq(objectives.orgId, o.id))),
    db.select().from(activities).where(and(eq(activities.mandateId, o.mandateId), eq(activities.orgId, o.id))).orderBy(desc(activities.occurredAt)).limit(10),
    db.select({ name: contacts.fullName, title: contacts.title }).from(contacts).where(and(eq(contacts.mandateId, o.mandateId), eq(contacts.orgId, o.id))).limit(12),
  ]);
  const unknowns: string[] = [];
  const title = `${meeting ? "Meeting brief" : "Account brief"}: ${o.name}`;
  const lines = [`# ${title}`, ""];
  lines.push("## Who they are", `- Website: ${o.website ?? o.domain ?? TC("website")}`, `- Location (headquarters): ${[o.location, countryName(o.country)].filter(Boolean).join(", ") || TC("headquarters")}`,
    `- What they do (as recorded): ${o.description ?? o.industry ?? TC("business description from a source")}`);
  if (!o.website && !o.domain) unknowns.push("website");
  for (const p of profiles) {
    const def = PROFILE_ROLES[p.role];
    lines.push("", `## ${def?.label ?? p.role} profile`, `- Operating coverage: ${p.coverage.length ? p.coverage.map(countryName).join(", ") : TC("countries where they actually operate")} (${BASIS_LABELS[p.coverageBasis as keyof typeof BASIS_LABELS] ?? p.coverageBasis})`);
    for (const f of def?.fields ?? []) { const v = p.fields[f.key]; lines.push(`- ${f.label}: ${v ? `${v.value} (${BASIS_LABELS[v.basis]}${v.source ? `, ${v.source}` : ""})` : "unknown"}`); }
  }
  lines.push("", "## Where the account stands", q ? `- Status: ${QUALIFICATION_LABELS[q.status]}` : "- Status: not assessed");
  if (q) for (const [k, label] of Object.entries(DIMENSIONS)) { const d = q.dimensions[k]; lines.push(`- ${label}: ${d ? `${READINGS[d.reading]} (${d.basis})` : "Unknown"}`); }
  if (q?.whyNow) lines.push(`- Why now: ${q.whyNow}`); else unknowns.push("why now");
  lines.push("", "## Coverage", ...Object.entries(COVERAGE_ROLES).map(([k, label]) => { const c = coverage.find(x => x.c.role === k); return `- ${label}: ${c?.name ? `${c.name}${c.title ? `, ${c.title}` : ""}` : "unknown"}${c?.c.relationshipOwner ? ` · owner ${c.c.relationshipOwner}` : ""}${c?.c.nextAction ? ` · next: ${c.c.nextAction}` : ""}`; }));
  if (people.length) lines.push("", "## People on record", ...people.map(p => `- ${p.name}${p.title ? `, ${p.title}` : ""}`));
  if (objs.length) lines.push("", "## Their objectives", ...objs.map(x => `- ${x.title} (${OBJECTIVE_KINDS[x.kind as ObjectiveKind] ?? x.kind}): ${x.desiredOutcome || TC("desired outcome")}`));
  lines.push("", "## Recent interactions", ...(log.length ? log.map(a => `- ${a.occurredAt.slice(0, 10)} ${a.type.replace(/_/g, " ")}: ${a.detail.slice(0, 200)}`) : ["- None recorded."]));
  if (meeting) {
    const offers = q?.audience ? offersFor(q.audience) : [];
    lines.push("", "## For this meeting", `- Meeting: ${deal ? deal.name : TC("meeting purpose")}`, "- Desired outcome: " + TC("what a good outcome is"),
      "- Open questions:", ...(q ? Object.entries(DIMENSIONS).filter(([k]) => !q.dimensions[k] || q.dimensions[k].reading === "unknown").map(([, l]) => `  - ${l}: what evidence exists?`) : ["  - Their current decision, timing and budget path"]),
      ...(offers.length ? ["- Relevant offers:", ...offers.map(x => `  - ${x.name}: ${x.entryOffer}`)] : []));
  }
  return { title, md: [...lines, about(today, ["organization record", "profiles", "coverage", "activity log"], unknowns)].join("\n") };
}

async function shortlist(db: Db, objectiveId: string, today: string, capital: boolean): Promise<Built | null> {
  const [o] = await db.select().from(objectives).where(eq(objectives.id, objectiveId));
  if (!o) return null;
  const [run] = await db.select().from(scanRuns).where(eq(scanRuns.objectiveId, o.id)).orderBy(desc(scanRuns.createdAt)).limit(1);
  const rows = run ? await db.select().from(scanResults).where(and(eq(scanResults.runId, run.id), inArray(scanResults.review, ["needs_review", "accepted"]))).orderBy(asc(scanResults.name)).limit(200) : [];
  const ranked = rows.filter(r => r.match !== "excluded").sort((a, b) => (b.review === "accepted" ? 1 : 0) - (a.review === "accepted" ? 1 : 0) || ["matches", "partial", "unknown"].indexOf(a.match) - ["matches", "partial", "unknown"].indexOf(b.match)).slice(0, 25);
  const title = `${capital ? "Capital matching brief" : "Opportunity shortlist"}: ${o.title}`;
  const lines = [`# ${title}`, "", "## Objective", `- ${OBJECTIVE_KINDS[o.kind as ObjectiveKind] ?? o.kind}`, `- Desired outcome: ${o.desiredOutcome || TC("desired outcome")}`,
    `- Geography: ${o.geography.map(countryName).join(", ") || "any"} · Capabilities: ${o.capabilities.join(", ") || "not stated"} · Size: ${o.sizeMin ?? 0}–${o.sizeMax ?? "any"} ${o.sizeUnit ?? ""}`,
    `- Exclusions: ${o.exclusions.join(", ") || "none recorded"}`, "",
    `## Shortlist (${ranked.length} of ${rows.length} reviewed or pending; potential matches until eligibility and terms are checked)`];
  if (!run) lines.push("No scan has run for this objective yet.");
  for (const [i, r] of ranked.entries()) {
    lines.push("", `### ${i + 1}. ${r.name}`, `- Status: ${r.review === "accepted" ? "accepted by a reviewer" : "not yet reviewed"} · fit ${r.match} · evidence confidence ${r.confidence ?? "not rated"}`,
      ...r.criteria.map(c => `- ${c.label}: ${c.result === "supported" ? "supported" : c.result === "contradicted" ? "mismatch" : "unknown"}: ${c.evidence}`),
      ...r.caveats.map(c => `- Note: ${c}`), `- Next action: ${r.nextAction ?? TC("next action")}`, ...(r.sourceUrl ? [`- Source: ${r.sourceUrl}`] : []));
  }
  if (capital) lines.push("", "## Regulatory note", "- This brief compares stated criteria only. Investor classification, offering rules and any introduction need separate review; nothing here is an offer or solicitation.");
  return { title, md: [...lines, about(today, [run ? `scan "${run.presetName}" of ${run.createdAt.slice(0, 10)}` : "no scan", "objective record"], run ? [] : ["run a scan for this objective"])].join("\n") };
}

async function dealContext(db: Db, dealId: string) {
  const [d] = await db.select().from(deals).where(eq(deals.id, dealId));
  if (!d) return null;
  const [org] = d.orgId ? await db.select().from(organizations).where(eq(organizations.id, d.orgId)) : [];
  const [q] = await db.select().from(opportunityQualifications).where(eq(opportunityQualifications.dealId, d.id));
  const [aq] = d.orgId ? await db.select().from(accountQualifications).where(and(eq(accountQualifications.mandateId, d.mandateId), eq(accountQualifications.orgId, d.orgId))) : [];
  const [project] = d.projectId ? await db.select().from(projects).where(eq(projects.id, d.projectId)) : [];
  return { d, org, q, aq, project };
}
const field = (q: { fields: Partial<Record<QualificationField, { text: string; evidence: string }>> } | undefined, f: QualificationField) => q?.fields[f]?.text ? `${q.fields[f]!.text}${q.fields[f]!.evidence ? ` (evidence: ${q.fields[f]!.evidence})` : ""}` : TC(QUALIFICATION_FIELDS[f].toLowerCase());

async function bidNoBid(db: Db, dealId: string, today: string): Promise<Built | null> {
  const c = await dealContext(db, dealId);
  if (!c) return null;
  const { d, org, q } = c;
  const title = `Bid / no-bid memo: ${d.name}`;
  const fields: QualificationField[] = ["need", "decision", "buyer", "decisionProcess", "budgetPath", "timing", "alternatives", "offer", "feeBasis"];
  return { title, md: [`# ${title}`, "", `**Client:** ${org?.name ?? TC("client")} · **Stage:** ${DEAL_STAGES[d.stage]}`, "",
    "## Evidence by criterion", ...fields.map(f => `- ${QUALIFICATION_FIELDS[f]}: ${field(q, f)}`), "",
    "## Capacity and economics", `- Expected Regenera fee: ${d.valueEstimate != null ? `${money(d.valueEstimate)} (recorded on the opportunity)` : TC("expected fee")}`, `- Team and capacity: ${TC("who delivers, and when")}`, `- Costs to pursue: ${TC("pursuit cost and specialist inputs")}`, "",
    "## Risks and unknowns", ...(q ? Object.entries(QUALIFICATION_FIELDS).filter(([k]) => !q.fields[k as QualificationField]).map(([, l]) => `- ${l}: unknown`) : ["- Qualification not started."]), "",
    "## Decision", "- Recommendation: " + TC("bid or no-bid, with reason"), `- Decided by: ${q?.decidedBy ?? TC("named person")} · ${q?.decision && q.decision !== "open" ? q.decision.replace("_", " ") : "not decided"}`, "- The decision is a person's; this memo only assembles the evidence.",
    about(today, ["opportunity record", "commercial qualification"], q ? [] : ["commercial qualification"])].join("\n") };
}

async function proposal(db: Db, dealId: string, today: string): Promise<Built | null> {
  const c = await dealContext(db, dealId);
  if (!c) return null;
  const { d, org, q, aq, project } = c;
  const off = offerOf(q?.offerKey ?? "") ?? (aq?.audience ? offersFor(aq.audience).find(x => x.motion === "client") ?? null : null);
  const [svc] = off?.serviceKey ? await db.select().from(services).where(and(eq(services.mandateId, d.mandateId), eq(services.key, off.serviceKey))).limit(1) : [];
  const cases = await db.select({ id: caseRecords.id }).from(caseRecords).where(and(eq(caseRecords.mandateId, d.mandateId), eq(caseRecords.disclosureAuthorized, true))).limit(3).catch(() => [] as { id: string }[]);
  const aud = aq?.audience ? audience(aq.audience) : null;
  const fee = d.valueEstimate != null ? `${money(d.valueEstimate)} (recorded on the opportunity; confirm before sending)`
    : svc && svc.bandLow != null ? TC(`fee within the approved band ${money(svc.bandLow)}${svc.bandHigh ? `–${money(svc.bandHigh)}` : ""} for "${svc.name}"`) : TC("fee and currency (no approved price on record)");
  const title = `Proposal: ${off?.name ?? d.name} for ${org?.name ?? TC("client")}`;
  const md = [`# ${title}`, "", `Prepared for ${org?.name ?? TC("client")} · ${today} · DRAFT`, "",
    "## Situation", field(q, "need"), "",
    "## Objective", field(q, "decision"), "",
    "## Scope", off ? off.entryOffer : TC("scope"), ...(project ? [`Project: ${project.name}${project.country ? `, ${countryName(project.country)}` : ""}.`] : []), "",
    "## Deliverables", ...((svc?.deliverables as string[] | undefined)?.length ? (svc!.deliverables as string[]).map(x => `- ${x}`) : off ? off.deliverables.map(x => `- ${x}`) : [`- ${TC("deliverables")}`]), "",
    "## Method and workstreams", ...((svc?.workflow as string[] | undefined)?.length ? (svc!.workflow as string[]).map(x => `- ${x}`) : [`- ${TC("method")}`]), "",
    "## Acceptance criteria", `- ${TC("how the client accepts each deliverable")}`, "",
    "## Schedule and dependencies", `- Duration: ${svc?.timelineWeeks ? `about ${svc.timelineWeeks} weeks from kickoff` : TC("duration")}`, `- Client inputs: ${(svc?.inputs as string[] | undefined)?.join(", ") || TC("client inputs")}`, `- Timing: ${field(q, "timing")}`, "",
    "## Responsibilities", `- Regenera: ${off?.entryOffer ?? TC("Regenera responsibilities")}`, `- ${org?.name ?? "Client"}: ${TC("client responsibilities")}`, ...((svc?.specialistRequired as string[] | undefined)?.length ? [`- Specialists (engaged separately): ${(svc!.specialistRequired as string[]).join(", ")}`] : []), "",
    "## Fee and payment", `- Fee: ${fee}`, `- Payment milestones: ${TC("milestones")}`, ...(off?.commercialModel ? [`- Basis: ${off.commercialModel}`] : []), "",
    "## Assumptions", `- ${TC("assumptions")}`, "",
    "## Exclusions", ...(svc?.legalNotes ? [`- ${svc.legalNotes}`] : []), "- Engineering design, legal, tax and investment advice are outside this scope unless stated.", "- Changes to scope follow a written change request agreed by both parties.", "",
    "## Relevant experience", cases.length ? `${cases.length} disclosure-authorized case record(s) on file: ${TC("select and summarize")}.` : "No disclosure-authorized case records are on file; none is cited.", "",
    "## Validity and next step", `- Valid for ${TC("days")}.`, `- Next step: ${field(q, "agreedNextStep")}`,
    about(today, ["opportunity", "commercial qualification", off ? `offer "${off.name}"` : "no offer selected", svc ? `services catalogue "${svc.name}"` : "no catalogue price"], [...(off ? [] : ["choose the offer"]), ...(aud ? [] : ["audience of the account"])])].join("\n");
  return { title, md };
}
