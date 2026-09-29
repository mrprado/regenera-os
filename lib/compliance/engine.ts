// Campaign compliance: activity classification, permission state and risk tier (each with reasons), a legal campaign
// brief assembled only from rules recorded with their sources, approval rules, and audience eligibility (provenance,
// suppression, contact preferences). Missing or unreviewed rules escalate; nothing is ever assumed permitted.
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { campaigns, contactPreferences, contacts, jurisdictionRules } from "@/db/schema";
import type { Db } from "@/db";
import { audit } from "@/lib/audit";
import { DISCLAIMER, RULE_TOPICS, SOURCE_PROVENANCE, type ActivityClass, type Permission, type Provenance, type Risk } from "./vocab";

type Campaign = typeof campaigns.$inferSelect;
type Rule = typeof jurisdictionRules.$inferSelect;
const ORDER: Permission[] = ["allowed", "allowed_with_conditions", "consent_required", "legal_review_required", "blocked"];

export function provenanceOf(source: string | null | undefined): Provenance { return (source && SOURCE_PROVENANCE[source]) || "unknown"; }

export function classifyActivity(c: Pick<Campaign, "securitiesRelated" | "maOrAssetSale" | "capitalRelated" | "research" | "partnership" | "service" | "recipientTypes" | "commercial">): ActivityClass {
  if (c.securitiesRelated) return "securities_solicitation";
  if (c.maOrAssetSale) return "ma_asset_sale";
  const investors = c.recipientTypes.some(r => r.includes("investor"));
  if (c.capitalRelated && investors) return /debt|lend|project finance|credit/i.test(c.service) ? "debt_introduction" : "institutional_introduction";
  if (c.capitalRelated) return "capital_intelligence";
  if (c.research && !c.commercial) return "market_research";
  if (c.partnership) return "partnership";
  return c.service ? "advisory_marketing" : "business_development";
}

/** Rule topics a campaign needs covered in each jurisdiction. */
export function neededTopics(c: Pick<Campaign, "channel" | "recipientTypes" | "securitiesRelated" | "successFee" | "capitalRelated">): (keyof typeof RULE_TOPICS)[] {
  const t = new Set<keyof typeof RULE_TOPICS>(["data_protection"]);
  const individuals = c.recipientTypes.some(r => r === "individual" || r === "individual_investor");
  if (c.channel === "email") t.add(individuals ? "consumer_email" : "b2b_email");
  if (c.channel === "call") t.add("calls");
  if (c.securitiesRelated) t.add("securities");
  if (c.successFee && c.capitalRelated) { t.add("broker"); t.add("finder_fee"); }
  return [...t];
}

export type Assessment = { activity: ActivityClass; permission: Permission; permissionReasons: string[]; risk: Risk; riskFactors: string[]; missing: { jurisdiction: string; topic: string }[]; rules: string[] };
export function assessCampaign(c: Campaign, rules: Rule[], now = new Date()): Assessment {
  const activity = classifyActivity(c);
  const reasons: { p: Permission; why: string }[] = [];
  const add = (p: Permission, why: string) => reasons.push({ p, why });
  const yearAgo = new Date(now.getTime() - 365 * 86_400_000).toISOString().slice(0, 10);
  if (!c.countries.length) add("legal_review_required", "No recipient jurisdiction stated");
  if (activity === "securities_solicitation") c.recipientTypes.includes("individual_investor") ? add("blocked", "Securities solicitation to individual investors: only through a licensed intermediary with counsel") : add("legal_review_required", "Securities solicitation: regulated activity");
  if (c.successFee && c.capitalRelated) add("legal_review_required", "Success fee on capital raising may require broker / placement-agent licensing");
  if (activity === "ma_asset_sale") add("legal_review_required", "M&A / asset sale origination can be regulated activity");
  if (c.recipientTypes.some(r => r === "individual" || r === "individual_investor") && c.channel === "email") add("consent_required", "Electronic marketing to individuals generally needs prior consent");
  const used: string[] = [], missing: Assessment["missing"] = [];
  for (const j of c.countries) for (const topic of neededTopics(c)) {
    const r = rules.find(x => x.jurisdiction.toUpperCase() === j.toUpperCase() && x.topic === topic);
    if (!r) { missing.push({ jurisdiction: j, topic }); add("legal_review_required", `No recorded rule for ${RULE_TOPICS[topic]} in ${j}`); continue; }
    used.push(r.id);
    if (r.counselStatus !== "reviewed" || (r.lastReviewed && r.lastReviewed < yearAgo)) add("legal_review_required", `${RULE_TOPICS[topic]} in ${j}: rule not reviewed by counsel in the last 12 months`);
    else if (r.requirements.trim() || r.disclosures.trim() || r.optOut.trim()) add("allowed_with_conditions", `${RULE_TOPICS[topic]} in ${j}: ${[r.requirements, r.disclosures && `disclose ${r.disclosures}`, r.optOut && `opt-out: ${r.optOut}`].filter(Boolean).join("; ")}`);
  }
  if (c.dataSources.includes("unknown")) add("allowed_with_conditions", "Contacts of unknown provenance are excluded from the audience");
  const permission = reasons.reduce<Permission>((a, r) => (ORDER.indexOf(r.p) > ORDER.indexOf(a) ? r.p : a), "allowed");
  const riskFactors: string[] = [];
  if (c.countries.length > 1) riskFactors.push(`${c.countries.length} jurisdictions`);
  if (c.capitalRelated) riskFactors.push("Capital-related");
  if (c.recipientTypes.some(r => r.includes("individual"))) riskFactors.push("Individuals among recipients");
  if (c.dataSources.some(d => d === "licensed_database" || d === "enrichment")) riskFactors.push("Licensed / enriched data");
  if (c.dataSources.includes("unknown")) riskFactors.push("Unknown data provenance");
  const risk: Risk = permission === "blocked" ? "blocked" : permission === "legal_review_required" ? "high" : permission === "consent_required" || riskFactors.length >= 2 ? "moderate" : "low";
  return { activity, permission, permissionReasons: reasons.filter(r => r.p === permission || r.p !== "allowed").map(r => `${r.p.replace(/_/g, " ").toUpperCase()}: ${r.why}`), risk, riskFactors, missing, rules: used };
}

