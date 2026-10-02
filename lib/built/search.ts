// Built-environment search (§20): companies, technologies and materials, scoped. Words match names, subsectors,
// summaries and taxonomy; place words match regions ("Mexico" → Latin America). Governed knowledge is never searched.
import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import { beCompanyProfiles, beMaterials, beTechnologies, organizations } from "@/db/schema";
import { mandateCondition, type UserScope } from "@/lib/db/scoped";
import type { SearchHit } from "@/lib/search";
import { COMPANY_STAGES, REGIONS, TAXONOMY } from "./vocab";

const PLACE: Record<string, string> = {
  mexico: "latin_america", yucatan: "latin_america", brazil: "latin_america", colombia: "latin_america", chile: "latin_america", peru: "latin_america", latam: "latin_america", caribbean: "latin_america",
  usa: "north_america", california: "north_america", texas: "north_america", canada: "north_america", kenya: "africa", ghana: "africa", nigeria: "africa", "south africa": "africa",
  india: "india", uk: "europe", spain: "europe", germany: "europe", france: "europe", uae: "middle_east", saudi: "middle_east", indonesia: "southeast_asia", vietnam: "southeast_asia", australia: "oceania", "new zealand": "oceania",
};
const STOP = new Set(["companies", "company", "expanding", "into", "for", "the", "and", "with", "supplier", "suppliers", "investor", "investors"]);

export async function builtSearch(db: Db, scope: UserScope, q: string, limit = 6): Promise<SearchHit[]> {
  const words = q.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  if (!words.length) return [];
  const regions = words.map(w => PLACE[w]).filter(Boolean);
  const subject = words.filter(w => !PLACE[w] && !STOP.has(w));
  const wantsExpansion = words.includes("expanding") || words.includes("expansion");
  const stageWord = Object.entries(COMPANY_STAGES).find(([, v]) => q.toLowerCase().includes(v.toLowerCase()))?.[0];
  const has = (text: string) => subject.every(w => text.includes(w) || text.includes(w.replace(/s$/, "")));
  const [profs, techs, mats] = await Promise.all([
    db.select({ p: beCompanyProfiles, name: organizations.name }).from(beCompanyProfiles).innerJoin(organizations, eq(organizations.id, beCompanyProfiles.orgId)).where(mandateCondition(scope, beCompanyProfiles.mandateId)).limit(1000),
    db.select().from(beTechnologies).where(mandateCondition(scope, beTechnologies.mandateId)).limit(1000),
    db.select().from(beMaterials).where(mandateCondition(scope, beMaterials.mandateId)).limit(1000),
  ]);
  const regionOk = (rs: string[]) => !regions.length || regions.some(r => rs.includes(r));
  const out: SearchHit[] = [];
  for (const x of profs) {
    const text = `${x.name} ${x.p.subsectors.join(" ")} ${x.p.summary} ${x.p.technologyType} ${x.p.taxonomy.map(t => TAXONOMY[t as keyof typeof TAXONOMY]?.label ?? t).join(" ")} ${x.p.buildingSegments.join(" ")}`.toLowerCase();
    const stageOk = !stageWord || x.p.fundingStage === stageWord;
    const expOk = !wantsExpansion || !!x.p.expansionStatus || x.p.targetRegions.some(r => !x.p.operatingRegions.includes(r));
    const regs = wantsExpansion ? x.p.targetRegions : [...x.p.operatingRegions, ...x.p.targetRegions];
    if ((subject.length ? has(text) : true) && regionOk(regs) && stageOk && expOk && (subject.length || regions.length || stageWord))
      out.push({ type: "Built environment company", label: x.name, sub: [x.p.subsectors[0], x.p.operatingRegions.map(r => REGIONS[r as keyof typeof REGIONS]).join(", ")].filter(Boolean).join(" · "), href: `/intelligence/built?tab=companies&open=${x.p.orgId}` });
  }
  for (const t of techs) {
    const text = `${t.name} ${t.subcategory} ${t.category} ${t.buildingTypes.join(" ")} ${t.climates.join(" ")}`.toLowerCase();
    if (subject.length && has(text)) out.push({ type: "Technology", label: t.name, sub: t.subcategory, href: `/intelligence/built?tab=technologies&q=${encodeURIComponent(t.name)}` });
  }
  for (const m of mats) {
    const text = `${m.name} ${m.family} ${m.tags.join(" ")}`.toLowerCase().replace(/_/g, " ");
    if (subject.length && has(text) && regionOk(m.localAvailability.length ? m.localAvailability : regions)) out.push({ type: "Material", label: m.name, sub: m.family, href: `/intelligence/built?tab=materials` });
  }
  return out.slice(0, limit * 2);
}
