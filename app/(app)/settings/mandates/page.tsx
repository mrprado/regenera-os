import { Notice } from "@/components/crm-bits";
import ui from "@/components/ui.module.css";
import { requireOsUser } from "@/lib/auth";
import { appDb } from "@/lib/db/scoped";
import { isMandateAdmin, mandateAdminList } from "@/lib/mandates";
import { counselAction, createMandateAction, memberAction, updateMandateAction } from "../../mandate-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Entities" };

const input = { height: 32, border: "1px solid var(--line)", borderRadius: 8, padding: "0 9px", fontSize: 13, width: "100%" } as const;

export default async function MandatesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireOsUser("/settings/mandates");
  const sp = await searchParams;
  if (!isMandateAdmin(user.scope)) {
    return <p className={ui.notice}>Only owners of the Regenera mandate manage mandates. You belong to {(user.scope.memberOf ?? user.scope.mandateIds).length} mandate(s).</p>;
  }
  const list = await mandateAdminList(appDb());
  return (
    <>
      <Notice text={sp.notice} />
      <p style={{ fontSize: 13.5, maxWidth: 720, margin: "4px 0 16px" }}>
        Each mandate is a separate book of business. People only see the records of mandates they are members of, so managing a mandate here
        does not show you its data. Investment mandates are manual and relationship-only: no mass tier, no sequences, and no sending until counsel has confirmed the outreach rules.
      </p>
      {list.map(m => (
        <section key={m.id} className={ui.tableWrap} style={{ padding: 14, marginBottom: 16 }}>
          <div className={ui.toolbar}>
            <h2 style={{ margin: 0, fontSize: 17 }}>{m.name} <span className={`${ui.chip} ${m.type === "investment" ? ui.chipPollen : ui.chipReed}`}>{m.type}</span></h2>
            {m.type === "investment" && (
              m.counselConfirmedAt ? (
                <form action={counselAction}><input type="hidden" name="id" value={m.id} />
                  <span className={ui.sub} style={{ display: "inline", marginRight: 8 }}>Counsel confirmed {m.counselConfirmedAt.slice(0, 10)} by {m.counselConfirmedBy}</span>
                  <button className={ui.miniBtn} name="confirm" value="0" type="submit">Withdraw</button></form>
              ) : (
                <form action={counselAction}><input type="hidden" name="id" value={m.id} />
                  <span className={ui.sub} style={{ display: "inline", marginRight: 8, color: "#b0432f" }}>Sending off: counsel has not confirmed</span>
                  <button className={ui.miniBtn} name="confirm" value="1" type="submit">Record counsel confirmation</button></form>
              )
            )}
          </div>
          <form action={updateMandateAction} style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 10, alignItems: "end", margin: "8px 0 14px" }}>
            <input type="hidden" name="id" value={m.id} />
            <label style={{ fontSize: 11.5, fontWeight: 600, color: "var(--text-muted)" }}>Sending identity (name and mailbox)
              <input name="sendingIdentity" defaultValue={m.sendingIdentity} placeholder="Decided later" style={input} /></label>
            <label style={{ fontSize: 11.5, fontWeight: 600, color: "var(--text-muted)" }}>Fee terms
              <input name="feeTerms" defaultValue={m.feeTerms} placeholder="Decided later" style={input} /></label>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              {m.type !== "investment" && <label style={{ fontSize: 13 }}><input type="checkbox" name="massAllowed" defaultChecked={m.rules.massAllowed} /> Mass tier</label>}
              <button className={ui.miniBtn} type="submit">Save</button>
            </div>
          </form>
          <table className={ui.table}>
            <thead><tr><th>Member</th><th>Role</th><th /></tr></thead>
            <tbody>
              {m.members.length === 0 && <tr><td colSpan={3} className={ui.sub}>No members yet. Add people when you decide who works this mandate.</td></tr>}
              {m.members.map(x => (
                <tr key={x.id}><td>{x.email}</td><td>{x.role}</td><td>
                  <form action={memberAction}><input type="hidden" name="id" value={m.id} /><input type="hidden" name="email" value={x.email} /><input type="hidden" name="op" value="remove" />
                    <button className={ui.miniBtn} type="submit">Remove</button></form>
                </td></tr>
              ))}
            </tbody>
          </table>
          <form action={memberAction} style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center" }}>
            <input type="hidden" name="id" value={m.id} /><input type="hidden" name="op" value="add" />
            <input name="email" type="email" required placeholder="name@company.com" aria-label="Member email" style={{ ...input, maxWidth: 280 }} />
            <select name="role" aria-label="Role" defaultValue="member" style={{ ...input, width: 120 }}><option value="member">Member</option><option value="owner">Owner</option></select>
            <button className={ui.miniBtn} type="submit">Add member</button>
          </form>
        </section>
      ))}
      <form action={createMandateAction} style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
        <input name="name" required placeholder="New mandate name" aria-label="New mandate name" style={{ ...input, maxWidth: 280 }} />
        <select name="type" aria-label="Type" defaultValue="investment" style={{ ...input, width: 150 }}><option value="investment">Investment</option><option value="advisory">Advisory</option><option value="development">Development</option></select>
        <button className="btn" type="submit">Create mandate</button>
      </form>
    </>
  );
}
