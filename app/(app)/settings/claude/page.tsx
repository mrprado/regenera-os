import { desc, eq } from "drizzle-orm";
import ui from "@/components/ui.module.css";
import { mcpClients, mcpTokens } from "@/db/schema";
import { requireOsUser } from "@/lib/auth";
import { outreachConfig } from "@/lib/config";
import { appDb } from "@/lib/db/scoped";
import { issueMcpTokenAction, revokeMcpAction } from "../../mcp-actions";
import TokenReveal from "../extension/token-reveal";

export const dynamic = "force-dynamic";
export const metadata = { title: "Claude" };

export default async function ClaudeSettingsPage() {
  const user = await requireOsUser("/settings/claude");
  const base = outreachConfig().appBaseUrl.replace(/\/$/, "");
  const tokens = await appDb().select({ t: mcpTokens, client: mcpClients.name }).from(mcpTokens).leftJoin(mcpClients, eq(mcpClients.clientId, mcpTokens.clientId))
    .where(eq(mcpTokens.userEmail, user.email.toLowerCase())).orderBy(desc(mcpTokens.createdAt)).limit(50);
  const active = tokens.filter(x => !x.t.revokedAt && x.t.kind !== "refresh" && (!x.t.expiresAt || x.t.expiresAt > new Date().toISOString()));
  return (
    <>
      <TokenReveal />
      <h2 style={{ fontSize: 16, margin: "8px 0 8px" }}>Use Regenera OS from Claude</h2>
      <p style={{ fontSize: 13.5, maxWidth: 700, margin: "0 0 12px" }}>
        Claude can answer questions about your CRM and propose changes, scoped to your mandates. Nothing changes until you confirm, and drafts always go to the approval queue.
      </p>
      <ol style={{ fontSize: 13.5, maxWidth: 700, lineHeight: 1.6, paddingLeft: 20 }}>
        <li><b>claude.ai or Claude Desktop:</b> Settings, Connectors, Add custom connector, with the URL <code>{base}/api/mcp</code>. Claude opens a sign-in page here: approve it.</li>
        <li><b>Claude Code:</b> issue a personal token below, then run <code>claude mcp add --transport http regenera-os {base}/api/mcp --header &quot;Authorization: Bearer &lt;token&gt;&quot;</code>.</li>
      </ol>
      <form action={issueMcpTokenAction} style={{ display: "flex", gap: 8, margin: "12px 0 18px" }}>
        <input name="label" placeholder="Label, e.g. Claude Code laptop" aria-label="Token label" style={{ height: 32, border: "1px solid var(--line)", borderRadius: 8, padding: "0 10px", fontSize: 13, width: 260 }} />
        <button className="btn" type="submit">Issue a personal token</button>
      </form>
      <div className={ui.tableWrap}>
        <table className={ui.table}>
          <thead><tr><th>Access</th><th>Kind</th><th>Issued</th><th>Last used</th><th /></tr></thead>
          <tbody>
            {active.length === 0 && <tr><td colSpan={5} className={ui.sub}>No active connections.</td></tr>}
            {active.map(({ t, client }) => (
              <tr key={t.id}>
                <td>{t.kind === "personal" ? t.label || "Personal token" : client ?? "MCP client"}</td>
                <td>{t.kind === "personal" ? "Personal token" : "Connector (1 hour, renews)"}</td>
                <td>{t.createdAt.slice(0, 16).replace("T", " ")}</td>
                <td>{t.lastUsedAt ? t.lastUsedAt.slice(0, 16).replace("T", " ") : "Never"}</td>
                <td><form action={revokeMcpAction}>
                  {t.kind === "personal" ? <input type="hidden" name="tokenId" value={t.id} /> : <input type="hidden" name="clientId" value={t.clientId ?? ""} />}
                  <button className={ui.miniBtn} type="submit">Revoke</button></form></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
