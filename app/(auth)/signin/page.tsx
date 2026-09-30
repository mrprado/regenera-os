import { redirect } from "next/navigation";
import { FieldMotif } from "@/components/field-motif";
import { currentEmail } from "@/lib/auth";
import { withBase } from "@/lib/base-path";
import { safeReturnTo } from "@/lib/session";
import s from "../auth.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign in" };

const ERRORS: Record<string, string> = {
  invalid: "Email or password is incorrect.",
  setup: "Sign-in is not set up yet: no email is allowed (OS_ALLOWLIST).",
  unavailable: "Sign-in could not reach the password check. Try again shortly.",
};

export default async function SignInPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const returnTo = safeReturnTo(sp.return_to);
  if (await currentEmail()) redirect(returnTo);
  return (
    <main className={s.split}>
      <section className={s.visual} aria-hidden>
        <FieldMotif className={s.motif} />
        <span className={s.mark}>REGENERA</span>
        <div className={s.statement}>
          <h2>Systems intelligence for complex assets.</h2>
          <p>Land, infrastructure, development, nature and capital in one decision and execution environment.</p>
        </div>
      </section>
      <section className={s.form}>
        <p className="eyebrow">Regenera OS</p>
        <h1>Sign in</h1>
        <p className={s.lede}>Use the email your workspace was set up with.</p>
        {sp.joined && <p className={s.msg}>Your password is set. Sign in to continue.</p>}
        {sp.signed_out && <p className={s.msg}>You are signed out.</p>}
        {sp.error && ERRORS[sp.error] && <p role="alert" className={s.err}>{ERRORS[sp.error]}</p>}
        <form method="post" action={withBase("/api/auth/signin")} className={s.fields}>
          <input type="hidden" name="return_to" value={returnTo} />
          <label htmlFor="email">Email</label>
          <input id="email" name="email" type="email" autoComplete="username" required autoFocus />
          <label htmlFor="password">Password</label>
          <input id="password" name="password" type="password" autoComplete="current-password" required maxLength={200} />
          <button className="btn btn--primary" type="submit">Sign in</button>
        </form>
        <p className={s.foot}>Private system. Access is by invitation; activity is logged.</p>
      </section>
    </main>
  );
}
