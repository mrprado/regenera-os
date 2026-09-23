import { SquareCheckBig } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/page";
import { requireOsUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Tasks" };

export default async function Page() {
  await requireOsUser("/tasks");
  return (
    <>
      <PageHeader title="Tasks" />
      <EmptyState icon={SquareCheckBig} title="No tasks due" body="Calls, LinkedIn steps, follow-ups and next actions due today, like Apollo tasks." phase={2} />
    </>
  );
}
