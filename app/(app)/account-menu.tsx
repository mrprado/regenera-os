'use client';
// Avatar profile menu (October 2026 redesign). Notifications are a separate bell beside it, not an entry here.
import Link from 'next/link';
import {useEffect,useRef} from 'react';
import {UserRound,Shield,LogOut,LogIn,Building2,Users,Moon,Sun,Palette} from 'lucide-react';
import {usePathname} from 'next/navigation';
import {setThemeAction} from './appearance/actions';
import type {Theme} from '@/lib/theme';
import {withBase} from '@/lib/base-path';
import s from './shell.module.css';
export default function AccountMenu({name,email,typeLabel,canManage,visitor=false,theme='light'}:{name:string;email:string;typeLabel:string;canManage:boolean;visitor?:boolean;theme?:Theme}){
 const pathname=usePathname();
 // One-click switch between light and dark; Match my device and the full choice live in Settings → Appearance.
 const next:Theme=theme==='dark'?'light':'dark';
 const root=useRef<HTMLDetailsElement>(null),trigger=useRef<HTMLElement>(null);
 useEffect(()=>{const close=(event:MouseEvent)=>{if(root.current&&!root.current.contains(event.target as Node))root.current.open=false;};const key=(event:KeyboardEvent)=>{if(event.key==='Escape'&&root.current?.open){root.current.open=false;trigger.current?.focus();}};document.addEventListener('mousedown',close);document.addEventListener('keydown',key);return()=>{document.removeEventListener('mousedown',close);document.removeEventListener('keydown',key);};},[]);
 const initials=name.replace(/@.*/,'').split(/[\s._-]+/).filter(Boolean).slice(0,2).map(word=>word[0]).join('').toUpperCase()||'?';
 return <details ref={root} className={s.profileMenu}><summary ref={trigger} className={s.profileButton} aria-label="Open your profile"><span aria-hidden>{initials}</span></summary><div className={s.profilePanel} role="region" aria-label="Your account"><div className={s.profileIdentity}><strong>{name}</strong><span>{email}</span><span>{visitor?'Open access · view only':typeLabel}</span></div>
  {!visitor&&<nav aria-label="Profile options" onClick={()=>{if(root.current)root.current.open=false;}}><Link href="/profile"><UserRound size={17} aria-hidden/>Edit profile</Link><Link href="/profile#user-type"><Shield size={17} aria-hidden/>User type &amp; access</Link><Link href="/org"><Building2 size={17} aria-hidden/>Organization</Link>{canManage&&<Link href="/org?tab=users"><Users size={17} aria-hidden/>Manage users</Link>}<Link href="/appearance"><Palette size={17} aria-hidden/>Appearance</Link></nav>}
  {!visitor&&<form action={setThemeAction} className={s.themeToggle}><input type="hidden" name="theme" value={next}/><input type="hidden" name="back" value={pathname||'/today'}/><button type="submit">{next==='dark'?<Moon size={17} aria-hidden/>:<Sun size={17} aria-hidden/>}{next==='dark'?'Dark mode':'Light mode'}</button></form>}
  {visitor?<nav aria-label="Sign in"><a href={withBase('/signin?return_to=/today')}><LogIn size={17} aria-hidden/>Sign in</a></nav>:<form method="post" action={withBase('/api/auth/signout')}><button type="submit"><LogOut size={17} aria-hidden/>Sign out</button></form>}
 </div></details>;
}
