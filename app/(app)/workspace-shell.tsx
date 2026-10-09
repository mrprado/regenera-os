"use client";
// Shell wrapper with the desktop sidebar toggle (October 2026 redesign). The mobile navigation disclosure is unchanged.
import {createContext,useContext,useState,type ReactNode} from 'react';
import {PanelLeft} from 'lucide-react';
import s from './shell.module.css';
const SidebarState=createContext<{collapsed:boolean;toggle:()=>void}>({collapsed:false,toggle:()=>{}});
export default function WorkspaceShell({children}:{children:ReactNode}){
 const [collapsed,setCollapsed]=useState(false);
 return <SidebarState.Provider value={{collapsed,toggle:()=>setCollapsed(value=>!value)}}><div className={s.shell} data-ui="regenera" data-sidebar={collapsed?'collapsed':'expanded'}>{children}</div></SidebarState.Provider>;
}
export function SidebarToggle(){const {collapsed,toggle}=useContext(SidebarState);return <button type="button" className={s.sidebarToggle} onClick={toggle} aria-label={collapsed?'Show sidebar':'Hide sidebar'} aria-expanded={!collapsed} aria-controls="workspace-sidebar" title={collapsed?'Show sidebar':'Hide sidebar'}><PanelLeft size={20} aria-hidden/></button>;}
