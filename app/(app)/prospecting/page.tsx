import { requireOsUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Prospecting" };

export default async function ProspectingPage() {
  await requireOsUser("/prospecting");
  return (
    <section>
      <p className="eyebrow">Prospecting</p>
      <h1>Arrives in phase 1.</h1>
    </section>
  );
}
