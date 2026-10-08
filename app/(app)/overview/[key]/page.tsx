import Link from "next/link";
import WorkflowGuide from "@/components/workflow-guide";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page";
import r from "@/components/record.module.css";
import ui from "@/components/ui.module.css";
import { requireOsUser } from "@/lib/auth";
import { appDb } from "@/lib/db/scoped";
import { HUB_KEYS, hubData, type HubKey } from "@/lib/hubs";
import { LOOP_HUB_KEYS, LOOP_STEPS, loopHub, type LoopHubKey } from "@/lib/hubs-loop";
import { navFor } from "@/lib/nav";
import { isInternal } from "@/lib/db/scoped";
import h from "./overview.module.css";

export const dynamic = "force-dynamic";

/** Landing page of a main navigation group (phase 15 §5; phase 24: loop position first, then what to do next). */
export default async function OverviewPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const loop = (LOOP_HUB_KEYS as readonly string[]).includes(key);
  if (!loop && !(HUB_KEYS as readonly string[]).includes(key)) notFound();
  const user = await requireOsUser(`/overview/${key}`);
  const hub = loop ? await loopHub(appDb(), key as LoopHubKey, user.scope.mandateIds) : await hubData(appDb(), key as HubKey, user.scope.mandateIds);
  const groups = navFor({ modules: user.scope.modules, internal: isInternal(user.scope), owner: user.scope.ownerOf.length > 0 });
  const group = groups.find(g => g.key === key);
  const inLoop = LOOP_STEPS.some(s => s.key === key);
  const visible = LOOP_STEPS.filter(s => groups.some(g => g.key === s.key));
  return (
    <>
      <PageHeader title={group?.label ?? hub.title} actions={<div className={h.actions}>{hub.actions.map((a, i) => <Link key={a.href} className={i === 0 ? "btn btn--primary" : "btn"} href={a.href}>{a.label}</Link>)}</div>} />
      {inLoop && visible.length > 1 && (
        <ol className={h.loop} aria-label="The daily loop">
          {visible.map((s, i) => <li key={s.key} className={s.key === key ? h.loopActive : undefined}><Link href={`/overview/${s.key}`} aria-current={s.key === key ? "step" : undefined}><b>{i + 1}. {s.label}</b>{s.question}</Link></li>)}
        </ol>
      )}
      <p className={h.purpose}>{hub.purpose}</p>
      <section className={h.next} aria-labelledby="next-h">
        <h2 id="next-h">Do this next</h2>
        {hub.attention.length === 0 ? <p className={r.empty}>{hub.empty ?? "Nothing waiting here right now."}</p> : (
          <ol>{hub.attention.slice(0, 8).map(a => <li key={a.href + a.label}><Link href={a.href}>{a.label}</Link>{a.sub && <span>{a.sub}</span>}<Link className={`btn ${h.go}`} href={a.href}>Open</Link></li>)}</ol>
        )}
      </section>
      <section className={h.metrics} aria-label={`${hub.title} metrics`}>
        {hub.metrics.map(m => (
          <div key={m.label} className={h.metric}>
            <Link href={m.href} className={h.value}>{m.value}</Link>
            <span className={h.label}>{m.label}</span>
            <details className={h.def}><summary>Definition</summary><p>{m.def}</p></details>
          </div>
        ))}
      </section>
      {hub.empty && hub.attention.length > 0 && <p className={ui.notice}>{hub.empty}</p>}
      {group && <WorkflowGuide group={group} />}
      <div className={r.grid}>
        <div>
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
              <details className={h.toolsAll}>
                <summary id="tools-h">All tools in {group.label}</summary>
                {group.sections.map((s, i) => (
                  <div key={i} className={h.tools}>{s.label && <p className={h.toolsLabel}>{s.label}</p>}
                    <ul>{s.items.map(it => <li key={it.href + it.label}><Link href={it.href}>{it.label}</Link></li>)}</ul></div>
                ))}
              </details>
            </section>
          )}
        </aside>
      </div>
    </>
  );
}
