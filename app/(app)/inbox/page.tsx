import { requireOsUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Inbox" };

export default async function InboxPage() {
  await requireOsUser("/inbox");
  return (
    <section>
      <p className="eyebrow">Inbox</p>
      <h1>Arrives in phase 2.</h1>
    </section>
  );
}
