"use server";

import { redirect } from "next/navigation";
import { withOsUser } from "@/lib/auth";
import { appDb } from "@/lib/db/scoped";
import { removeDemo, seedDemo } from "@/lib/demo/seed";

export async function loadDemoAction() {
  let msg = "";
  await withOsUser(async user => { const r = await seedDemo(appDb(), user.email); msg = r.created ? "Demo data loaded into the DEMO entity. Switch entity in the header to focus on it." : "Demo data is already loaded."; }, { owner: true });
  redirect(`/settings/demo?notice=${encodeURIComponent(msg)}`);
}

export async function removeDemoAction() {
  await withOsUser(async () => { await removeDemo(appDb()); }, { owner: true });
  redirect(`/settings/demo?notice=${encodeURIComponent("Demo data removed.")}`);
}
