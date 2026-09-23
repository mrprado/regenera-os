import { ChartColumn } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/page";
import { requireOsUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Reports" };

export default async function Page() {
  await requireOsUser("/reports");
  return (
    <>
      <PageHeader title="Reports" />
      <EmptyState icon={ChartColumn} title="No data yet" body="Reply, meeting and diagnostic rates by segment, angle and tier, with the weekly summary." phase={3} />
    </>
  );
}
