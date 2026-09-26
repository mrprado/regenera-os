import { redirect } from "next/navigation";
import { currentPortalUser } from "@/lib/portal/guard";

export const dynamic = "force-dynamic";

export default async function PortalHome() {
  const u = await currentPortalUser();
  redirect(u ? `/portal/${u.kind}` : "/portal/signin");
}
