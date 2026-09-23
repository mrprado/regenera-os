import { requireOsUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Reports" };

export default async function ReportsPage() {
  await requireOsUser("/reports");
  return (
    <section>
      <p className="eyebrow">Reports</p>
      <h1>Arrives in phase 3.</h1>
    </section>
  );
}
