import type { Db } from "@/db";
import { auditLog } from "@/db/schema";

export async function audit(db: Db, entry: {
  actor: string;
  action: string;
  entity?: string;
  entityId?: string;
  before?: unknown;
  after?: unknown;
}) {
  await db.insert(auditLog).values({
    actor: entry.actor,
    action: entry.action,
    entity: entry.entity ?? "",
    entityId: entry.entityId ?? "",
    before: entry.before ?? null,
    after: entry.after ?? null,
  });
}