export type Brief = { title: string; sections: { heading: string; lines: string[] }[]; disclaimer: string };
/** Legal campaign brief: only rules on record (with source, effective date, review status). Never legal advice. */
export function legalBrief(c: Campaign, rules: Rule[], a: Assessment): Brief {
  const used = rules.filter(r => a.rules.includes(r.id));
  const L = (xs: (string | false | null | undefined)[]) => xs.filter(Boolean) as string[];
  return {
    title: `Campaign brief: ${c.name}`,
    sections: [
      { heading: "Campaign", lines: L([c.purpose || "Purpose not stated", c.service && `Service: ${c.service}`, `Channel: ${c.channel}`, c.cta && `Call to action: ${c.cta}`, `Commercial: ${c.commercial ? "yes" : "no"}`]) },
      { heading: "Jurisdictions and recipients", lines: L([`Jurisdictions: ${c.countries.join(", ") || "none stated"}`, `Recipients: ${c.recipientTypes.join(", ") || "none stated"}`]) },
      { heading: "Data sources", lines: c.dataSources.length ? c.dataSources : ["None stated"] },
      { heading: "Activity classification", lines: [a.activity.replace(/_/g, " ")] },
      { heading: "Legal / regulatory areas", lines: neededTopics(c).map(t => RULE_TOPICS[t]) },
      { heading: "Conditions and required disclosures", lines: used.length ? used.map(r => `${r.jurisdiction} · ${RULE_TOPICS[r.topic]}: ${[r.requirements, r.disclosures && `Disclose: ${r.disclosures}`].filter(Boolean).join(" ") || "no conditions recorded"}`).concat("Always: identify Regenera as sender, state why the recipient is contacted, offer a working opt-out.") : ["No rules on record: see escalation."] },
      { heading: "Opt-out requirements", lines: used.filter(r => r.optOut).map(r => `${r.jurisdiction}: ${r.optOut}`).concat("Global suppression and contact preferences override every campaign.") },
      { heading: "Data processing", lines: used.filter(r => r.topic === "data_protection").map(r => `${r.jurisdiction}: ${r.summary}`).concat(a.missing.some(m => m.topic === "data_protection") ? ["Data-protection rules missing for: " + a.missing.filter(m => m.topic === "data_protection").map(m => m.jurisdiction).join(", ")] : []) },
      { heading: "Capital-markets considerations", lines: c.capitalRelated || c.securitiesRelated ? L([c.securitiesRelated && "Securities-related: only through a licensed intermediary; no offering materials without counsel.", c.successFee && "Success fee: confirm licensing before any fee is discussed.", "Capital communications also pass the send-time compliance gate."]) : ["Not capital-related."] },
      { heading: "Escalation triggers", lines: L([...a.missing.map(m => `No recorded ${RULE_TOPICS[m.topic as keyof typeof RULE_TOPICS]} rule for ${m.jurisdiction}`), a.permission === "legal_review_required" && "Counsel review required before activation", "Any recipient objection, complaint or regulator contact"]) },
      { heading: "Permission and approval", lines: [...a.permissionReasons, `Risk: ${a.risk.toUpperCase()}${a.riskFactors.length ? ` (${a.riskFactors.join(", ")})` : ""}`, `Status: ${c.status}${c.approvedBy ? ` · approved by ${c.approvedBy} ${c.approvedAt?.slice(0, 10)}` : ""}`] },
      { heading: "Sources", lines: used.map(r => `${r.jurisdiction} · ${RULE_TOPICS[r.topic]}: ${r.sourceTitle || r.sourceUrl} (${r.sourceUrl}) · effective ${r.effectiveDate ?? "?"} · reviewed ${r.lastReviewed ?? "never"} · ${r.counselStatus.replace(/_/g, " ")}`) },
    ],
    disclaimer: DISCLAIMER,
  };
}

