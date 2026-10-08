// Document requests (phase 20 §5): what was asked of a counterparty, what arrived, under which NDA. Templates are
// reusable checklists; the institutional template follows the readiness standard lenders apply to utility-scale
// projects (site and land, interconnection, permits, revenue, engineering, resource, EPC, structure, risks, data room).
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { docRequestItems, docRequests } from "@/db/schema";

export const REQUEST_TEMPLATES: Record<string, { label: string; sections: { section: string; items: string[] }[] }> = {
  institutional: {
    label: "Institutional readiness pack (utility-scale project)",
    sections: [
      { section: "1. Project summary", items: ["Location (state/municipality, coordinates or polygon)", "Capacity (MWac / MWp) and technology (modules, inverters, tracking)", "Estimated timeline to COD", "Preliminary CAPEX and current status"] },
      { section: "2. Site and land", items: ["Ownership type (private / communal) and area (ha)", "Signed option, lease or purchase contracts and their term", "Evidence of title, liens and easements (access and lines)"] },
      { section: "3. Interconnection", items: ["Proposed point of interconnection and available capacity", "Evidence of applications and studies, and current status", "Timeline and estimated cost of interconnection works"] },
      { section: "4. Permits and compliance", items: ["Permit matrix and status (environmental, municipal/state, land use)", "Environmental impact assessment and decisions"] },
      { section: "5. Revenue", items: ["PPA or sales scheme (merchant / supply / private)", "Key terms: price, term, guarantees, curtailment and penalties", "Offtaker profile and credit support"] },
      { section: "6. Engineering and design", items: ["Preliminary layout, single-line diagram and design basis", "Substation, line and external works scope"] },
      { section: "7. Solar resource and production", items: ["Resource study (data source) with P50/P90", "Simulation (PVsyst or other) and assumptions (losses, degradation)"] },
      { section: "8. EPC and execution", items: ["EPC strategy (turnkey or multi-contract) and contractors considered", "Construction programme (critical path) to COD", "CAPEX breakdown (civil, electrical, substation, line)"] },
      { section: "9. Structure and finance", items: ["Financial model (base case and sensitivities) and key assumptions", "Proposed SPV, cap table and sponsor KYC/UBO", "Amount required, use of funds and milestones to financial close"] },
      { section: "10. Risks and mitigation", items: ["Critical open items (land, permits, interconnection, EPC)", "Mitigation plan with owners and dates"] },
      { section: "11. Data room", items: ["Data room index and copies of available contracts"] },
      { section: "12. Sponsor", items: ["Audited accounts (latest two years)", "Current board and ownership chart", "Track record of completed projects"] },
    ],
  },
  nda_pack: {
    label: "First-look pack under NDA",
    sections: [
      { section: "Agreement", items: ["Mutual NDA signed"] },
      { section: "Project", items: ["One-page project sheet", "Location and site boundary", "Stated capacity basis (MWac or MWp)", "Yield report or resource source"] },
      { section: "Commercial", items: ["Offtake status (signed / negotiating / none)", "Grid status (studies, agreements)"] },
      { section: "Sponsor", items: ["Corporate registration and ownership", "Latest accounts"] },
    ],
  },
};

export async function createRequest(db: Db, x: { mandateId: string; orgId: string | null; projectId: string | null; title: string; template: string; dueDate: string | null; ndaDocumentId: string | null; actor: string }) {
  const tpl = REQUEST_TEMPLATES[x.template];
  if (!tpl) throw new Error("Unknown template");
  const [req] = await db.insert(docRequests).values({ mandateId: x.mandateId, orgId: x.orgId, projectId: x.projectId, title: x.title, template: x.template, dueDate: x.dueDate, ndaDocumentId: x.ndaDocumentId, createdBy: x.actor }).returning();
  let position = 0;
  const rows = tpl.sections.flatMap(s => s.items.map(item => ({ requestId: req.id, mandateId: x.mandateId, section: s.section, item, position: position++ })));
  for (let i = 0; i < rows.length; i += 12) await db.insert(docRequestItems).values(rows.slice(i, i + 12));
  return req;
}

export async function requestItems(db: Db, requestId: string) {
  return db.select().from(docRequestItems).where(eq(docRequestItems.requestId, requestId)).orderBy(asc(docRequestItems.position));
}

/** Counts per state for a set of requests (open items = requested, partial, under NDA). */
export async function requestProgress(db: Db, requestIds: string[]) {
  if (!requestIds.length) return new Map<string, Record<string, number>>();
  const rows = await db.select({ requestId: docRequestItems.requestId, status: docRequestItems.status, n: sql<number>`count(*)` }).from(docRequestItems).where(inArray(docRequestItems.requestId, requestIds.slice(0, 90))).groupBy(docRequestItems.requestId, docRequestItems.status);
  const out = new Map<string, Record<string, number>>();
  for (const r of rows) out.set(r.requestId, { ...(out.get(r.requestId) ?? {}), [r.status]: r.n });
  return out;
}

export const openCount = (p: Record<string, number> | undefined) => (p?.requested ?? 0) + (p?.partial ?? 0) + (p?.under_nda ?? 0);

export async function openRequestsFor(db: Db, mandateIds: string[], where: { orgId?: string; projectId?: string }) {
  if (!mandateIds.length) return [];
  return db.select().from(docRequests).where(and(inArray(docRequests.mandateId, mandateIds), eq(docRequests.status, "open"),
    where.orgId ? eq(docRequests.orgId, where.orgId) : undefined, where.projectId ? eq(docRequests.projectId, where.projectId) : undefined));
}
