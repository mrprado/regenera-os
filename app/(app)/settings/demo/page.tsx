import { eq } from "drizzle-orm";
import Link from "next/link";
import { Notice } from "@/components/crm-bits";
import ui from "@/components/ui.module.css";
import { mandates } from "@/db/schema";
import { requireOsOwner } from "@/lib/auth";
import { appDb } from "@/lib/db/scoped";
import { DEMO_MANDATE } from "@/lib/demo/seed";
import { testCandidates } from "@/lib/test-records";
import { flagTestRecordsAction, loadDemoAction, removeDemoAction } from "../../demo-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Demo data" };

export default async function DemoPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireOsOwner("/settings/demo");
  const sp = await searchParams;
  const [m] = await appDb().select({ id: mandates.id }).from(mandates).where(eq(mandates.id, DEMO_MANDATE));
  const c = await testCandidates(appDb(), user.scope.mandateIds.filter(id => id !== DEMO_MANDATE));
  const total = c.people.length + c.orgs.length + c.deals.length + c.replies.length;
  const row = (name: string, value: string, label: string, sub: string, flagged: boolean) => (
    <li key={value} style={{ display: "flex", gap: 8, alignItems: "baseline", padding: "4px 0" }}>
      <input type="checkbox" name={name} value={value} defaultChecked={!flagged} aria-label={`Select ${label}`} />
      <span>{label}<span className={ui.sub} style={{ display: "inline", marginLeft: 6 }}>{sub}{flagged ? " · already flagged" : ""}</span></span>
    </li>
  );
  return (
    <>
      <Notice text={sp.notice} />
      <p className={ui.notice}>Demo data lives in a separate entity, &quot;DEMO — Regenera sample data&quot;. Every record is named &quot;DEMO — …&quot;, emails use @example.test, sample Atlas layers say DEMO / SAMPLE DATA, and nothing is presented as live or official data. It includes four projects (Mexico Solar 100 MW with a Yucatán site polygon, Yucatán Eco Park, New Zealand Solar, Africa Energy Project), a family office, a DFI, an EPC, an introducer, an advisor, a developer, capital requirements and mandates, risks, constraints, milestones, tasks, documents, a data room, a referral and sample layers. Mass sending is off for this entity.</p>
      {m ? (
        <form action={removeDemoAction}><button className="btn" type="submit">Remove demo data</button></form>
      ) : (
        <form action={loadDemoAction}><button className="btn btn--primary" type="submit">Load demo data</button></form>
      )}

      <section style={{ marginTop: 28, borderTop: "1px solid var(--line)", paddingTop: 16 }} aria-labelledby="tests-h">
        <h2 id="tests-h" style={{ fontSize: 15, margin: "0 0 4px" }}>Test records in your workspaces</h2>
        <p className={ui.sub} style={{ marginTop: 0, maxWidth: 820 }}>Records that look like test data by explicit patterns only (example or .test domains, names containing &quot;test&quot; or &quot;demo&quot;). Flagging keeps them in the database but excludes them from Command, landing pages, campaign economics, the approval queue, the inbox and task lists. Flagging a person also flags their replies and tasks. Nothing is deleted. Individual organizations can be flagged from their Identity panel.</p>
        {total === 0 ? <p className={ui.sub}>No test-looking records found.</p> : (
          <form action={flagTestRecordsAction}>
            {c.people.length > 0 && <><p className={ui.sub}><b>People</b></p><ul style={{ listStyle: "none", padding: 0, margin: 0, fontSize: 13 }}>{c.people.map(x => row("contact", x.id, x.name, x.email ?? "", x.flagged))}</ul></>}
            {c.orgs.length > 0 && <><p className={ui.sub}><b>Organizations</b></p><ul style={{ listStyle: "none", padding: 0, margin: 0, fontSize: 13 }}>{c.orgs.map(x => row("org", x.id, x.name, x.domain ?? "", x.flagged))}</ul></>}
            {c.deals.length > 0 && <><p className={ui.sub}><b>Opportunities</b></p><ul style={{ listStyle: "none", padding: 0, margin: 0, fontSize: 13 }}>{c.deals.map(x => row("deal", x.id, x.name, "", x.flagged))}</ul></>}
            {c.replies.length > 0 && <><p className={ui.sub}><b>Inbox replies</b></p><ul style={{ listStyle: "none", padding: 0, margin: 0, fontSize: 13 }}>{c.replies.map(x => row("reply", x.id, x.subject || "(no subject)", x.from, x.flagged))}</ul></>}
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button className="btn btn--primary" name="mode" value="flag" type="submit">Flag selected as test records</button>
              <button className="btn" name="mode" value="unflag" type="submit">Unflag selected</button>
            </div>
          </form>
        )}
        <p className={ui.sub}>Flagged records stay visible on their own pages and in the <Link href="/inbox?tests=1">inbox with tests shown</Link>.</p>
      </section>
    </>
  );
}
