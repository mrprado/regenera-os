"use client";
import { useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, Search, ChevronRight } from 'lucide-react';
import type { Hub, HubLink } from '@/lib/hubs';
import type { NavGroup } from '@/lib/nav';
import { DESKS, workspaceRecords } from '@/lib/dashboard-view';
import s from './workspace-dashboard.module.css';

export default function WorkspaceDashboard({ hub, group, refreshedAt }: { hub: Hub; group?: NavGroup; refreshedAt: string }) {
 const desk = DESKS[hub.title] ?? { question: hub.purpose, title: hub.recentTitle || 'Workspace records', action: 'Open record', context: hub.purpose, mode: 'directory' };
 const { priorities, records } = workspaceRecords(hub.attention, hub.recent);
 const [query, setQuery] = useState('');
 const [selection, setSelection] = useState<HubLink | null>(null);
 const selected = selection && [...priorities, ...records].some(row => row.href === selection.href && row.label === selection.label) ? selection : priorities[0] ?? records[0];
 const visible = records.filter(row => `${row.label} ${row.sub ?? ''}`.toLowerCase().includes(query.trim().toLowerCase()));
 const tools = group?.sections.filter(section => section.items.length) ?? [];
 const record = (row: HubLink) => <li key={row.href + row.label} className={s.record} data-selected={selected?.href === row.href && selected?.label === row.label}><button type="button" className={s.recordButton} onClick={() => setSelection(row)} aria-pressed={selected?.href === row.href && selected?.label === row.label}><span>{row.label}</span><ChevronRight size={16} aria-hidden /></button><p>{row.sub || 'Details are available in the source register.'}</p><Link className={s.recordLink} href={row.href}>{desk.action}<ArrowUpRight size={13} aria-hidden /></Link></li>;
 return <div className={s.workspace} data-workspace={group?.key} data-layout={desk.mode}>
  <header className={s.header}><div><h1>{hub.title}</h1><p className={s.question}>{desk.question}</p></div><nav className={s.actions} aria-label={`${hub.title} actions`}>{hub.actions.slice(0,2).map((a,i)=><Link key={a.href} href={a.href} className={i===0?'btn btn--primary':'btn'}>{a.label}</Link>)}</nav></header>
  <div className={s.desk}><div className={s.work}>
   {priorities.length>0 && <section className={s.attention}><div className={s.sectionHead}><h2>{desk.mode==='commitments'?'Review before closing':desk.mode==='delivery'?'Delivery needs attention':'Needs a decision'}</h2><span>{priorities.length} shown</span></div><ul className={s.priorityList}>{priorities.map(record)}</ul></section>}
   <section className={s.records} aria-label={desk.title}><div className={s.sectionHead}><h2>{desk.title}</h2><span>{records.length} shown</span></div>
    {records.length>0 && <label className={s.search}><Search size={16} aria-hidden /><input type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder={`Find in ${desk.title.toLowerCase()}`} aria-label={`Search shown ${desk.title.toLowerCase()}`} /></label>}
    {desk.mode==='research' && <div className={s.research}><p className={s.eyebrow}>FROM QUESTION TO DECISION</p><h3>Investigate a specific project question</h3><p>Use the analyst workbench for diligence, source comparison and decision briefs. Read signals separately from project evidence.</p><div className={s.routes}>{hub.actions.map(a=><Link key={a.href} href={a.href}>{a.label}<ArrowUpRight size={16} aria-hidden /></Link>)}</div></div>}
    {desk.mode==='capital' && <nav className={s.capitalRoutes} aria-label="Financing paths">{hub.actions.slice(1).map(a=><Link key={a.href} href={a.href}>{a.label}<ArrowUpRight size={15} aria-hidden /></Link>)}</nav>}
    {visible.length>0 ? <ul className={s.recordList} data-mode={desk.mode}>{visible.map(record)}</ul> : desk.mode!=='research' && <div className={s.empty}><h3>{query?'No matching records':'No additional records shown'}</h3><p>{query?'Try another name or clear your search.':priorities.length?'Work needing a decision is listed above. Open the full register for the complete inventory.':hub.empty || 'Start with a real record. This desk reflects work recorded in your authorized workspace.'}</p>{query?<button className="btn" onClick={()=>setQuery('')}>Clear search</button>:hub.actions[0]&&<Link className="btn" href={hub.actions[0].href}>{hub.actions[0].label}</Link>}</div>}
   </section>
  </div><aside className={s.context} aria-label="Decision context"><section className={s.contextPanel}><p className={s.eyebrow}>IN FOCUS</p><h2>{selected?.label ?? 'Start with the decision'}</h2>{selected && <p className={s.fact}>{selected.sub || 'Open the record to inspect its current state.'}</p>}<div className={s.contextNote}><h3>{desk.mode==='commitments'?'Evidence before closure':'Before the next step'}</h3><p>{desk.context}</p></div>{selected && <Link className="btn btn--primary" href={selected.href}>{desk.action}<ArrowUpRight size={15} aria-hidden /></Link>}</section>
   <details className={s.snapshot}><summary>Register snapshot <span>{hub.metrics.length} measures</span></summary><dl>{hub.metrics.map(m=><div key={m.label}><dt><Link href={m.href}>{m.label}</Link></dt><dd>{m.value}</dd><p>{m.def}</p></div>)}</dl></details>
   {tools.length>0 && <details className={s.tools}><summary>All {hub.title.toLowerCase()} tools</summary>{tools.map(section=><div key={section.label}><h3>{section.label}</h3>{section.items.map(item=><Link key={item.href} href={item.href}>{item.label}<ArrowUpRight size={12} aria-hidden /></Link>)}</div>)}</details>}
  </aside></div><footer className={s.basis}>Authorized workspace records · refreshed {refreshedAt}. Shown records are a limited view; open the register for the full inventory.<details><summary>Purpose &amp; evidence</summary><p>{hub.purpose}</p><p>Record pages hold sources, documents and review history. Missing evidence stays unknown. Source health is available in Settings.</p></details></footer>
 </div>;
}
