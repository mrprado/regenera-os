import { Radar } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/page";
import { requireOsUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Triggers" };

export default async function Page() {
  await requireOsUser("/triggers");
  return (
    <>
      <PageHeader title="Triggers" />
      <EmptyState icon={Radar} title="No triggers yet" body="A live feed of events that create a decision: fund launches, closure plans, tenders, new appointments. Pursue, watch or dismiss each one." phase={3} />
    </>
  );
}
