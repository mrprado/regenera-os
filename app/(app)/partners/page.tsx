import { Handshake } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/page";
import { requireOsUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Partners" };

export default async function Page() {
  await requireOsUser("/partners");
  return (
    <>
      <PageHeader title="Partners" />
      <EmptyState icon={Handshake} title="No partners yet" body="Partner Network members by tier and geography, their referrals and linked projects." phase={3} />
    </>
  );
}
