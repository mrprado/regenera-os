import { headers } from "next/headers";
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
  advisory: {
    title: "Advisory enquiry", lede: "Tell us what you are trying to decide or achieve. We reply to every serious enquiry, usually with a short call to understand the need.",
    fields: [{ name: "need", label: "What do you need help with?", area: true, required: true }, { name: "sector", label: "Sector (energy, land, agriculture, water, built environment …)" }, { name: "geography", label: "Where" },
      { name: "decision", label: "The decision or outcome this supports", area: true }, { name: "timing", label: "Timing" }, { name: "budget", label: "Budget or budget process (if known)" }],
  },
  ai_implementation: {
    title: "AI intelligence systems", lede: "Describe the problem, who would use the system and what data or tools it would need to work with.",
    fields: [{ name: "problem", label: "Problem to solve", area: true, required: true }, { name: "users", label: "Who would use it" }, { name: "systems", label: "Current systems and tools", area: true },
      { name: "data", label: "Data available (and any restrictions)", area: true }, { name: "timing", label: "Timing" }, { name: "budget", label: "Budget or budget process (if known)" }],
  },
  referral: {
    title: "Refer someone to Regenera", lede: "Introduce a person or organization who could work with Regenera. Please only refer people who are happy to be contacted.",
    fields: [{ name: "referredName", label: "Their name", required: true }, { name: "referredOrganization", label: "Their organization" }, { name: "referredEmail", label: "Their email (if they agreed to share it)", type: "email" },
      { name: "context", label: "Why they could work with Regenera", area: true, required: true }],
  },
};
const UTM = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"] as const;

export default async function IntakePage({ params, searchParams }: { params: Promise<{ kind: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { kind } = await params;
  if (!(kind in INTAKE_KINDS)) notFound();
  const sp = await searchParams;
  const f = FIELDS[kind as IntakeKind];
  // Where the visitor came from: campaign tags on the link and the page that sent them (only what the browser sends).
  const h = await headers();
  const referrer = (h.get("referer") ?? "").slice(0, 300);
  const landing = `/intake/${kind}`;
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
            {f.fields.map(x => <label key={x.name}>{x.label}{x.area ? <textarea name={x.name} rows={3} required={x.required} /> : <input name={x.name} type={x.type} required={x.required} />}</label>)}
            {kind === "referral" && <label><span><input type="checkbox" name="referredAware" value="yes" /> They know I am referring them</span></label>}
            <label>How did you hear about Regenera? (optional)<input name="heard" maxLength={200} /></label>
            <fieldset style={{ border: 0, padding: 0 }}><legend>How may we use your details?</legend>
              <label><span><input type="radio" name="consent" value="respond" defaultChecked /> Only to respond to this enquiry</span></label>
              <label><span><input type="radio" name="consent" value="updates" /> Respond, and send occasional updates</span></label>
            </fieldset>
            {UTM.map(k => sp[k] ? <input key={k} type="hidden" name={k} value={String(sp[k]).slice(0, 200)} /> : null)}
            <input type="hidden" name="landing" value={landing} />{referrer && <input type="hidden" name="referrer" value={referrer} />}
            <label className={styles.hp} aria-hidden="true">Website<input name="website_url" tabIndex={-1} autoComplete="off" /></label>
            <button className="btn btn--primary" type="submit">Submit</button>
            <p className={styles.muted}>We use this information only to respond and, if relevant, to work with you. Please do not send confidential documents here.</p>
          </form>
        </>
      )}
    </main>
  );
}
