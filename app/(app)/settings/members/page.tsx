import { requireOsUser } from "@/lib/auth";
import { isOwner } from "@/lib/db/scoped";
import { listMembers } from "@/lib/settings";
import { addMember, removeMember } from "../actions";
import styles from "../settings.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Members" };

export default async function MembersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireOsUser("/settings/members");
  const params = await searchParams;
  const members = await listMembers(user.scope);
  const owner = isOwner(user.scope);

  return (
    <>
      <h2>Members</h2>
      <p style={{ color: "var(--text-muted)", maxWidth: 640 }}>
        Access is by mandate. A member signs in with Sign in with ChatGPT using this email and only sees that mandate&apos;s records.
      </p>
      {params.added && <p className={`${styles.notice} ${styles.noticeOk}`}>Member added.</p>}
      {params.error && <p className={styles.notice}>Enter a valid email address.</p>}
      {owner && (
        <form action={addMember} className={styles.form}>
          <input type="email" name="email" placeholder="name@example.com" required aria-label="Email to add" />
          <button className="btn btn--primary" type="submit">Add member</button>
        </form>
      )}
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead><tr><th>Email</th><th>Mandate</th><th>Role</th><th>Signed in</th><th /></tr></thead>
          <tbody>
            {members.map(m => (
              <tr key={m.id}>
                <td>{m.email}</td>
                <td>{m.mandate}</td>
                <td><span className={`${styles.pill} ${m.role === "owner" ? styles.pillOk : ""}`}>{m.role}</span></td>
                <td>{m.bound ? "Yes" : "Not yet"}</td>
                <td>
                  {owner && m.role !== "owner" && (
                    <form action={removeMember}><input type="hidden" name="id" value={m.id} /><button className={styles.linkButton} type="submit">Remove</button></form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
