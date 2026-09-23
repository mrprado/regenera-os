import { ClipboardCheck } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/page";
import { requireOsUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Approval queue" };

export default async function Page() {
  await requireOsUser("/queue");
  return (
    <>
      <PageHeader title="Approval queue" />
      <EmptyState icon={ClipboardCheck} title="Nothing to review" body="Every drafted message waits here for review. Approve, edit, regenerate the angle or skip, with the dossier beside each draft." phase={2} />
    </>
  );
}
