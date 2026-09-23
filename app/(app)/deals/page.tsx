import { SquareKanban } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/page";
import { requireOsUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Deals" };

export default async function Page() {
  await requireOsUser("/deals");
  return (
    <>
      <PageHeader title="Deals" />
      <EmptyState icon={SquareKanban} title="No deals yet" body="The pipeline by stage, imported from the regenera.bio tracker and fed by site inquiries and referrals." phase={1} />
    </>
  );
}
