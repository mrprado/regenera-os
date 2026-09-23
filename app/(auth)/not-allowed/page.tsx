import { chatGPTSignOutPath } from "@/lib/chatgpt-auth";
import { currentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Not allowed" };

export default async function NotAllowedPage() {
  const user = await currentUser();
  return (
    <main style={{ maxWidth: 560, margin: "18vh auto", padding: "0 16px" }}>
      <p className="eyebrow">Regenera OS</p>
      <h1>This account is not on the allowlist.</h1>
      <p style={{ color: "var(--text-muted)" }}>
        {user ? `Signed in as ${user.email}. ` : ""}Ask the Regenera OS owner to add this email.
      </p>
      <a className="btn" href={chatGPTSignOutPath("/")} target="_top">Sign out</a>
    </main>
  );
}
