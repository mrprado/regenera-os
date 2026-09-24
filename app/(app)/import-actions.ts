"use server";

import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { imports } from "@/db/schema";
import { audit } from "@/lib/audit";
import { withOsUser } from "@/lib/auth";
import { appDb, mandateCondition } from "@/lib/db/scoped";
import { IMPORT_FIELDS, parseCsv } from "@/lib/import/csv";
import { importKey, r2Store } from "@/lib/import/process";
import { enqueue } from "@/lib/jobs/queue";

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 20_000;
const back = (notice: string) => `/people/import?notice=${encodeURIComponent(notice)}`;

export async function uploadImport(formData: FormData) {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) redirect(back("Choose a CSV file."));
  if (file.size > MAX_BYTES) redirect(back("The file is larger than 5 MB. Split it and import in parts."));
  let target = "";
  await withOsUser(async user => {
    if (!env.BUCKET) { target = back("File storage (R2) is not available."); return; }
    const [headers, ...rows] = parseCsv(await file.text());
    if (!headers || rows.length === 0) { target = back("The CSV has no data rows."); return; }
    if (rows.length > MAX_ROWS) { target = back(`The CSV has ${rows.length} rows. The limit is ${MAX_ROWS}.`); return; }
    const db = appDb();
    const [imp] = await db.insert(imports).values({
      mandateId: user.scope.ownerOf[0] ?? user.scope.mandateIds[0], kind: "csv", filename: file.name.slice(0, 200),
      totalRows: rows.length, status: "pending", createdBy: user.email,
    }).returning();
    await r2Store(env.BUCKET).put(importKey(imp.id), JSON.stringify({ headers, rows }));
    await audit(db, { actor: user.email, action: "import_upload", entity: "imports", entityId: imp.id, after: { rows: rows.length } });
    target = `/people/import?id=${imp.id}`;
  });
  redirect(target);
}

export async function confirmImport(formData: FormData) {
  const id = z.string().uuid().parse(formData.get("id"));
  const mapping: Record<string, string> = {};
  for (const field of Object.keys(IMPORT_FIELDS)) {
    const v = formData.get(`map_${field}`);
    if (typeof v === "string" && v !== "") mapping[field] = String(Number(v));
  }
  let target = `/people/import?id=${id}`;
  await withOsUser(async user => {
    const db = appDb();
    const [imp] = await db.select().from(imports).where(and(eq(imports.id, id), mandateCondition(user.scope, imports.mandateId)));
    if (!imp || imp.status !== "pending") { target = back("Import not found or already started."); return; }
    if (!mapping.fullName && !mapping.firstName && !mapping.email && !mapping.company) { target = `/people/import?id=${id}&notice=${encodeURIComponent("Map at least a name, email or company column.")}`; return; }
    await db.update(imports).set({ mapping, status: "processing", updatedAt: new Date().toISOString() }).where(eq(imports.id, id));
    await enqueue(db, "import.process", { importId: id, offset: 0 }, { dedupeKey: `import:${id}:0` });
    await audit(db, { actor: user.email, action: "import_start", entity: "imports", entityId: id, after: mapping });
  });
  redirect(target);
}
