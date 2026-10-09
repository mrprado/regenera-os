"use client";
// Workspace landing page (October 2026 redesign, merged onto phase 24): searchable shown records, attention first,
// drill-through metrics with definitions, the group's operating path and its tools.
import {useState} from 'react';
import Link from 'next/link';
import {Search,BookOpen,AlertCircle} from 'lucide-react';
import type {Hub,HubLink} from '@/lib/hubs';
import type {NavGroup} from '@/lib/nav';
import s from './workspace-dashboard.module.css';
export default function WorkspaceDashboard({hub,group,refreshedAt}:{hub:Hub;group?:NavGroup;refreshedAt:string}){
 const [query,setQuery]=useState(''),[view,setView]=useState(hub.recent.length?'recent':'attention');
 const source=view==='attention'?hub.attention:hub.recent;
 const records=source.filter(row=>(row.label+' '+(row.sub??'')).toLowerCase().includes(query.toLowerCase().trim()));
 const steps=group?.sections.filter(section=>section.items.length).slice(0,4)??[];
 const row=(item:HubLink,index:number)=><li key={item.href+item.label}><span className={s.index}>{String(index+1).padStart(2,'0')}</span><div><Link href={item.href}>{item.label}</Link><p>{item.sub??'Open the record to review its evidence and history.'}</p></div><Link href={item.href} className={s.open} aria-label={'Open '+item.label}>Open</Link></li>;
 return <div className={s.workspace} data-workspace={group?.key}>
  <header className={s.header}><div><p className={s.eyebrow}>REGENERA / WORKSPACE</p><h1>{hub.title}</h1><p className={s.purpose}>{hub.purpose}</p></div><nav className={s.actions} aria-label={hub.title+' actions'}>{hub.actions.slice(0,3).map((a,i)=><Link key={a.href} href={a.href} className={i===0?'btn btn--primary':'btn'}>{a.label}</Link>)}</nav></header>
  <section className={s.metrics} aria-label={hub.title+' recorded metrics'}>{hub.metrics.map(metric=><article key={metric.label}><span>{metric.label}</span><Link href={metric.href}>{metric.value}</Link><details><summary>Basis & definition</summary><p>{metric.def}</p></details></article>)}</section>
  <div className={s.body}><div className={s.work}>
   {hub.attention.length>0&&<section className={s.attention} aria-label="Do this next"><div><AlertCircle size={18} aria-hidden/><h2>Do this next</h2><span>{hub.attention.length} shown</span></div><ul>{hub.attention.slice(0,5).map(row)}</ul></section>}
   <section className={s.records}><div className={s.sectionHead}><h2>{view==='attention'?'Needs attention':hub.recentTitle||'Recent records'}</h2><span aria-live="polite">{records.length} shown</span></div>
    <div className={s.controls}><label className={s.search}><Search size={17} aria-hidden/><input type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search shown records" aria-label={'Search '+hub.title+' shown records'}/></label><select value={view} onChange={e=>setView(e.target.value)} aria-label="Record view"><option value="recent">Recent records</option><option value="attention">Needs attention</option></select></div>
    {records.length?<ul className={s.recordList}>{records.map(row)}</ul>:<div className={s.empty}><BookOpen size={25} strokeWidth={1.3} aria-hidden/><h3>{query?'No matching records':view==='attention'?'No attention items shown':'No records shown'}</h3><p>{query?'Try a different name or clear the search.':hub.empty??'Open the register to see all records and their current state.'}</p>{query?<button className="btn" onClick={()=>setQuery('')}>Clear search</button>:hub.actions[0]&&<Link className="btn" href={hub.actions[0].href}>{hub.actions[0].label}</Link>}</div>}
    <footer className={s.basis}>Workspace records · authorized scope · refreshed {refreshedAt}. Open the linked register for the complete inventory.</footer>
   </section>
  </div><aside className={s.rail}>
   {steps.length>0&&<section className={s.path}><p className={s.eyebrow}>OPERATING PATH</p><h2>Move work forward</h2><ol>{steps.map((step,index)=><li key={step.label}><span>{index+1}</span><div><h3>{step.label}</h3><Link href={step.items[0].href}>{step.items[0].label}</Link></div></li>)}</ol></section>}
   {group&&<details className={s.tools} open><summary>Workspace tools</summary>{group.sections.map(section=><div key={section.label}><h3>{section.label}</h3><ul>{section.items.map(item=><li key={item.href}><Link href={item.href}>{item.label}</Link></li>)}</ul></div>)}</details>}
   <details className={s.provenance}><summary>Evidence & provenance</summary><p>Figures come from the existing registers; their definitions state the counting rules. Record pages hold the sources, review history and supporting documents. Unassessed values remain explicit.</p><p>Discovery and generated analysis require review before commitment. Check Settings for provider health; this dashboard does not establish that an integration is connected.</p></details>
  </aside></div>
 </div>;
}
