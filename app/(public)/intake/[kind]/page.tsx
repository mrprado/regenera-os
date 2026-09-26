import { notFound } from "next/navigation";
import styles from "@/components/portal.module.css";
import { withBase } from "@/lib/base-path";
import { INTAKE_KINDS, type IntakeKind } from "@/lib/portal/vocab";

export const dynamic = "force-dynamic";
export const metadata = { title: "Work with Regenera" };

type Field = { name: string; label: string; area?: boolean; required?: boolean; type?: string };
const FIELDS: Record<IntakeKind, { title: string; lede: string; fields: Field[] }> = {
  project: {
    title: "Bring a project to Regenera", lede: "Tell us about the project and where it stands. We reply to every serious submission.",
    fields: [{ name: "projectName", label: "Project name", required: true }, { name: "location", label: "Location (municipality, state)" }, { name: "country", label: "Country" }, { name: "sector", label: "Sector" },
      { name: "stage", label: "Stage (idea, site secured, permitting, ready to build …)" }, { name: "site", label: "Site (area, land control)", area: true }, { name: "capacity", label: "Capacity / size" },
      { name: "capitalNeed", label: "Capital need (amount and type)" }, { name: "documents", label: "Documents you can share (list)", area: true }, { name: "help", label: "How can Regenera help?", area: true }],
  },
  capital: {
    title: "Capital partners", lede: "Describe what you invest in so we only bring you opportunities that fit. Investor qualification is assessed separately, by jurisdiction.",
    fields: [{ name: "type", label: "Type (fund, family office, DFI, bank, foundation …)" }, { name: "jurisdiction", label: "Your jurisdiction" }, { name: "geographies", label: "Geographies" }, { name: "sectors", label: "Sectors" },
      { name: "stages", label: "Project stages" }, { name: "ticket", label: "Ticket size" }, { name: "structures", label: "Structures (equity, debt, blended …)" }, { name: "mandate", label: "Mandate", area: true }],
  },
  broker: {
    title: "Introducers and brokers", lede: "Tell us about your role and network. Registration does not create a commercial relationship; that needs an agreement and a compliance review.",
    fields: [{ name: "role", label: "Role (referral partner, introducer, licensed broker-dealer, placement agent …)" }, { name: "jurisdictions", label: "Jurisdictions where you work (country codes)" }, { name: "licenses", label: "Licences / registrations (if any)" },
      { name: "markets", label: "Markets" }, { name: "network", label: "Network focus", area: true }, { name: "experience", label: "Experience", area: true }, { name: "purpose", label: "What would you like to do with Regenera?", area: true }],
  },
  partner: {
    title: "Project partners", lede: "EPCs, engineers, consultants, technology and conservation partners: tell us what you do and where.",
    fields: [{ name: "services", label: "Services", required: true, area: true }, { name: "technologies", label: "Technologies" }, { name: "regions", label: "Countries / regions" }, { name: "team", label: "Team", area: true },
      { name: "trackRecord", label: "Track record", area: true }, { name: "certifications", label: "Certifications" }],
  },
};

export default async function IntakePage({ params, searchParams }: { params: Promise<{ kind: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { kind } = await params;
  if (!(kind in INTAKE_KINDS)) notFound();
  const sp = await searchParams;
  const f = FIELDS[kind as IntakeKind];
  return (
    <main style={{ maxWidth: 640, margin: "8vh auto", padding: "0 16px 64px" }}>
      <p className="eyebrow">Regenera · Capital aligned with living systems</p>
      <h1>{f.title}</h1>
      {sp.sent ? <p className={styles.notice}>Thank you. Your submission has been received; Regenera will be in touch.</p> : (
        <>
          <p className={styles.muted}>{f.lede}</p>
          {sp.error && <p role="alert" className={styles.warn}>{sp.error === "rate" ? "Too many submissions from this connection. Try again later." : "Please check the required fields."}</p>}
          <form method="post" action={withBase(`/api/intake/${kind}`)} className={styles.form}>
            <div className={styles.grid2}>
              <label>Your name<input name="name" required minLength={2} autoComplete="name" /></label>
              <label>Email<input name="email" type="email" required autoComplete="email" /></label>
              <label>Organization<input name="organization" autoComplete="organization" /></label>
              <label>Phone (optional)<input name="phone" autoComplete="tel" /></label>
            </div>
            {f.fields.map(x => <label key={x.name}>{x.label}{x.area ? <textarea name={x.name} rows={3} required={x.required} /> : <input name={x.name} required={x.required} />}</label>)}
            <label className={styles.hp} aria-hidden="true">Website<input name="website_url" tabIndex={-1} autoComplete="off" /></label>
            <button className="btn btn--primary" type="submit">Submit</button>
            <p className={styles.muted}>We use this information only to respond and, if relevant, to work with you. Please do not send confidential documents here.</p>
          </form>
        </>
      )}
    </main>
  );
}
