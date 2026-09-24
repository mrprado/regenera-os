import { redirect } from "next/navigation";
import { requireOsUser } from "@/lib/auth";

// Moved to /prospecting (phase 4). Kept so old links keep working.
export default async function SearchesRedirect() {
  await requireOsUser("/prospecting");
  redirect("/prospecting");
}
