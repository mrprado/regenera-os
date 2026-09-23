import { redirect } from "next/navigation";
import { requireOsUser } from "@/lib/auth";

export default async function SettingsPage() {
  await requireOsUser("/settings");
  redirect("/settings/connections");
}
