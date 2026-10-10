import { desc, eq } from "drizzle-orm";
import { stewardDrafts } from "@/db/schema";
import { appDb } from "@/lib/db/scoped";
import type { DraftContent } from "@/lib/steward/drafts";
import { draftAssessmentAction, reviewDraftAction } from "../../actions";
import s from "../../steward.module.css";

const STATUS: Record<string, string> = { draft: "Draft, not reviewed", reviewed: "Reviewed", rejected: "Rejected", invalidated: "Invalidated" };

/** AI place assessment drafts (phase 28D): facts cite evidence ids, interpretations are labelled, a person reviews. */
export default async function DraftsPanel({ placeId }: { placeId: string }) {
  const drafts = await appDb().select().from(stewardDrafts).where(eq(stewardDrafts.placeId, placeId)).orderBy(desc(stewardDrafts.createdAt)).limit(5);
  return (
    <section className={s.card} id="drafts" style={{ marginTop: 16 }}>
      <h2>AI assessment drafts<span>{drafts.length}</span></h2>
      <p className={s.empty}>The analyst reads only this place&apos;s records you can see and governed knowledge whose custodians allowed AI summarisation. Every fact cites evidence; nothing becomes a finding until a person reviews it.</p>
      <form action={draftAssessmentAction}><input type="hidden" name="placeId" value={placeId} /><button className="btn" type="submit">Draft assessment</button></form>
      {drafts.map(d => {
        const c = d.content as DraftContent & { droppedForUnknownEvidence?: string[] };
        return (
          <article key={d.id} style={{ marginTop: 16 }}>
            <h3><span className={s.state} data-s={d.status === "reviewed" ? "available" : d.status === "draft" ? "unverified" : "failed"}>{STATUS[d.status]}</span> {d.createdAt.slice(0, 16).replace("T", " ")} · {d.createdBy}{d.reviewedBy ? ` · ${d.status} by ${d.reviewedBy}` : ""}</h3>
            {d.invalidatedReason && <p className={s.empty}>Invalidated: {d.invalidatedReason}</p>}
            <h4>Facts</h4><ul>{(c.facts ?? []).map((f, i) => <li key={i}>{f.statement}<span>{f.evidence.join(", ")}</span></li>)}</ul>
            {!!c.interpretations?.length && <><h4>Interpretations (not facts)</h4><ul>{c.interpretations.map((x, i) => <li key={i}>{x.statement}<span>Would confirm: {x.wouldConfirm}</span></li>)}</ul></>}
            {!!c.gaps?.length && <><h4>Gaps</h4><ul>{c.gaps.map((g, i) => <li key={i}>{g}</li>)}</ul></>}
            {c.nextAction && <p><strong>Suggested next action:</strong> {c.nextAction}</p>}
            {!!c.droppedForUnknownEvidence?.length && <p className={s.empty}>Dropped facts citing unknown evidence: {c.droppedForUnknownEvidence.join(", ")}</p>}
            {d.status === "draft" && <div style={{ display: "flex", gap: 8 }}>
              <form action={reviewDraftAction}><input type="hidden" name="draftId" value={d.id} /><input type="hidden" name="decision" value="reviewed" /><button className="btn" type="submit">Mark reviewed</button></form>
              <form action={reviewDraftAction}><input type="hidden" name="draftId" value={d.id} /><input type="hidden" name="decision" value="rejected" /><button className="btn" type="submit">Reject</button></form>
            </div>}
          </article>
        );
      })}
    </section>
  );
}
