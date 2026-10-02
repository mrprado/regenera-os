"use server";

import { redirect } from "next/navigation";
import { withOsUser } from "@/lib/auth";
import { appDb } from "@/lib/db/scoped";
import { removeDemo, seedDemo } from "@/lib/demo/seed";
import { setTestRecords } from "@/lib/test-records";
import { audit } from "@/lib/audit";

export async function loadDemoAction() {
  let msg = "";
  await withOsUser(async user => { const r = await seedDemo(appDb(), user.email); msg = r.created ? "Demo data loaded into the DEMO entity. Switch entity in the header to focus on it." : "Demo data is already loaded."; }, { owner: true, internal: true });
  redirect(`/settings/demo?notice=${encodeURIComponent(msg)}`);
}

export async function removeDemoAction() {
  await withOsUser(async () => { await removeDemo(appDb()); }, { owner: true, internal: true });
  redirect(`/settings/demo?notice=${encodeURIComponent("Demo data removed.")}`);
}

/** Flags the checked records as test records (owner only): kept, but excluded from metrics and work queues. */
export async function flagTestRecordsAction(formData: FormData) {
  const pick = (k: string) => formData.getAll(k).map(String).filter(v => /^[0-9a-f-]{36}$/i.test(v));
  const on = formData.get("mode") !== "unflag";
  let n = 0;
  await withOsUser(async user => {
    n = await setTestRecords(appDb(), user.scope.mandateIds, { contactIds: pick("contact"), orgIds: pick("org"), dealIds: pick("deal"), replyIds: pick("reply") }, on);
    await audit(appDb(), { actor: user.email, action: on ? "test_records_flagged" : "test_records_unflagged", entity: "test_records", after: { n } });
  }, { owner: true });
  redirect(`/settings/demo?notice=${encodeURIComponent(`${n} record${n === 1 ? "" : "s"} ${on ? "flagged as test records" : "unflagged"}.`)}`);
}