export async function refreshAssessment(db: Db, campaignId: string) {
  const [c] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId));
  if (!c) throw new Error("Campaign not found");
  const rules = await db.select().from(jurisdictionRules).where(eq(jurisdictionRules.mandateId, c.mandateId));
  const a = assessCampaign(c, rules);
  await db.update(campaigns).set({ assessment: a as unknown as Record<string, unknown>, updatedAt: new Date().toISOString() }).where(eq(campaigns.id, campaignId));
  return { c, a, rules };
}

/** Approval: blocked campaigns cannot be approved; legal review needs a counsel reference; high risk needs a note. */
export async function approveCampaign(db: Db, campaignId: string, actor: string, note: string, counselRef: string) {
  const { c, a } = await refreshAssessment(db, campaignId);
  if (a.permission === "blocked") throw new Error("Blocked: this campaign cannot be approved in the OS");
  if (a.permission === "legal_review_required" && !counselRef.trim()) throw new Error("Legal review required: record counsel's reference (who, date, opinion)");
  if ((a.risk === "high" || a.permission === "consent_required") && !note.trim()) throw new Error("Record the approval rationale");
  if (c.createdBy === actor && a.risk === "high") throw new Error("High-risk campaigns need approval by someone other than their creator");
  await db.update(campaigns).set({ status: "approved", approvedBy: actor, approvedAt: new Date().toISOString(), approvalNote: [note, counselRef && `Counsel: ${counselRef}`].filter(Boolean).join(" · ") }).where(eq(campaigns.id, campaignId));
  await audit(db, { actor, action: "campaign.approve", entity: "campaign", entityId: campaignId, after: { permission: a.permission, risk: a.risk } });
}

const BLOCKING_PREFS = ["do_not_contact", "all_marketing_opt_out", "legal_hold"];
/** Campaign gate at enrollment: the linked campaign must be approved; contacts with unknown provenance or blocking preferences are skipped. */
export async function campaignGate(db: Db, sequenceId: string, contactIds: string[]): Promise<{ blocked: string | null; skip: Map<string, string> }> {
  const [c] = await db.select().from(campaigns).where(and(eq(campaigns.sequenceId, sequenceId)));
  const skip = new Map<string, string>();
  if (!c || c.status === "closed") return { blocked: null, skip };
  if (c.status !== "approved" && c.status !== "active") return { blocked: `Campaign "${c.name}" is ${c.status}: approve it before enrolling`, skip };
  if (!contactIds.length) return { blocked: null, skip };
  const rows = await db.select({ id: contacts.id, source: contacts.source, email: contacts.emailLower }).from(contacts).where(inArray(contacts.id, contactIds));
  const emails = rows.map(r => r.email).filter((e): e is string => !!e);
  const prefs = await db.select().from(contactPreferences).where(and(isNull(contactPreferences.liftedAt), or(inArray(contactPreferences.contactId, contactIds), emails.length ? inArray(contactPreferences.email, emails) : undefined)));
  for (const r of rows) {
    const p = prefs.find(x => (x.contactId === r.id || (r.email && x.email === r.email)) && (BLOCKING_PREFS.includes(x.status) || (x.status === "email_opt_out" && c.channel === "email") || (x.status === "call_opt_out" && c.channel === "call")));
    if (p) skip.set(r.id, `preference_${p.status}`);
    else if (provenanceOf(r.source) === "unknown") skip.set(r.id, "unknown_provenance");
  }
  return { blocked: null, skip };
}
