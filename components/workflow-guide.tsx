import Link from 'next/link';
import type {NavGroup} from '@/lib/nav';
import s from './workflow-guide.module.css';
export default function WorkflowGuide({group}:{group:NavGroup}){const sections=group.sections.filter(section=>section.items.length);if(!sections.length)return null;return <section className={s.guide} aria-label={`${group.label} workflow`}><h2>Move work forward</h2><ol>{sections.map((section,index)=><li key={section.label}><Link href={section.items[0].href}><span className={s.step}>{index+1}</span><strong>{section.label}</strong><span className={s.destination}>{section.items[0].label}</span></Link></li>)}</ol></section>;}
