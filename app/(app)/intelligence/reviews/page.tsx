import Link from "next/link";
import { inArray } from "drizzle-orm";
import { Notice } from "@/components/crm-bits";
import { PageHeader } from "@/components/page";
import r from "@/components/record.module.css";
import ui from "@/components/ui.module.css";
import { contacts, organizations } from "@/db/schema";
import { requireOsUser } from "@/lib/auth";
import { appDb } from "@/lib/db/scoped";
import { pendingReviews } from "@/lib/lifecycle/reviews";
import { fieldReviewAction } from "../../lifecycle-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Data conflicts" };

/** Conflicting values from ingestion (phase 29E): the held value is kept until a person decides. */
export default async function ReviewsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireOsUser("/intelligence/reviews");
  const sp = await searchParams;
  const db = appDb();
  const rows = await pendingReviews(db, user.scope.mandateIds);
  const oIds = rows.filter(x => x.entityType === "organization").map(x => x.entityId), cIds = rows.filter(x => x.entityType === "contact").map(x => x.entityId);
  const [os, cs] = await Promise.all([
    oIds.length ? db.select({ id: organizations.id, name: organizations.name }).from(organizations).where(inArray(organizations.id, oIds.slice(0, 90))) : Promise.resolve([]),
    cIds.length ? db.select({ id: contacts.id, name: contacts.fullName }).from(contacts).where(inArray(contacts.id, cIds.slice(0, 90))) : Promise.resolve([]),
  ]);
  const name = new Map([...os, ...cs].map(x => [x.id, x.name]));
  return (
    <>
      <PageHeader title="Data conflicts" />
      <Notice text={sp.notice} />
      <p className={ui.sub} style={{ marginTop: -4 }}>When a source disagrees with a value already on a record, the OS keeps the current value and lists the disagreement here with both sources. Accepting writes the new value with its source and your name; keeping leaves the record as it is.</p>
      <section className={r.panel}>
        {rows.length === 0 ? <p className={r.empty}>No conflicts waiting.</p> : (
          <div className={ui.tableWrap}><table className={ui.table}>
            <thead><tr><th>Record</th><th>Field</th><th>Current value</th><th>Proposed value</th><th /></tr></thead>
            <tbody>{rows.map(x => (
              <tr key={x.id}>
                <td><Link href={`${x.entityType === "organization" ? "/companies" : "/people"}/${x.entityId}`}>{name.get(x.entityId) ?? x.entityType}</Link></td>
                <td>{x.field}</td>
                <td>{x.currentValue}<span className={ui.sub}>{x.currentSource}</span></td>
                <td>{x.proposedValue}<span className={ui.sub}>{x.source}{x.confidence ? ` · ${x.confidence} confidence` : ""} · {x.retrievedAt.slice(0, 10)}{x.sourceUrl ? <> · <a href={x.sourceUrl} target="_blank" rel="noreferrer">source</a></> : null}</span></td>
                <td>
                  <form action={fieldReviewAction} style={{ display: "inline" }}><input type="hidden" name="reviewId" value={x.id} /><input type="hidden" name="decision" value="accepted" /><button className={ui.miniBtn} type="submit">Accept proposed</button></form>{" "}
                  <form action={fieldReviewAction} style={{ display: "inline" }}><input type="hidden" name="reviewId" value={x.id} /><input type="hidden" name="decision" value="rejected" /><button className={ui.miniBtn} type="submit">Keep current</button></form>
                </td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </section>
    </>
  );
}
