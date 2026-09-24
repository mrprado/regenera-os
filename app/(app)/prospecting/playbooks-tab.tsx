import Link from "next/link";
import { sql } from "drizzle-orm";
import ui from "@/components/ui.module.css";
import { playbookDrafts } from "@/db/schema";
import { appDb, mandateCondition, type Scope } from "@/lib/db/scoped";
import { listPlaybooks, REGIONS } from "@/lib/radar/playbooks";
import styles from "./prospecting.module.css";

const GROUP_LABEL: Record<string, string> = { capital: "Capital partners", corporate: "Corporate", public: "Public sector", channel: "Partner Network (channel)", community: "Community" };
const REGION_LABEL: Record<string, string> = { latam: "Latin America", mena: "Middle East and North Africa", africa: "Sub-Saharan Africa", europe: "Europe", north_america: "North America", asia_pacific: "Asia Pacific" };

export default async function PlaybooksTab({ region, scope }: { region?: string; scope: Scope }) {
  const r = region && REGIONS[region] ? region : undefined;
  const playbooks = await listPlaybooks(appDb(), r);
  const counts = await appDb().select({ segmentId: playbookDrafts.segmentId, n: sql<number>`count(*)` }).from(playbookDrafts).where(mandateCondition(scope, playbookDrafts.mandateId)).groupBy(playbookDrafts.segmentId);
  const groups = [...new Set(playbooks.map(p => p.group))];
  return (
    <>
      <p className={ui.notice}>
        One playbook per segment and partnership type: who to reach, the keywords that match Regenera&apos;s services, one clear message, and the searches.
        LinkedIn and Google open in your browser (sign in to LinkedIn first). Apollo runs automatically and free with Scan now. Save the people you want with the extension or from New people.
      </p>
      <form className={styles.regionBar} action="/prospecting">
        <label htmlFor="region">Region for LinkedIn and Google</label>
        <select id="region" name="region" defaultValue={r ?? ""}>
          <option value="">Any region</option>
          {Object.entries(REGION_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <button className={ui.miniBtn} type="submit">Apply</button>
      </form>
      {groups.map(g => (
        <section key={g} style={{ marginBottom: 22 }}>
          <h2 className={styles.groupTitle}>{GROUP_LABEL[g] ?? g}</h2>
          <div className={styles.cards}>
            {playbooks.filter(p => p.group === g).map(p => {
              const templates = counts.find(c => c.segmentId === p.segmentId)?.n ?? 0;
              return (
                <article key={p.key} className={styles.card} style={{ opacity: p.enabled ? 1 : 0.6 }}>
                  <header>
                    <Link className={styles.cardTitle} href={`/prospecting/playbooks/${p.key}${r ? `?region=${r}` : ""}`}>{p.name}</Link>
                    {!p.enabled && <span className={ui.chip}>disabled segment</span>}
                  </header>
                  <p className={styles.oneLiner}>{p.message.oneLiner}</p>
                  <p className={styles.meta}><b>Who:</b> {p.who.titles.slice(0, 4).join(", ")}</p>
                  <p className={styles.meta}><b>Keywords:</b> {p.keywords.topics.slice(0, 5).join(", ")}</p>
                  <div className={styles.links}>
                    <a href={p.searches.linkedinPeople} target="_blank" rel="noreferrer">LinkedIn people</a>
                    <a href={p.searches.linkedinCompanies} target="_blank" rel="noreferrer">LinkedIn companies</a>
                    <a href={p.searches.googlePeople} target="_blank" rel="noreferrer">Google people</a>
                    <a href={p.searches.googleCompanies} target="_blank" rel="noreferrer">Google companies</a>
                  </div>
                  <p className={styles.meta}>{templates ? `${templates} message templates` : "No message templates yet"} · <Link href={`/prospecting/playbooks/${p.key}${r ? `?region=${r}` : ""}`}>Open playbook</Link></p>
                </article>
              );
            })}
          </div>
        </section>
      ))}
    </>
  );
}
