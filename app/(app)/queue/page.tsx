import { requireOsUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Approval queue" };

export default async function ApprovalqueuePage() {
  await requireOsUser("/queue");
  return (
    <section>
      <p className="eyebrow">Approval queue</p>
      <h1>Arrives in phase 2.</h1>
    </section>
  );
}
