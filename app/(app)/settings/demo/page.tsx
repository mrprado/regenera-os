import { eq } from "drizzle-orm";
import { Notice } from "@/components/crm-bits";
import ui from "@/components/ui.module.css";
import { mandates } from "@/db/schema";
import { requireOsOwner } from "@/lib/auth";
import { appDb } from "@/lib/db/scoped";
import { DEMO_MANDATE } from "@/lib/demo/seed";
import { loadDemoAction, removeDemoAction } from "../../demo-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Demo data" };

export default async function DemoPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireOsOwner("/settings/demo");
  const sp = await searchParams;
  const [m] = await appDb().select({ id: mandates.id }).from(mandates).where(eq(mandates.id, DEMO_MANDATE));
  return (
    <>
      <Notice text={sp.notice} />
      <p className={ui.notice}>Demo data lives in a separate entity, &quot;DEMO — Regenera sample data&quot;. Every record is named &quot;DEMO — …&quot;, emails use @example.test, sample Atlas layers say DEMO / SAMPLE DATA, and nothing is presented as live or official data. It includes four projects (Mexico Solar 100 MW with a Yucatán site polygon, Yucatán Eco Park, New Zealand Solar, Africa Energy Project), a family office, a DFI, an EPC, an introducer, an advisor, a developer, capital requirements and mandates, risks, constraints, milestones, tasks, documents, a data room, a referral and sample layers. Mass sending is off for this entity.</p>
      {m ? (
        <form action={removeDemoAction}><button className="btn" type="submit">Remove demo data</button></form>
      ) : (
        <form action={loadDemoAction}><button className="btn btn--primary" type="submit">Load demo data</button></form>
      )}
    </>
  );
}
