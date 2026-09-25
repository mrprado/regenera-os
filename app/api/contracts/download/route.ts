// Contract downloads as PDF (signed-in users only): ?template=<key>, ?all=1 (zip of every template), or ?contract=<id>.
import { getOsApiUser } from "@/lib/auth";
import { safeFileName, templateLibrary, templatePdf, templatesZip } from "@/lib/contracts/export";
import { CONTRACT_STATUS_LABEL } from "@/lib/contracts/labels";
import { contractPdf } from "@/lib/contracts/pdf";
import { getContract } from "@/lib/contracts/queries";
import { eq } from "drizzle-orm";
import { contractObligations, contractParties } from "@/db/schema";
import { LIFECYCLE, typeLabel } from "@/lib/contracts/catalog";
import { appDb } from "@/lib/db/scoped";

const file = (name: string, bytes: Uint8Array, type = "application/pdf") => new Response(new Uint8Array(bytes), {
  headers: { "content-type": type, "content-disposition": `attachment; filename="${name}"`, "cache-control": "private, no-store" },
});

export async function GET(request: Request) {
  const user = await getOsApiUser();
  if (!user) return Response.json({ error: "Not authorized" }, { status: 401 });
  const q = new URL(request.url).searchParams;
  const today = new Date().toISOString().slice(0, 10);

  if (q.get("all")) return file("Regenera-contract-templates.zip", await templatesZip(today), "application/zip");
  const templateKey = q.get("template");
  if (templateKey) {
    const t = templateLibrary().find(f => f.key === templateKey);
    return t ? file(t.fileName, await templatePdf(t, today)) : Response.json({ error: "Unknown template" }, { status: 404 });
  }
  const id = q.get("contract");
  if (id && /^[0-9a-f-]{36}$/i.test(id)) {
    const data = await getContract(user.scope, id);
    if (!data) return Response.json({ error: "Not found" }, { status: 404 });
    const { c } = data;
    if (c.kind === "registered") {
      // A registered agreement is an abstract of the executed document, never a copy of it.
      const db = appDb();
      const [parties, obligations] = await Promise.all([
        db.select().from(contractParties).where(eq(contractParties.contractId, c.id)),
        db.select().from(contractObligations).where(eq(contractObligations.contractId, c.id)),
      ]);
      const terms = Object.entries(c.keyTerms).filter(([, v]) => v).map(([k, v]) => `**${k.replace(/([A-Z])/g, " $1").replace(/^./, x => x.toUpperCase())}:** ${v}`);
      const md = [
        `# ${c.title}`, "",
        `**Type:** ${typeLabel(c.category, c.contractType)}`, `**Lifecycle:** ${LIFECYCLE[c.lifecycle]}${c.lockedAt ? " (executed, locked)" : ""}`,
        `**Governing law:** ${c.governingLaw ?? "not recorded"}`, `**Forum:** ${c.forum ?? "not recorded"}`,
        `**Executed:** ${c.executionDate ?? "—"}`, `**Effective / expires:** ${c.effectiveDate ?? "—"} / ${c.endDate ?? "—"}`, "",
        "## Summary", c.body || "Not recorded.", "",
        "## Key terms", ...(terms.length ? terms : ["Not recorded."]), "",
        "## Parties", ...(parties.length ? parties.map(p => `- ${p.name} (${p.role.replace(/_/g, " ")})`) : ["Not recorded."]), "",
        "## Obligations", ...(obligations.length ? obligations.map(o => `- ${o.dueDate ?? "no date"}: ${o.obligation} (${o.responsibleParty}${o.sourceClause ? `, clause ${o.sourceClause}` : ""}) - ${o.status}`) : ["Not recorded."]),
      ].join("\n");
      return file(`${safeFileName(c.title)}-abstract.pdf`, await contractPdf(md, { kicker: "Contract abstract (not the executed document)", shortTitle: c.title, status: `${LIFECYCLE[c.lifecycle]}, version ${c.version}`, date: today }));
    }
    const kicker = c.status === "draft" ? "Draft for discussion" : c.status === "sent" ? "Issued for signature" : "Execution version";
    const status = `${CONTRACT_STATUS_LABEL[c.status]}, version ${c.version}${c.signedAt ? `, signed ${c.signedAt}` : ""}`;
    return file(`${safeFileName(c.title)}-v${c.version}.pdf`, await contractPdf(c.body, { kicker, shortTitle: c.title, status, date: today }));
  }
  return Response.json({ error: "Say which file: template, all or contract" }, { status: 400 });
}
