import { and, eq } from "drizzle-orm";
import { generatedDocuments } from "@/db/schema";
import { audit } from "@/lib/audit";
import { getOsApiUser } from "@/lib/auth";
import { appDb, mandateCondition } from "@/lib/db/scoped";
import { renderDocument } from "@/lib/documents/engine";

// Guarded: a generated document as branded PDF or DOCX (legal drafts carry the counsel-review watermark). Downloads are audited.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getOsApiUser();
  if (!user) return new Response("Not authorized", { status: 401 });
  const { id } = await params;
  const [d] = await appDb().select().from(generatedDocuments).where(and(eq(generatedDocuments.id, id), mandateCondition(user.scope, generatedDocuments.mandateId)));
  if (!d) return new Response("Not found", { status: 404 });
  const format = new URL(request.url).searchParams.get("format") === "docx" ? "docx" : "pdf";
  const bytes = await renderDocument(d, format);
  await audit(appDb(), { actor: user.email, action: "generated_document_download", entity: "generated_documents", entityId: d.id, after: { format } });
  const name = `${d.title.replace(/[^\w\s-]/g, "").replace(/[\s-]+/g, "-").slice(0, 80)}-v${d.version}.${format}`;
  return new Response(bytes as BodyInit, { headers: {
    "content-type": format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "content-disposition": `attachment; filename="${name}"`, "cache-control": "no-store",
  } });
}
