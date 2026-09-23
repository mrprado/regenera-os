import { requireOsUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Partners" };

export default async function PartnersPage() {
  await requireOsUser("/partners");
  return (
    <section>
      <p className="eyebrow">Partners</p>
      <h1>Arrives in phase 3.</h1>
    </section>
  );
}
