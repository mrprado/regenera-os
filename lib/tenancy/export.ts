// Client data portability (prompt §57): every workspace-scoped table of an organization as CSV in one ZIP.
// Credentials and token hashes never leave; OWNER-ONLY investor tables are included only for workspace owners.
import { inArray, getTableColumns, getTableName, is } from "drizzle-orm";
import { SQLiteTable } from "drizzle-orm/sqlite-core";
import { strToU8, zipSync } from "fflate";
import type { Db } from "@/db";
import * as schema from "@/db/schema";

const SECRET_COLUMNS = /hash|secret|token|password/i;
const OWNER_ONLY = new Set(["private_capital_profiles", "investor_qualifications", "kyc_checks"]);

/** RFC 4180 with formula-injection guard (a leading = + - @ is quoted with a ' prefix). */
export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  let s = typeof v === "object" ? JSON.stringify(v) : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function exportableTables(): SQLiteTable[] {
  return (Object.values(schema) as unknown[]).filter((x): x is SQLiteTable => is(x, SQLiteTable)).filter(t => "mandateId" in getTableColumns(t));
}

export async function exportWorkspaces(db: Db, workspaceIds: string[], ownerOf: string[], meta: { tenant: string; actor: string; at: string }) {
  const files: Record<string, Uint8Array> = {};
  const manifest: string[] = [`Regenera OS export`, `Organization: ${meta.tenant}`, `Generated: ${meta.at} by ${meta.actor}`, `Workspaces: ${workspaceIds.join(", ")}`, "", "table,rows"];
  for (const t of exportableTables()) {
    const name = getTableName(t);
    const ids = OWNER_ONLY.has(name) ? workspaceIds.filter(w => ownerOf.includes(w)) : workspaceIds;
    if (!ids.length) continue;
    const cols = Object.entries(getTableColumns(t)).filter(([k]) => !SECRET_COLUMNS.test(k));
    const mandateCol = getTableColumns(t).mandateId;
    const rows = await db.select().from(t as never).where(inArray(mandateCol, ids)) as Record<string, unknown>[];
    if (!rows.length) continue;
    const lines = [cols.map(([, c]) => c.name).join(","), ...rows.map(r => cols.map(([k]) => csvCell(r[k])).join(","))];
    files[`${name}.csv`] = strToU8(lines.join("\r\n"));
    manifest.push(`${name},${rows.length}`);
  }
  files["README.txt"] = strToU8(manifest.join("\n") + "\n\nCredentials and token hashes are never exported. Third-party datasets appear as references and remain under their own licences.\n");
  return zipSync(files);
}
