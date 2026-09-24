// Contract downloads (signed-in users only): ?template=<key>, ?all=1 (zip of every template), or ?contract=<id>.
import { getOsApiUser } from "@/lib/auth";
import { safeFileName, templateLibrary, templatesZip, wordDoc } from "@/lib/contracts/export";
import { getContract } from "@/lib/contracts/queries";

const doc = (name: string, html: string) => new Response(html, {
  headers: { "content-type": "application/msword; charset=utf-8", "content-disposition": `attachment; filename="${name}"`, "cache-control": "private, no-store" },
});

export async function GET(request: Request) {
  const user = await getOsApiUser();
  if (!user) return Response.json({ error: "Not authorized" }, { status: 401 });
  const q = new URL(request.url).searchParams;

  if (q.get("all")) {
    return new Response(templatesZip(), {
      headers: { "content-type": "application/zip", "content-disposition": `attachment; filename="Regenera-contract-templates.zip"`, "cache-control": "private, no-store" },
    });
  }
  const templateKey = q.get("template");
  if (templateKey) {
    const t = templateLibrary().find(f => f.key === templateKey);
    return t ? doc(t.fileName, wordDoc(t.name, t.body)) : Response.json({ error: "Unknown template" }, { status: 404 });
  }
  const id = q.get("contract");
  if (id && /^[0-9a-f-]{36}$/i.test(id)) {
    const data = await getContract(user.scope, id);
    if (!data) return Response.json({ error: "Not found" }, { status: 404 });
    return doc(`${safeFileName(data.c.title)}-v${data.c.version}.doc`, wordDoc(data.c.title, data.c.body));
  }
  return Response.json({ error: "Say which file: template, all or contract" }, { status: 400 });
}
