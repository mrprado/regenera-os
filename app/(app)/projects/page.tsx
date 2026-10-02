import Link from "next/link";
import { StageOptions } from "@/components/stage-options";
import { Landmark } from "lucide-react";
import { Notice, withParams } from "@/components/crm-bits";
import FilterForm from "@/components/filter-form";
import { EmptyState, PageHeader } from "@/components/page";
import r from "@/components/record.module.css";
import ui from "@/components/ui.module.css";
import { requireOsUser } from "@/lib/auth";
import { compactMoney, STAGE_GROUPS, stageLabel } from "@/lib/projects/labels";
import { listProjects, projectPickers } from "@/lib/projects/queries";
import { ASSET_CLASSES, REGENERA_ROLES } from "@/lib/projects/vocab";
import { SECTORS } from "@/lib/vocab";
import { createProjectAction, createProjectFromDealAction } from "../project-actions";
import styles from "./projects.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Projects" };

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireOsUser("/projects");
  const sp = await searchParams;
  const view = sp.view === "board" ? "board" : "table";
  const [rows, pickers] = await Promise.all([listProjects(user.scope, sp), projectPickers(user.scope)]);

  const capitalCell = (c: { currency: string; target: number; secured: number }[]) =>
    c.length === 0 ? <span className={ui.chipMuted}>Not set</span> : c.map(x => (
      <span key={x.currency} style={{ display: "block" }}>{compactMoney(x.target, x.currency)}
        {x.target > x.secured && <span className={ui.sub}>gap {compactMoney(x.target - x.secured, x.currency)}</span>}</span>
    ));

  return (
    <>
      <PageHeader title="Projects" count={rows.length} />
      <Notice text={sp.notice} />
      <nav className={ui.tabs} aria-label="Project views">
        <Link className={`${ui.tab} ${view === "table" ? ui.tabActive : ""}`} href={withParams("/projects", sp, { view: undefined, notice: undefined })}>Table</Link>
        <Link className={`${ui.tab} ${view === "board" ? ui.tabActive : ""}`} href={withParams("/projects", sp, { view: "board", notice: undefined })}>Pipeline</Link>
      </nav>
      <div className={ui.workspace}>
        <div>
        <FilterForm action="/projects" className={ui.filters}>
          <p className={ui.filtersTitle}>Filters</p>
          {view === "board" && <input type="hidden" name="view" value="board" />}
          <div className={ui.field}><label htmlFor="q">Search</label><input id="q" name="q" defaultValue={sp.q} placeholder="Name or description" /></div>
          <div className={ui.field}><label htmlFor="stage">Stage</label>
            <select id="stage" name="stage" defaultValue={sp.stage ?? ""}><option value="">Any stage</option><StageOptions /></select></div>
          <div className={ui.field}><label htmlFor="sector">Sector</label>
            <select id="sector" name="sector" defaultValue={sp.sector ?? ""}><option value="">Any sector</option>{Object.entries(SECTORS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
          <div className={ui.field}><label htmlFor="country">Country</label><input id="country" name="country" defaultValue={sp.country} placeholder="e.g. Mexico" /></div>
          <div className={ui.field}><label htmlFor="blocked">Blocked</label>
            <select id="blocked" name="blocked" defaultValue={sp.blocked ?? ""}><option value="">Any</option><option value="1">Blocked or high-severity constraint</option></select></div>
          <div className={ui.field}><label htmlFor="capital">Capital</label>
            <select id="capital" name="capital" defaultValue={sp.capital ?? ""}><option value="">Any</option><option value="1">Still needs capital</option></select></div>
          <div className={ui.filterActions}><button className="btn" type="submit">Apply</button><Link className={ui.clear} href="/projects">Clear</Link></div>
        </FilterForm>
          <section className={r.panel} style={{ marginTop: 14 }}>
            <p className={r.panelTitle}>New project</p>
            <form action={createProjectAction} className={styles.stack}>
              {user.scope.mandateIds.length > 1 && <input type="hidden" name="mandateId" value={user.scope.mandateIds[0]} />}
              <label>Name<input name="name" required minLength={2} placeholder="e.g. Tulum 40 MW solar + storage" /></label>
              <label>Asset class<select name="assetClass" defaultValue=""><option value="">Choose</option>{Object.entries(ASSET_CLASSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
              <label>Sector<select name="sector" defaultValue=""><option value="">Choose</option>{Object.entries(SECTORS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
              <label>Country<input name="country" placeholder="e.g. Mexico" /></label>
              <label>Stage<select name="stage" defaultValue="opportunity"><StageOptions /></select></label>
              <label>Regenera role<select name="regeneraRole" defaultValue=""><option value="">Not set</option>{Object.entries(REGENERA_ROLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
              <button className="btn btn--primary" type="submit">Create project</button>
            </form>
          </section>
          {pickers.openDeals.length > 0 && (
            <section className={r.panel} style={{ marginTop: 14 }}>
              <p className={r.panelTitle}>From an opportunity</p>
              <form action={createProjectFromDealAction} className={styles.stack}>
                <select name="dealId" required defaultValue="" aria-label="Opportunity"><option value="" disabled>Choose an opportunity</option>{pickers.openDeals.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
                <button className="btn" type="submit">Create and link</button>
              </form>
              <p className={ui.sub}>The opportunity stays in Opportunities (Regenera&apos;s commercial pipeline) and links to the new project.</p>
            </section>
          )}
        </div>

        <div>
          {rows.length === 0 ? (
            <EmptyState icon={Landmark} title="No projects yet" body="A project is the physical asset: where it is, who sponsors it, how ready it is, what blocks it and what capital it needs. Create one, or turn an opportunity into one." />
          ) : view === "board" ? (
            <div className={styles.board}>
              {STAGE_GROUPS.map(g => {
                const items = rows.filter(x => g.stages.includes(x.p.stage));
                return (
                  <div key={g.key} className={styles.col}>
                    <p className={styles.colTitle}><span>{g.label}</span><span>{items.length}</span></p>
                    {items.map(({ p, blocked, worstSeverity, sponsor }) => (
                      <Link key={p.id} href={`/projects/${p.id}`} className={styles.card}>
                        <b>{p.name}</b>
                        <span>{stageLabel(p.stage)}{p.country ? ` · ${p.country}` : ""}</span>
                        {sponsor && <span>{sponsor}</span>}
                        {(blocked > 0 || worstSeverity >= 3) && <span className={styles.flag}>Blocked or high-severity constraint</span>}
                      </Link>
                    ))}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className={ui.tableWrap}>
              <table className={ui.table}>
                <thead><tr><th>Project</th><th>Stage</th><th>Sponsor</th><th>Blockers</th><th>Capital</th><th>Regenera role</th></tr></thead>
                <tbody>{rows.map(({ p, openConstraints, worstSeverity, blocked, capital, sponsor }) => (
                  <tr key={p.id}>
                    <td><Link className={ui.primary} href={`/projects/${p.id}`}>{p.name}</Link>
                      <span className={ui.sub}>{[p.assetClass ? ASSET_CLASSES[p.assetClass] : null, p.capacity ? `${p.capacity} ${p.capacityUnit ?? ""}`.trim() : null, [p.municipality, p.country].filter(Boolean).join(", ") || null].filter(Boolean).join(" · ")}</span></td>
                    <td><span className={ui.chip}>{stageLabel(p.stage)}</span></td>
                    <td>{sponsor ?? <span className={ui.chipMuted}>Unknown</span>}</td>
                    <td>{blocked || openConstraints ? <span className={worstSeverity >= 3 || blocked ? styles.flag : undefined}>{blocked ? `${blocked} blocked · ` : ""}{openConstraints} open</span> : <span className={ui.chipMuted}>None recorded</span>}</td>
                    <td>{capitalCell(capital)}</td>
                    <td>{p.regeneraRole ? REGENERA_ROLES[p.regeneraRole] : "—"}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </div>

      </div>
    </>
  );
}
