import { Send } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/page";
import { requireOsUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sequences" };

export default async function Page() {
  await requireOsUser("/sequences");
  return (
    <>
      <PageHeader title="Sequences" />
      <EmptyState icon={Send} title="No sequences yet" body="Multi-step email and LinkedIn sequences per tier and segment, with send windows, domain caps and automatic stop on reply." phase={2} />
    </>
  );
}
