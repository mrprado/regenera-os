import { PageHeader } from "@/components/page";
import ui from "@/components/ui.module.css";
import { requireOsUser } from "@/lib/auth";
import { appDb } from "@/lib/db/scoped";
import { getClient, zAuthorize } from "@/lib/mcp/oauth";
import { approveMcpAction } from "../../mcp-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Connect Claude" };

/** OAuth consent for the MCP server. Reached from claude.ai (or another MCP client) when connecting Regenera OS. */
export default async function ConnectMcpPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const qs = new URLSearchParams(Object.entries(sp).filter(([, v]) => v !== undefined) as [string, string][]).toString();
  const user = await requireOsUser(`/connect/mcp${qs ? `?${qs}` : ""}`);
  const parsed = zAuthorize.safeParse(sp);
  const client = parsed.success ? await getClient(appDb(), parsed.data.client_id) : null;
  if (!parsed.success || !client || !client.redirectUris.includes(parsed.data.redirect_uri)) {
    return (<><PageHeader title="Connect Claude" /><p className={ui.notice}>This connection request is not valid (unknown client, wrong redirect URI, or missing PKCE). Start again from Claude.</p></>);
  }
  const p = parsed.data;
  const hidden = (["response_type", "client_id", "redirect_uri", "code_challenge", "code_challenge_method", "state"] as const)
    .map(k => p[k] !== undefined ? <input key={k} type="hidden" name={k} value={p[k]} /> : null);
  return (
    <>
      <PageHeader title="Connect Claude to Regenera OS" />
      <section className={ui.tableWrap} style={{ padding: 18, maxWidth: 620 }}>
        <p style={{ margin: "0 0 10px", fontSize: 15 }}><b>{client.name}</b> wants to use Regenera OS as <b>{user.email}</b>.</p>
        <ul style={{ fontSize: 13.5, lineHeight: 1.6, margin: "0 0 12px", paddingLeft: 18 }}>
          <li>It can read people, companies, deals, triggers, replies and reports in your mandates only.</li>
          <li>It can propose changes. Nothing changes until you confirm, in Claude or on the OS Home screen.</li>
          <li>It never sends email: drafts go to the approval queue.</li>
          <li>Access lasts until you revoke it in Settings, Claude.</li>
        </ul>
        <p className={ui.sub}>Returns to {new URL(p.redirect_uri).host}</p>
        <form action={approveMcpAction} style={{ display: "flex", gap: 8, marginTop: 12 }}>
          {hidden}
          <button className="btn btn--primary" type="submit" name="decision" value="allow">Allow</button>
          <button className="btn" type="submit" name="decision" value="deny">Deny</button>
        </form>
      </section>
    </>
  );
}
