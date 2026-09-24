import { desc, eq } from "drizzle-orm";
import ui from "@/components/ui.module.css";
import { extensionTokens } from "@/db/schema";
import { requireOsUser } from "@/lib/auth";
import { appDb } from "@/lib/db/scoped";
import { issueExtensionTokenAction, revokeExtensionTokenAction } from "../../radar-actions";
import TokenReveal from "./token-reveal";

export const dynamic = "force-dynamic";
export const metadata = { title: "Extension" };

export default async function ExtensionSettingsPage() {
  const user = await requireOsUser("/settings/extension");
  // Tokens are per user: each person only sees and revokes their own.
  const tokens = await appDb().select().from(extensionTokens).where(eq(extensionTokens.userEmail, user.email.toLowerCase())).orderBy(desc(extensionTokens.createdAt));
  return (
    <>
      <TokenReveal />
      <h2 style={{ fontSize: 16, margin: "8px 0 8px" }}>LinkedIn extension</h2>
      <p style={{ fontSize: 13.5, maxWidth: 680, margin: "0 0 12px" }}>
        The extension works only on the LinkedIn profile you have open, and only when you click it. It reads the visible profile into Regenera OS,
        shows the queued note with a Copy button, and records it as sent when you click Mark sent. It never clicks, sends or browses on LinkedIn for you.
      </p>
      <ol style={{ fontSize: 13.5, maxWidth: 680, margin: "0 0 18px", paddingLeft: 20, lineHeight: 1.6 }}>
        <li>In Chrome open <code>chrome://extensions</code> and turn on Developer mode.</li>
        <li>Click Load unpacked and choose the <code>extension</code> folder of the regenera-os repository.</li>
        <li>Issue a token below and paste it into the extension&apos;s Connect screen, with the OS address.</li>
        <li>Pin the extension. On a profile, click it to open the side panel.</li>
      </ol>
      <form action={issueExtensionTokenAction} style={{ marginBottom: 18 }}><button className="btn btn--primary" type="submit">Issue a token</button></form>
      {tokens.length > 0 && (
        <div className={ui.tableWrap}>
          <table className={ui.table}>
            <thead><tr><th>Token</th><th>Issued</th><th>Last used</th><th>Status</th><th /></tr></thead>
            <tbody>
              {tokens.map(t => (
                <tr key={t.id}>
                  <td>{t.label}</td>
                  <td>{t.createdAt.slice(0, 16).replace("T", " ")}</td>
                  <td>{t.lastUsedAt ? t.lastUsedAt.slice(0, 16).replace("T", " ") : "Never"}</td>
                  <td>{t.revokedAt ? <span className={`${ui.chip} ${ui.chipMuted}`}>Revoked</span> : <span className={`${ui.chip} ${ui.chipReed}`}>Active</span>}</td>
                  <td>{!t.revokedAt && <form action={revokeExtensionTokenAction}><input type="hidden" name="id" value={t.id} /><button className={ui.miniBtn} type="submit">Revoke</button></form>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
