import { withBase } from "@/lib/base-path";
import { appDb } from "@/lib/db/scoped";
import { openInvite } from "@/lib/tenancy/engine";
import { USER_TYPES } from "@/lib/tenancy/vocab";

export const dynamic = "force-dynamic";
export const metadata = { title: "Join Regenera OS" };

// Anonymous: an invited OS user (client admin, client user, read-only) sets their password from a one-time link.
export default async function JoinPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { token } = await params;
  const sp = await searchParams;
  const open = await openInvite(appDb(), token);
  return (
    <main style={{ maxWidth: 460, margin: "14vh auto", padding: "0 16px" }}>
      <p className="eyebrow">Regenera OS</p>
      {!open ? (
        <><h1>Invitation not valid</h1><p style={{ color: "var(--text-muted)" }}>This link has expired, was already used or was withdrawn. Ask your administrator for a new one.</p></>
      ) : (
        <>
          <h1>Join {open.tenantName}</h1>
          <p style={{ color: "var(--text-muted)" }}>{open.invite.email} · {USER_TYPES[open.invite.userType].label}. Set a password to continue.</p>
          {sp.error && <p role="alert" style={{ color: "#b0432f" }}>{sp.error}</p>}
          <form method="post" action={withBase("/api/auth/accept")} style={{ display: "grid", gap: 10 }}>
            <input type="hidden" name="token" value={token} />
            <label htmlFor="pw">Password (at least 12 characters, letters and a digit)</label>
            <input id="pw" name="password" type="password" autoComplete="new-password" required minLength={12} maxLength={200} />
            <label htmlFor="pw2">Confirm</label>
            <input id="pw2" name="confirm" type="password" autoComplete="new-password" required minLength={12} maxLength={200} />
            <button className="btn btn--primary" type="submit">Set password</button>
          </form>
        </>
      )}
    </main>
  );
}
