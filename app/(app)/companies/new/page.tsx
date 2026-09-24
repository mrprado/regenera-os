import { PageHeader } from "@/components/page";
import r from "@/components/record.module.css";
import { requireOsUser } from "@/lib/auth";
import { addOrganization } from "../../crm-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Add company" };

export default async function NewCompanyPage() {
  await requireOsUser("/companies/new");
  return (
    <>
      <PageHeader title="Add company" />
      <form action={addOrganization} className={`${r.panel} ${r.form}`} style={{ maxWidth: 640 }}>
        <label>Name<input name="name" required minLength={2} /></label>
        <div className={r.formRow} style={{ marginTop: 10 }}>
          <label>Website<input name="website" placeholder="example.com" /></label>
          <label>Location<input name="location" placeholder="City, country" /></label>
        </div>
        <p className={r.why}>Identity (Wikidata, GLEIF, SEC) and map placement are filled from free public sources after saving. Duplicates are merged by domain.</p>
        <button className="btn btn--primary" type="submit">Save company</button>
      </form>
    </>
  );
}
