import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq, inArray, ne, notInArray } from "drizzle-orm";
import { Notice } from "@/components/crm-bits";
import { PageHeader } from "@/components/page";
import r from "@/components/record.module.css";
import ui from "@/components/ui.module.css";
import { applicationTasks, engagements, fundingApplications, fundingOpportunities } from "@/db/schema";
import { requireOsUser } from "@/lib/auth";
import { appDb, isInternal, mandateCondition } from "@/lib/db/scoped";
import { addDays, capacityWarnings, hiringGuidance, mondayOf, weekCapacity } from "@/lib/funding/origination";
import { capacityData } from "@/lib/funding/pipeline";
import { DELEGABLE, EMPLOYMENT, FOUNDER_FOCUS, RATE_GUIDANCE, TEAM_ROLES } from "@/lib/funding/vocab";
import { deleteAllocationAction, saveAllocationAction, saveTeamMemberAction } from "../funding-origination-actions";
import f from "../funding/funding.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Capacity" };

export default async function CapacityPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireOsUser("/capacity");
  if (!isInternal(user.scope)) notFound();
  const sp = await searchParams;
  const tab = sp.tab === "team" ? "team" : sp.tab === "plan" ? "plan" : "overview";
  const today = new Date().toISOString().slice(0, 10);
  const start = mondayOf(today);
  const weeks = Array.from({ length: 8 }, (_, i) => addDays(start, i * 7));
  const past = Array.from({ length: 13 }, (_, i) => addDays(start, -(13 - i) * 7));
  const [{ members, allocs }, hist, apps, engs, founderTasks] = await Promise.all([
    capacityData(appDb(), user.scope.mandateIds, weeks),
    capacityData(appDb(), user.scope.mandateIds, past),
    appDb().select({ id: fundingApplications.id, name: fundingApplications.name, deadline: fundingOpportunities.deadline }).from(fundingApplications).innerJoin(fundingOpportunities, eq(fundingOpportunities.id, fundingApplications.opportunityId))
      .where(and(mandateCondition(user.scope, fundingApplications.mandateId), notInArray(fundingApplications.state, ["submitted", "awarded", "unsuccessful", "withdrawn"]))),
    appDb().select({ id: engagements.id, name: engagements.name }).from(engagements).where(and(mandateCondition(user.scope, engagements.mandateId), inArray(engagements.status, ["contracting", "active", "waiting_on_client"]))).orderBy(asc(engagements.name)),
    appDb().select({ title: applicationTasks.title, owner: applicationTasks.owner, applicationId: applicationTasks.applicationId }).from(applicationTasks)
      .where(and(mandateCondition(user.scope, applicationTasks.mandateId), ne(applicationTasks.status, "done"), inArray(applicationTasks.title, ["Letters of support / commitment", "Compliance checklist", "Final QA", "Submission", "Applicant research", "Program interpretation"]))),
  ]);
  const warnings = capacityWarnings(members, allocs, weeks, apps.filter(a => a.deadline).map(a => ({ date: a.deadline!, label: a.name })));
  const leads = members.filter(m => m.role === "lead").map(m => (m.email ?? m.name).toLowerCase());
  const founderLoad = founderTasks.filter(t => t.owner && leads.includes(t.owner.toLowerCase()));
  const staffed = members.some(m => ["proposal_manager", "analyst", "operations"].includes(m.role));
  const upcoming = [...allocs].sort((a, b) => a.weekStart.localeCompare(b.weekStart));
  const nameOf = new Map(members.map(m => [m.id, m.name]));
  return (
    <>
      <PageHeader title="Capacity" actions={<Link className="btn" href="/funding?tab=bids">Active bids</Link>} />
      <Notice text={sp.notice} />
      <nav className={ui.tabs} aria-label="Capacity views">
        <Link className={`${ui.tab} ${tab === "overview" ? ui.tabActive : ""}`} href="/capacity">Utilization</Link>
        <Link className={`${ui.tab} ${tab === "plan" ? ui.tabActive : ""}`} href="/capacity?tab=plan">Allocations</Link>
        <Link className={`${ui.tab} ${tab === "team" ? ui.tabActive : ""}`} href="/capacity?tab=team">Team &amp; cost rates</Link>
        <Link className={ui.tab} href="/specialists">Specialist bench</Link>
      </nav>

      {tab === "overview" && <>
        {members.length === 0 ? <p className={ui.notice}>No team yet. Add core, fractional and contractor people with weekly hours, a utilization target and a loaded cost rate under Team &amp; cost rates.</p> : (
          <div className={ui.tableWrap}>
            <table className={ui.table}>
              <thead><tr><th>Person</th><th>Role</th>{weeks.map(w => <th key={w} className={ui.num}>{w.slice(5)}</th>)}<th>Next capacity</th><th>Sustained (13 wk)</th></tr></thead>
              <tbody>{members.map(m => {
                const cs = weeks.map(w => weekCapacity(m, allocs, w));
                const next = cs.find(c => c.free >= 8);
                const h = hiringGuidance(past.map(w => weekCapacity(m, hist.allocs, w).utilizationPct).filter(u => u < 900));
                return (
                  <tr key={m.id}>
                    <td>{m.name}<span className={ui.sub}>{EMPLOYMENT[m.employment as keyof typeof EMPLOYMENT]} · {m.weeklyHours} h/wk · target {m.utilizationTarget}%</span></td>
                    <td>{TEAM_ROLES[m.role as keyof typeof TEAM_ROLES]}</td>
                    {cs.map(c => <td key={c.week} className={`${ui.num} ${c.utilizationPct > m.utilizationTarget ? f.warn : ""}`} title={`${c.allocated} of ${c.available} h (client ${c.client}, internal ${c.internal})`}>{c.available === 0 && c.allocated === 0 ? "leave" : `${Math.round(c.utilizationPct)}%`}</td>)}
                    <td>{next ? `${next.week.slice(5)} · ${next.free} h free` : "None in 8 weeks"}</td>
                    <td className={ui.sub}>{h.avg != null ? `${h.avg}% · ${h.guidance}` : h.guidance}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        )}
        <div className={r.grid} style={{ marginTop: 16 }}>
          <section className={r.panel}>
            <p className={r.panelTitle}>Delivery capacity warnings</p>
            {warnings.length === 0 ? <p className={r.empty}>No one above target, no role saturated and no deadline cluster in the next 8 weeks.</p> : <ul className={r.timeline}>{warnings.map(w => <li key={w.key}><span className={r.when} style={{ color: w.severity === "high" ? "var(--critical)" : undefined }}>{w.week.slice(5)}</span><span>{w.issue}</span></li>)}</ul>}
            <p className={ui.sub}>The OS warns; it never accepts or declines work. Hiring guidance: under 30% sustained, contract; 30–60%, fractional or retainer; above 60% for about 3 months, consider full-time. Guidance, not an HR action.</p>
          </section>
          <section className={r.panel}>
            <p className={r.panelTitle}>Founder role protection</p>
            <p className={ui.sub} style={{ marginTop: 0 }}>Founder focus: {FOUNDER_FOCUS.join(", ")}. Delegate {DELEGABLE.join(", ")} where staff exists.</p>
            {founderLoad.length === 0 ? <p className={r.empty}>No coordination items assigned to the founder / engagement lead.</p> : (
              <><p className={f.warn} style={{ fontSize: 13 }}>{founderLoad.length} production-coordination item(s) sit with the founder{staffed ? " although coordination staff exists" : ""}:</p>
                <ul>{founderLoad.slice(0, 10).map((t, i) => <li key={i}><Link href={`/funding/applications/${t.applicationId}?tab=workplan`}>{t.title}</Link></li>)}</ul></>
            )}
          </section>
        </div>
      </>}

      {tab === "plan" && (
        <>
          <section className={r.panel}>
            <p className={r.panelTitle}>Allocate hours</p>
            {members.length === 0 ? <p className={r.empty}>Add team members first.</p> : (
              <form action={saveAllocationAction} className={f.inline}>
                <input type="hidden" name="back" value="/capacity?tab=plan" />
                <select name="memberId" aria-label="Person">{members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
                <input type="date" name="week" required aria-label="Week" defaultValue={start} />
                <input name="hours" placeholder="Hours / week" aria-label="Hours" style={{ width: 100 }} />
                <input name="weeks" placeholder="Weeks" aria-label="Weeks" defaultValue="1" style={{ width: 60 }} />
                <select name="kind" aria-label="Kind"><option value="client">Client work</option><option value="internal">Internal</option><option value="leave">Leave</option></select>
                <select name="engagementId" aria-label="Engagement"><option value="">No engagement</option>{engs.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select>
                <select name="applicationId" aria-label="Application"><option value="">No application</option>{apps.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
                <input name="note" placeholder="Note" aria-label="Note" />
                <button className="btn btn--primary" type="submit">Allocate</button>
              </form>
            )}
          </section>
          <section className={r.panel}>
            <p className={r.panelTitle}>Next 8 weeks ({upcoming.length})</p>
            {upcoming.length === 0 ? <p className={r.empty}>Nothing allocated.</p> : (
              <table className={ui.table}><thead><tr><th>Week</th><th>Person</th><th className={ui.num}>Hours</th><th>Kind</th><th>For</th><th /></tr></thead>
                <tbody>{upcoming.map(a => <tr key={a.id}><td>{a.weekStart}</td><td>{nameOf.get(a.memberId)}</td><td className={ui.num}>{a.hours}</td><td>{a.kind}</td>
                  <td>{a.applicationId ? <Link href={`/funding/applications/${a.applicationId}`}>{apps.find(x => x.id === a.applicationId)?.name ?? "Application"}</Link> : a.engagementId ? <Link href={`/commercial/engagements/${a.engagementId}`}>{engs.find(x => x.id === a.engagementId)?.name ?? "Engagement"}</Link> : a.note || "—"}</td>
                  <td><form action={deleteAllocationAction}><input type="hidden" name="id" value={a.id} /><input type="hidden" name="back" value="/capacity?tab=plan" /><button className={ui.miniBtn} type="submit">Remove</button></form></td></tr>)}</tbody></table>
            )}
          </section>
        </>
      )}

      {tab === "team" && (
        <>
          <p className={ui.notice}>Loaded cost rates per person drive engagement cost and margin. Planning guidance per hour (not defaults): {Object.entries(RATE_GUIDANCE).map(([k, v]) => `${TEAM_ROLES[k as keyof typeof TEAM_ROLES]} ${v[0]}–${v[1]}`).join(" · ")}. Internal only.</p>
          <div className={ui.tableWrap}>
            <table className={ui.table}>
              <thead><tr><th>Person</th><th>Role · model</th><th className={ui.num}>Cost / hr</th><th className={ui.num}>Salary</th><th className={ui.num}>h / week</th><th className={ui.num}>Target</th><th>Leave</th><th /></tr></thead>
              <tbody>{members.map(m => (
                <tr key={m.id}><td colSpan={8}>
                  <form action={saveTeamMemberAction} className={f.inline}>
                    <input type="hidden" name="id" value={m.id} />
                    <input name="name" defaultValue={m.name} aria-label="Name" style={{ width: 150 }} />
                    <input name="email" defaultValue={m.email ?? ""} placeholder="email" aria-label="Email" style={{ width: 170 }} />
                    <select name="role" defaultValue={m.role} aria-label="Role">{Object.entries(TEAM_ROLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                    <select name="employment" defaultValue={m.employment} aria-label="Model">{Object.entries(EMPLOYMENT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                    <input name="costRate" defaultValue={m.costRate ?? ""} placeholder="cost/hr" aria-label="Cost rate" style={{ width: 70 }} />
                    <input name="salary" defaultValue={m.salary ?? ""} placeholder="salary" aria-label="Salary" style={{ width: 90 }} />
                    <input name="weeklyHours" defaultValue={m.weeklyHours} aria-label="Weekly hours" style={{ width: 50 }} />
                    <input name="utilizationTarget" defaultValue={m.utilizationTarget} aria-label="Target" style={{ width: 50 }} />
                    <input type="date" name="leaveFrom" aria-label="Leave from" /><input type="date" name="leaveTo" aria-label="Leave to" />
                    <span className={ui.sub}>{m.leave.map(l => `${l.from}→${l.to}`).join(", ")}</span>
                    <button className={ui.miniBtn} type="submit">Save</button>
                  </form>
                </td></tr>
              ))}</tbody>
            </table>
          </div>
          <section className={r.panel} style={{ marginTop: 14 }}>
            <p className={r.panelTitle}>Add a person</p>
            <form action={saveTeamMemberAction} className={f.grid3}>
              <label>Name<input name="name" required /></label><label>Email<input name="email" type="email" /></label>
              <label>Role<select name="role">{Object.entries(TEAM_ROLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
              <label>Model<select name="employment">{Object.entries(EMPLOYMENT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
              <label>Loaded cost / hour<input name="costRate" inputMode="decimal" /></label><label>Annual salary (staffing model)<input name="salary" inputMode="decimal" /></label>
              <label>Weekly hours<input name="weeklyHours" defaultValue="40" /></label><label>Utilization target %<input name="utilizationTarget" defaultValue="75" /></label>
              <div><button className="btn btn--primary" type="submit">Add</button></div>
            </form>
          </section>
        </>
      )}
    </>
  );
}
