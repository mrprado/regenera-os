import Link from "next/link";
import { Send } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/page";
import ui from "@/components/ui.module.css";
import { requireOsUser } from "@/lib/auth";
import { isOwner } from "@/lib/db/scoped";
import { sequenceOverview } from "@/lib/outreach/queries";
import { toggleSequenceAction } from "../outreach-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sequences" };

const CHANNEL: Record<string, string> = { email: "Email", linkedin_connect: "LinkedIn note (assisted)", linkedin_message: "LinkedIn message (assisted)" };
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");

export default async function Page() {
  const user = await requireOsUser("/sequences");
  const seqs = await sequenceOverview(user.scope);
  const owner = isOwner(user.scope);
  if (!seqs.length) {
    return (<><PageHeader title="Sequences" /><EmptyState icon={Send} title="No sequences yet" body="The default mass and targeted sequences are created on the next job tick." /></>);
  }
  return (
    <>
      <PageHeader title="Sequences" count={seqs.length} actions={<Link className="btn" href="/people">Enroll from People</Link>} />
      <p className={ui.notice}>Sends go out only after approval, inside the recipient&apos;s local window (Tue to Thu 08:30 to 11:30 and 14:00 to 16:30, Mon and Fri 09:30 to 11:30), within daily caps. Any reply or a booked meeting stops every sequence at that organization.</p>
      {seqs.map(s => {
        const e = s.enrollments;
        const running = (e.active ?? 0) + (e.drafting ?? 0);
        return (
          <section key={s.id} className={ui.tableWrap} style={{ marginBottom: 18 }}>
            <div className={ui.toolbar} style={{ padding: "12px 14px 0" }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 17 }}>{s.name} <span className={`${ui.chip} ${s.tier === "mass" ? ui.chipWater : ui.chipReed}`}>{s.tier}</span>{!s.active && <span className={`${ui.chip} ${ui.chipEmber}`} style={{ marginLeft: 6 }}>paused</span>}</h2>
                <span className={ui.sub}>{running} running · {e.paused ?? 0} paused · {e.completed ?? 0} completed · {e.stopped ?? 0} stopped (replied, booked, bounced or unsubscribed)</span>
              </div>
              {owner && (
                <form action={toggleSequenceAction}>
                  <input type="hidden" name="id" value={s.id} />
                  <button className={ui.miniBtn} type="submit">{s.active ? "Pause" : "Resume"}</button>
                </form>
              )}
            </div>
            <table className={ui.table}>
              <thead><tr><th>Step</th><th>Day</th><th>Channel</th><th>Purpose</th><th>Angle</th><th className={ui.num}>Waiting</th><th className={ui.num}>Sent</th><th className={ui.num}>Replies</th><th className={ui.num}>Reply rate</th></tr></thead>
              <tbody>
                {s.steps.flatMap(st => {
                  const angles = st.angles.length ? st.angles : [{ angle: null, sent: 0, pending: 0, replies: 0 }];
                  return angles.map((a, j) => (
                    <tr key={`${st.index}-${a.angle ?? j}`}>
                      <td>{j === 0 ? st.index + 1 : ""}</td>
                      <td>{j === 0 ? `D${st.day}` : ""}</td>
                      <td>{j === 0 ? CHANNEL[st.channel] : ""}</td>
                      <td className={ui.wrap}>{j === 0 ? st.purpose : ""}</td>
                      <td>{a.angle ? <span className={ui.chip}>{a.angle}</span> : <span className={ui.chipMuted}>—</span>}</td>
                      <td className={ui.num}>{a.pending}</td>
                      <td className={ui.num}>{a.sent}</td>
                      <td className={ui.num}>{a.replies}</td>
                      <td className={ui.num}>{pct(a.replies, a.sent)}</td>
                    </tr>
                  ));
                })}
              </tbody>
            </table>
          </section>
        );
      })}
    </>
  );
}
