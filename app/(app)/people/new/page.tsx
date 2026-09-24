import { PageHeader } from "@/components/page";
import r from "@/components/record.module.css";
import { requireOsUser } from "@/lib/auth";
import { addPerson } from "../../crm-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Add person" };

export default async function NewPersonPage() {
  await requireOsUser("/people/new");
  return (
    <>
      <PageHeader title="Add person" />
      <form action={addPerson} className={`${r.panel} ${r.form}`} style={{ maxWidth: 640 }}>
        <label>Full name<input name="fullName" required minLength={2} /></label>
        <div className={r.formRow} style={{ marginTop: 10 }}>
          <label>Title<input name="title" /></label>
          <label>Organization<input name="org" /></label>
        </div>
        <label style={{ marginTop: 10 }}>Email<input name="email" type="email" /></label>
        <p className={r.why}>A manually entered email is marked unverified until Apollo or you confirm it. Duplicates are merged by email, LinkedIn URL, or name at the same organization.</p>
        <button className="btn btn--primary" type="submit">Save person</button>
      </form>
    </>
  );
}
