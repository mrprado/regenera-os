import { ListChecks } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/page";
import { requireOsUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Lists" };

export default async function Page() {
  await requireOsUser("/lists");
  return (
    <>
      <PageHeader title="Lists" />
      <EmptyState icon={ListChecks} title="No lists yet" body="Saved lists and saved searches, like Apollo lists: group people or companies by segment, event or campaign and act on them in bulk." phase={1} />
    </>
  );
}
