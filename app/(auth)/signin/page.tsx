import { redirect } from "next/navigation";
import { currentEmail } from "@/lib/auth";
import { withBase } from "@/lib/base-path";
import { safeReturnTo } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign in" };

const ERRORS: Record<string, string> = {
  invalid: "Email or password is incorrect.",
  locked: "Too many attempts. Try again in 15 minutes.",
  unavailable: "Sign-in could not reach the password check. Try again shortly.",
};

export default async function SignInPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const returnTo = safeReturnTo(sp.return_to);
  if (await currentEmail()) redirect(returnTo);
  return (
    <main style={{ maxWidth: 400, margin: "18vh auto", padding: "0 16px" }}>
      <p className="eyebrow">Regenera OS</p>
      <h1>Sign in</h1>
      {sp.signed_out && <p style={{ color: "var(--text-muted)" }}>You are signed out.</p>}
      {sp.error && ERRORS[sp.error] && <p role="alert" style={{ color: "#b0432f" }}>{ERRORS[sp.error]}</p>}
      <form method="post" action={withBase("/api/auth/signin")} style={{ display: "grid", gap: 10 }}>
        <input type="hidden" name="return_to" value={returnTo} />
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" autoComplete="username" required autoFocus />
        <label htmlFor="password">Password</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required maxLength={200} />
        <button className="btn btn--primary" type="submit">Sign in</button>
      </form>
    </main>
  );
}
