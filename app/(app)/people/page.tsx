import { Users } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/page";
import { requireOsUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "People" };

export default async function Page() {
  await requireOsUser("/people");
  return (
    <>
      <PageHeader title="People" actions={<button className="btn" type="button" disabled title="Arrives in phase 1">Import CSV</button>} />
      <EmptyState icon={Users} title="No people yet" body="Search Apollo for net-new people by title, seniority, location and company, or import a CSV. Saved people get a sourced dossier, a score and an engagement match." phase={1} />
    </>
  );
}
