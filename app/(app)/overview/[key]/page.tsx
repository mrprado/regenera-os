import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page";
import r from "@/components/record.module.css";
import ui from "@/components/ui.module.css";
import { requireOsUser } from "@/lib/auth";
import { appDb } from "@/lib/db/scoped";
import { HUB_KEYS, hubData, type HubKey } from "@/lib/hubs";
import { navFor } from "@/lib/nav";
import { isInternal } from "@/lib/db/scoped";
import h from "./overview.module.css";

export const dynamic = "force-dynamic";

/** Landing page of a main navigation group (phase 15 §5). */
export default async function OverviewPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  if (!(HUB_KEYS as readonly string[]).includes(key)) notFound();
  const user = await requireOsUser(`/overview/${key}`);
  const hub = await hubData(appDb(), key as HubKey, user.scope.mandateIds);
  const group = navFor({ modules: user.scope.modules, internal: isInternal(user.scope) }).find(g => g.key === key);
  return (
    <>
      <PageHeader title={hub.title} actions={<div className={h.actions}>{hub.actions.map((a, i) => <Link key={a.href} className={i === 0 ? "btn btn--primary" : "btn"} href={a.href}>{a.label}</Link>)}</div>} />
      <p className={h.purpose}>{hub.purpose}</p>
      <section className={h.metrics} aria-label={`${hub.title} metrics`}>
        {hub.metrics.map(m => (
          <div key={m.label} className={h.metric}>
            <Link href={m.href} className={h.value}>{m.value}</Link>
            <span className={h.label}>{m.label}</span>
            <details className={h.def}><summary>Definition</summary><p>{m.def}</p></details>
          </div>
        ))}
      </section>
      {hub.empty && <p className={ui.notice}>{hub.empty}</p>}
      <div className={r.grid}>
        <div>
          <section className={r.panel} aria-labelledby="att-h">
            <p className={r.panelTitle}><span id="att-h">Needs attention</span></p>
            {hub.attention.length === 0 ? <p className={r.empty}>Nothing flagged here.</p> : (
              <ul className={r.timeline}>{hub.attention.map(a => <li key={a.href + a.label}><span className={r.when}>Attention</span><span><Link href={a.href}>{a.label}</Link>{a.sub && <span className={ui.sub}>{a.sub}</span>}</span></li>)}</ul>
            )}
          </section>
          {hub.recent.length > 0 && (
            <section className={r.panel} aria-labelledby="rec-h">
              <p className={r.panelTitle}><span id="rec-h">{hub.recentTitle}</span></p>
              <ul className={r.timeline}>{hub.recent.map(x => <li key={x.href + x.label}><span className={r.when} /><span><Link href={x.href}>{x.label}</Link>{x.sub && <span className={ui.sub}>{x.sub}</span>}</span></li>)}</ul>
            </section>
          )}
        </div>
        <aside>
          {group && group.sections.length > 0 && (
            <section className={r.panel} aria-labelledby="tools-h">
              <p className={r.panelTitle}><span id="tools-h">Tools in {hub.title}</span></p>
              {group.sections.map((s, i) => (
                <div key={i} className={h.tools}>{s.label && <p className={h.toolsLabel}>{s.label}</p>}
                  <ul>{s.items.map(it => <li key={it.href + it.label}><Link href={it.href}>{it.label}</Link></li>)}</ul></div>
              ))}
            </section>
          )}
        </aside>
      </div>
    </>
  );
}
