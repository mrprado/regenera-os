"use client";
import Link from 'next/link';
import {usePathname,useSearchParams} from 'next/navigation';
import {ChevronRight} from 'lucide-react';
import {activeNavGroup,navFor,type NavUser} from '@/lib/nav';
import s from './shell.module.css';
export default function WorkspaceTrail({user}:{user:NavUser}){const path=usePathname(),params=useSearchParams(),group=activeNavGroup(navFor(user),path,params);const isRecord=/^\/projects\/[^/?]+/.test(path);return <nav className={s.workspaceTrail} aria-label="Workspace breadcrumb"><Link href="/today">Workspace</Link><ChevronRight size={13} aria-hidden/>{group&&<Link href={group.href??'/today'}>{group.label}</Link>}{isRecord&&<><ChevronRight size={13} aria-hidden/><span>Project workspace</span></>}</nav>;}
