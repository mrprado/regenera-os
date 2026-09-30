import Link from "next/link";
import { currentUser } from "@/lib/auth";
import { withBase } from "@/lib/base-path";
import { MODULES } from "@/lib/tenancy/vocab";

export const dynamic = "force-dynamic";
export const metadata = { title: "Not allowed" };

export default async function NotAllowedPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await currentUser();
  const sp = await searchParams;
  const mod = sp.module && sp.module in MODULES ? MODULES[sp.module as keyof typeof MODULES] : null;
  return (
    <main style={{ maxWidth: 560, margin: "18vh auto", padding: "0 16px" }}>
      <p className="eyebrow">Regenera OS</p>
      {mod ? (
        <>
          <h1>{mod} is not part of your workspace.</h1>
          <p style={{ color: "var(--text-muted)" }}>Your organization&apos;s plan or your administrator does not include this module. Ask your administrator, or request it from Support.</p>
          <p><Link className="btn" href="/today">Back to Command</Link></p>
        </>
      ) : (
        <>
          <h1>This account has no access.</h1>
          <p style={{ color: "var(--text-muted)" }}>
            {user ? `Signed in as ${user.email}. ` : ""}The account is not a member of any workspace, was deactivated, or its organization is suspended. Ask your administrator.
          </p>
        </>
      )}
      <form method="post" action={withBase("/api/auth/signout")}><button className="btn" type="submit">Sign out</button></form>
    </main>
  );
}
