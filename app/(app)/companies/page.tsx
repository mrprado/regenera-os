import { Building2 } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/page";
import { requireOsUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Companies" };

export default async function Page() {
  await requireOsUser("/companies");
  return (
    <>
      <PageHeader title="Companies" actions={<button className="btn" type="button" disabled title="Arrives in phase 1">Import CSV</button>} />
      <EmptyState icon={Building2} title="No companies yet" body="Organizations from Apollo search, imports, the regenera.bio inquiry form and Partner Network referrals, with sector, region, mandate and trigger history." phase={1} />
    </>
  );
}
