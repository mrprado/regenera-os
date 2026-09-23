import { House } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/page";
import { requireOsUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Home" };

export default async function HomePage() {
  const user = await requireOsUser("/today");
  const first = user.displayName.split(/[\s@]/)[0];
  return (
    <>
      <PageHeader title={`Good to see you, ${first}`} />
      <EmptyState
        icon={House}
        title="Your day starts here"
        body="Approvals waiting, replies to handle, meetings with briefs, overdue next actions, new site inquiries and the top new triggers."
        phase={1}
      />
    </>
  );
}
