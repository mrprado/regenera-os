import { requireOsUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Pipeline" };

export default async function PipelinePage() {
  await requireOsUser("/pipeline");
  return (
    <section>
      <p className="eyebrow">Pipeline</p>
      <h1>Arrives in phase 1.</h1>
    </section>
  );
}
