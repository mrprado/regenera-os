import { requireOsUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Triggers" };

export default async function TriggersPage() {
  await requireOsUser("/triggers");
  return (
    <section>
      <p className="eyebrow">Triggers</p>
      <h1>Arrives in phase 3.</h1>
    </section>
  );
}
