import { Inbox } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/page";
import { requireOsUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Inbox" };

export default async function Page() {
  await requireOsUser("/inbox");
  return (
    <>
      <PageHeader title="Inbox" />
      <EmptyState icon={Inbox} title="No replies yet" body="Replies classified by intent, with a suggested response and the dossier alongside." phase={2} />
    </>
  );
}
