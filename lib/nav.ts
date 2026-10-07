// Navigation map (docs/plans/phase-10-client-os.md §3). One definition feeds the sidebar, the Systems flyout, the
// menu search and Cmd+K, and tests/unit/nav-inventory.test.ts checks that every page route is reachable from it.
// URLs never change here: consolidation is visual only, so bookmarks and deep links keep working.
// Every top-level label opens its own landing page (href); the chevron beside it opens the submenu (phase 15 §5).
import { pathAllowed } from "@/lib/tenancy/vocab";

export type NavLeaf = { label: string; href: string; keywords?: string; ownerOnly?: boolean; internalOnly?: boolean };
export type NavSection = { label?: string; items: NavLeaf[] };
export type NavGroup = { key: string; label: string; icon: string; href?: string; sections: NavSection[]; internal?: boolean; mega?: boolean; tier?: "primary" | "workspace"; description?: string; section?: string };

const LEGACY_NAV: NavGroup[] = [
  { key: "command", label: "Command", icon: "house", href: "/today", sections: [] },
  { key: "atlas", label: "Atlas", icon: "earth", href: "/map", sections: [] },
  {
    key: "mandates", label: "Mandates", icon: "target", href: "/overview/mandates", sections: [{ items: [
      { label: "Live mandates", href: "/mandates", keywords: "mandate portfolio origination epc capital funding offtake land delivery floor" },
      { label: "New mandate", href: "/mandates?new=epc_origination", keywords: "create mandate builder" },
      { label: "Pursuits", href: "/pursuits", keywords: "epc pursuit rfp rfq bid bafo award capital raise" },
      { label: "Pursuit board", href: "/pursuits?view=board&type=epc", keywords: "kanban" },
      { label: "Approvals", href: "/approvals", keywords: "approve outreach introduction nda bid term sheet decision gate" },
      { label: "Desks & economics", href: "/mandates/desks", keywords: "desk p&l mrr arr margin capacity staffing seats" },
    ] }],
  },
  {
    key: "projects", label: "Projects", icon: "landmark", href: "/overview/projects", sections: [{ items: [
      { label: "All projects", href: "/projects" },
      { label: "Pipeline board", href: "/projects?view=board", keywords: "stages kanban" },
      { label: "Opportunities & screening", href: "/projects?stage=opportunity" },
      { label: "Active development", href: "/projects?stage=development" },
      { label: "Construction", href: "/projects?stage=construction" },
      { label: "Operating assets", href: "/projects?stage=operations" },
      { label: "Seeking capital", href: "/projects?capital=1" },
      { label: "Blocked", href: "/projects?blocked=1", keywords: "constraints issues" },
      { label: "Land pipeline", href: "/land", keywords: "acquisition parcels land candidates" },
      { label: "Community & rights", href: "/community", keywords: "fpic consent knowledge tek" },
    ] }],
  },
  {
    key: "systems", label: "Systems", icon: "sprout", href: "/overview/systems", mega: true, sections: [
      { label: "Land systems", items: [{ label: "Land pipeline", href: "/land", keywords: "acquisition" }, { label: "Land & agriculture capacity", href: "/systems?focus=land,soil,water", keywords: "soils water agriculture forestry agroforestry" }] },
      { label: "Built environment", items: [{ label: "Built environment intelligence", href: "/intelligence/built?tab=fit", keywords: "construction materials technologies solution stack" }, { label: "Settlement & community systems", href: "/systems?focus=community,cultural,local_economy", keywords: "housing hospitality masterplan" }] },
      { label: "Energy", items: [{ label: "Power & large loads", href: "/power", keywords: "solar wind bess grid ppa interconnection data centers" }, { label: "Tech & cost benchmarks", href: "/benchmarks", keywords: "capex lcoe" }] },
      { label: "Infrastructure & connectivity", items: [{ label: "Large loads & grid", href: "/power", keywords: "transmission substations data centers" }, { label: "Infrastructure capacity", href: "/systems?focus=system_capacity,resources,resilience", keywords: "water roads logistics" }] },
      { label: "Nature", items: [{ label: "Community & rights", href: "/community", keywords: "biodiversity restoration" }, { label: "Nature & capital transition", href: "/capital/alignment", keywords: "natural capital carbon" }, { label: "System capacity & interventions", href: "/systems" }, { label: "Biodiversity & climate", href: "/systems?focus=biodiversity,climate,resilience", keywords: "nature dependencies impacts tnfd" }] },
    ],
  },
  {
    key: "capital", label: "Capital", icon: "banknote", href: "/overview/capital", sections: [{ items: [
      { label: "Capital partners", href: "/capital", keywords: "investors mandates lps funds" },
      { label: "Private investors", href: "/capital?tab=private" },
      { label: "Capital opportunities", href: "/capital?tab=opportunities", keywords: "capital match readiness" },
      { label: "Introductions", href: "/capital?tab=introductions" },
      { label: "Bonds & notes", href: "/capital?tab=bonds", keywords: "debt" },
      { label: "Capital structures", href: "/capital/structures", keywords: "stack spv blended" },
      { label: "Funding pathways", href: "/capital/funding-pathways" },
      { label: "Capital alignment", href: "/capital/alignment", keywords: "nature transition 30:1" },
    ] }, { label: "Funding", items: [
      { label: "Funding opportunities", href: "/funding", keywords: "grants tenders calls public blended finance incentives" },
      { label: "Funding calendar", href: "/funding?tab=calendar", keywords: "deadlines" },
      { label: "Bids & applications", href: "/funding?tab=bids", keywords: "proposal application workspace" },
      { label: "Applicants", href: "/funding?tab=applicants", keywords: "prospects origination eligibility" },
      { label: "Funding origination", href: "/funding?tab=origination", keywords: "funnel funding-originated revenue" },
      { label: "Awards & post-award", href: "/funding?tab=awards", keywords: "award reporting milestones" },
      { label: "Funders", href: "/funding?tab=funders" },
      { label: "Bid library", href: "/funding?tab=library", keywords: "boilerplate narratives" },
      { label: "Funding practice economics", href: "/funding/economics", keywords: "scenario margin staffing" },
    ] }],
  },
  {
    key: "deals", label: "Opportunities", icon: "kanban", href: "/overview/deals", sections: [{ items: [
      { label: "Pipeline board", href: "/deals", keywords: "deals opportunities pipeline kanban" },
      { label: "Opportunity table", href: "/deals?view=table", keywords: "deals forecast" },
      { label: "Proposals awaiting decision", href: "/deals?view=table&stage=proposal", keywords: "deals proposal" },
      { label: "Capital mandates", href: "/deals?path=capital_mandate" },
      { label: "Project diagnostics", href: "/deals?path=project_diagnostic" },
      { label: "Contracts & term sheets", href: "/contracts", keywords: "nda agreements" },
      { label: "Data rooms", href: "/portals?tab=rooms", keywords: "portal nda" },
      { label: "Introducers & fees", href: "/portals?tab=brokers", keywords: "brokers referrals" },
    ] }],
  },
  {
    key: "relationships", label: "Relationships", icon: "network", href: "/overview/relationships", sections: [{ items: [
      { label: "Scans", href: "/scans", keywords: "find organizations decision makers discover prospects scan presets" },
      { label: "Scan runs & review", href: "/scans?tab=runs", keywords: "review prospects results" },
      { label: "Objectives", href: "/objectives", keywords: "party objective find contracts matching opportunities epc developer fund shortlist" },
      { label: "Campaign economics", href: "/scans?tab=economics", keywords: "attribution cost meetings proposals signed collected revenue" },
      { label: "People", href: "/people", keywords: "contacts" },
      { label: "Organizations", href: "/companies", keywords: "companies" },
      { label: "Partner network", href: "/partners" },
      { label: "Ecosystem network", href: "/network", keywords: "epc suppliers operators epd" },
      { label: "Specialists", href: "/specialists", keywords: "bench sme experts rates" },
      { label: "Relationship graph", href: "/relationships" },
      { label: "Lists", href: "/lists" },
      { label: "Prospecting", href: "/prospecting", keywords: "apollo search" },
      { label: "Saved searches", href: "/searches" },
      { label: "Sequences", href: "/sequences", keywords: "outreach" },
      { label: "Approval queue", href: "/queue", keywords: "drafts" },
      { label: "Inbox", href: "/inbox", keywords: "replies" },
    ] }],
  },
  {
    key: "intelligence", label: "Intelligence", icon: "radar", href: "/overview/intelligence", sections: [{ items: [
      { label: "Analyst workbench", href: "/workbench", keywords: "analysis issue tree evidence memo ic diligence research question" },
      { label: "Signals & triggers", href: "/triggers", keywords: "intelligence" },
      { label: "All current signals", href: "/triggers?tab=signals" },
      { label: "Watch & theses", href: "/intelligence", keywords: "watchlists" },
      { label: "Built environment", href: "/intelligence/built", keywords: "construction materials modular mass timber low carbon concrete suppliers proptech market map procurement rfp" },
      { label: "Email intelligence", href: "/intelligence/mail", keywords: "gmail inbox correspondence threads commitments introductions relationship history" },
      { label: "Data catalogue", href: "/intelligence/data", keywords: "wri aqueduct global forest watch resource watch datasets providers provenance licence" },
      { label: "Tech & cost benchmarks", href: "/benchmarks", keywords: "comps" },
      { label: "Reports & forecast", href: "/reports", keywords: "metrics weekly" },
      { label: "Lessons & case records", href: "/reports?tab=cases", keywords: "learning" },
    ] }],
  },
  {
    key: "clients", label: "Clients", icon: "briefcase", href: "/overview/clients", internal: true, sections: [{ items: [
      { label: "Accounts", href: "/clients", keywords: "tenants client health organizations" },
      { label: "Commercial overview", href: "/commercial", keywords: "arr mrr pipeline revenue" },
      { label: "Engagements", href: "/commercial?tab=engagements", keywords: "mandates workstreams deliverables" },
      { label: "Services & pricing", href: "/commercial?tab=services", keywords: "catalog" },
      { label: "Billing", href: "/commercial?tab=billing", keywords: "invoices" },
      { label: "Partners & vendors", href: "/commercial?tab=partners" },
      { label: "Accounts & tools", href: "/commercial?tab=accounts" },
      { label: "Corporate entities", href: "/commercial?tab=entities" },
      { label: "Portal users", href: "/portals?tab=users" },
    ] }],
  },
  {
    key: "operations", label: "Operations", icon: "check", href: "/overview/operations", sections: [{ items: [
      { label: "Actions & tasks", href: "/tasks" },
      { label: "Capacity", href: "/capacity", keywords: "utilization allocation team cost rates hiring" },
      { label: "Playbooks", href: "/playbooks", keywords: "workflows" },
      { label: "Documents", href: "/documents" },
      { label: "Document generator", href: "/documents/generator" },
      { label: "Contracts", href: "/contracts" },
      { label: "Reports", href: "/reports" },
      { label: "Notifications", href: "/notifications", keywords: "alerts" },
      { label: "Portal requests & updates", href: "/portals?tab=requests" },
    ] }],
  },
];


// Each group opens on its main page, then follows the order the work happens in. A destination lives in the one group that
// owns it (no cross-group duplicates); Systems stays a specialist lens over project disciplines.
const MENU_LAYOUT: Record<string,{label?:string;description:string;sections:{label:string;hrefs:string[]}[]}>={
 intelligence:{description:'Spot signals, investigate the evidence, and turn it into decisions.',sections:[{label:'Monitor',hrefs:['/intelligence','/triggers?tab=signals','/triggers']},{label:'Investigate',hrefs:['/workbench','/benchmarks','/intelligence/built']},{label:'Sources',hrefs:['/intelligence/data','/intelligence/ontology','/intelligence/mail']},{label:'Report & learn',hrefs:['/reports','/reports?tab=cases']}]},
 deals:{label:'Deals',description:'Qualify opportunities, agree terms, then run the client engagement and its commercials.',sections:[{label:'Pipeline',hrefs:['/deals','/deals?view=table']},{label:'Engagement pathways',hrefs:['/deals?path=project_diagnostic','/deals?path=capital_mandate']},{label:'Proposals & terms',hrefs:['/deals?view=table&stage=proposal','/contracts']},{label:'Diligence rooms',hrefs:['/portals?tab=rooms','/portals?tab=brokers']},{label:'Clients & engagements',hrefs:['/clients','/commercial','/commercial?tab=engagements','/commercial?tab=services','/commercial?tab=billing','/commercial?tab=partners']},{label:'Entity & access administration',hrefs:['/commercial?tab=entities','/commercial?tab=accounts','/portals?tab=users']}]},
 projects:{description:'Move an asset from screening through development and operation, with its specialist systems.',sections:[{label:'Portfolio',hrefs:['/projects','/projects?view=board']},{label:'Needs attention',hrefs:['/projects?blocked=1','/projects?capital=1']},{label:'By stage',hrefs:['/projects?stage=opportunity','/projects?stage=development','/projects?stage=construction','/projects?stage=operations']},{label:'Place & rights',hrefs:['/land','/community']},{label:'Systems & disciplines',hrefs:['/systems','/systems?focus=land,soil,water','/systems?focus=community,cultural,local_economy','/power','/systems?focus=system_capacity,resources,resilience','/intelligence/built?tab=fit','/systems?focus=biodiversity,climate,resilience']}]},
 capital:{description:'Match capital to the need, prepare readiness, and advance applications.',sections:[{label:'Pipeline & matching',hrefs:['/capital','/capital?tab=opportunities','/capital?tab=introductions','/capital?tab=private','/capital?tab=bonds']},{label:'Structure & readiness',hrefs:['/capital/structures','/capital/funding-pathways','/capital/alignment']},{label:'Find funding',hrefs:['/funding','/funding?tab=calendar','/funding?tab=funders']},{label:'Apply & deliver',hrefs:['/funding?tab=applicants','/funding?tab=origination','/funding?tab=bids','/funding?tab=library','/funding?tab=awards','/funding/economics']}]},
 command:{description:'What needs you today: priorities, replies, tasks, approvals, incoming leads and outreach waiting to go.',sections:[{label:'Today',hrefs:['/inbox','/tasks','/approvals','/notifications']},{label:'Incoming',hrefs:['/deals?stage=lead','/portals?tab=referrals','/portals?tab=messages','/portals?tab=intake']},{label:'Outreach',hrefs:['/queue']}]},
 relationships:{label:'Network',description:'Know who matters, find the right people, and keep relationships moving.',sections:[{label:'People & organizations',hrefs:['/companies','/people','/relationships','/lists','/network/sanctions']},{label:'Target & discover',hrefs:['/objectives','/scans','/scans?tab=runs','/searches','/prospecting','/scans?tab=economics']},{label:'Partners & expertise',hrefs:['/partners','/network','/specialists']},{label:'Outreach sequences',hrefs:['/sequences']}]},
 operations:{label:'Delivery',description:'Run the work: playbooks, capacity, documents, and the controls behind recurring jobs.',sections:[{label:'Execution',hrefs:['/playbooks','/capacity']},{label:'Documents',hrefs:['/documents','/documents/generator','/portals?tab=requests']},{label:'Automation controls',hrefs:['/settings/jobs','/settings/claude','/connect/mcp']}]},
 mandates:{description:'Define the commercial scope, qualify a pursuit, and secure approval.',sections:[{label:'Define',hrefs:['/mandates','/mandates?new=epc_origination']},{label:'Pursue',hrefs:['/pursuits','/pursuits?view=board&type=epc']},{label:'Economics',hrefs:['/mandates/desks']}]},
 systems:{description:'Specialist disciplines in their project context.',sections:[{label:'All systems',hrefs:['/systems']},{label:'Land, water & community',hrefs:['/systems?focus=land,soil,water','/systems?focus=community,cultural,local_economy']},{label:'Energy & infrastructure',hrefs:['/power','/systems?focus=system_capacity,resources,resilience']},{label:'Built environment',hrefs:['/intelligence/built?tab=fit']},{label:'Nature & climate',hrefs:['/systems?focus=biodiversity,climate,resilience']}]},
 clients:{description:'Manage the account, engagement, commercial terms, and delivery relationship.',sections:[{label:'Accounts & engagements',hrefs:['/clients','/commercial','/commercial?tab=engagements']},{label:'Commercial operations',hrefs:['/commercial?tab=services','/commercial?tab=billing','/commercial?tab=partners']},{label:'Entity & access administration',hrefs:['/commercial?tab=entities','/commercial?tab=accounts','/portals?tab=users']}]}
};
const ADDED_TOOLS:NavLeaf[]=[{label:'Sanctions screening',href:'/network/sanctions',keywords:'ofac uk eu un sanctions kyc counterparty screening compliance',internalOnly:true},{label:'Ontology & data fabric',href:'/intelligence/ontology',keywords:'ontology entities relationships state machines gates sources providers families evidence levels country packs identifiers aliases',internalOnly:true},{label:'New leads (incl. regenera.bio enquiries)',href:'/deals?stage=lead',keywords:'website inquiry enquiry contact form regenera.bio leads'},{label:'Partner referrals',href:'/portals?tab=referrals',keywords:'referrals introductions partners',internalOnly:true},{label:'Portal messages',href:'/portals?tab=messages',keywords:'client sponsor investor messages',internalOnly:true},{label:'Portal intake',href:'/portals?tab=intake',keywords:'intake submissions sponsor projects',internalOnly:true},{label:'Jobs & recurring work',href:'/settings/jobs',keywords:'automations schedules integrations health',internalOnly:true},{label:'AI prompts & models',href:'/settings/claude',keywords:'claude prompts agents',internalOnly:true},{label:'API & MCP',href:'/connect/mcp',keywords:'connections tools'}];
// Sidebar (2026-10-06, founder's order): the core four on top (Command, Atlas, Capital, Projects), then the commercial
// pipeline, then workspace tools with Intelligence last. Systems lives inside Projects and Clients inside Deals; their
// pages and URLs are unchanged.
// Command holds the daily inbox, tasks, approvals and notifications as its submenu.
// Founder's order: Command, Atlas, Mandates, then the Pipeline (Deals, Network), then Capital and Projects, then Workspace.
const SIDEBAR:[string,string|undefined][]=[['command',undefined],['atlas',undefined],['mandates',undefined],['deals','Pipeline'],['relationships','Pipeline'],
 ['capital',undefined],['projects',undefined],['operations','Workspace'],['intelligence','Workspace']];
const PRIMARY_ORDER=SIDEBAR.map(([k])=>k);
/** Presentation changes only: every distinct legacy href remains available; exact duplicates within a group consolidate. */
// Every legacy destination, keyed by href, so a group may present a page that used to sit in another group.
const ALL_LEAVES=new Map<string,NavLeaf>();
for(const item of [...LEGACY_NAV.flatMap(g=>g.sections.flatMap(s=>s.items.map(i=>(g.internal?{...i,internalOnly:true}:i)))),...ADDED_TOOLS]){const prior=ALL_LEAVES.get(item.href);ALL_LEAVES.set(item.href,{...item,keywords:[prior?.keywords,prior?.label,item.keywords,item.label].filter(Boolean).join(' '),ownerOnly:item.href==='/capital?tab=private'||item.href==='/intelligence/mail',internalOnly:item.internalOnly||prior?.internalOnly});}
export const NAV:NavGroup[]=SIDEBAR.map(([key,section])=>{
 const base=LEGACY_NAV.find(g=>g.key===key)!;const layout=MENU_LAYOUT[key];if(!layout)return {...base,tier:'primary',section};
 const leaves=ALL_LEAVES;
 return {...base,label:layout.label??base.label,tier:'primary',section,description:layout.description,mega:false,sections:layout.sections.map(s=>({label:s.label,items:s.hrefs.map(href=>{const item=leaves.get(href);if(!item)throw new Error('Missing menu destination '+href);return item;})}))};
});
export function activeNavGroup(groups:NavGroup[],pathname:string,params:URLSearchParams):NavGroup|undefined{
 const overview=pathname.match(/^\/overview\/([^/]+)/)?.[1];if(overview)return groups.find(g=>g.key===overview);
 const owners:[RegExp,string][]=[[/^\/today(?:\/|$)/,'command'],[/^\/map(?:\/|$)/,'atlas'],[/^\/(projects|land|community)(?:\/|$)/,'projects'],[/^\/(capital|funding)(?:\/|$)/,'capital'],[/^\/(deals|contracts|portals)(?:\/|$)/,'deals'],[/^\/(inbox|queue|tasks|notifications|approvals)(?:\/|$)/,'command'],[/^\/(scans|objectives|companies|people|network|partners|specialists|relationships|lists|prospecting|searches|sequences)(?:\/|$)/,'relationships'],[/^\/(triggers|intelligence|workbench|benchmarks|reports)(?:\/|$)/,'intelligence'],[/^\/(capacity|playbooks|documents)(?:\/|$)/,'operations'],[/^\/(mandates|pursuits)(?:\/|$)/,'mandates'],[/^\/(systems|power)(?:\/|$)/,'projects'],[/^\/(clients|commercial)(?:\/|$)/,'deals']];
 const owner=owners.find(([pattern])=>pattern.test(pathname));if(owner){const group=groups.find(g=>g.key===owner[1]);if(group)return group;}
 const matches=groups.flatMap(group=>group.sections.flatMap(s=>s.items).filter(item=>{const [path,query]=item.href.split('?');return (pathname===path||pathname.startsWith(path+'/'))&&[...new URLSearchParams(query)].every(([k,v])=>params.get(k)===v);}).map(item=>({group,length:item.href.length})));return matches.sort((a,b)=>b.length-a.length)[0]?.group;
}

export const SETTINGS_NAV: NavLeaf[] = [
  { label: "Organization", href: "/org", keywords: "users teams roles modules security branding api" },
  { label: "Connections", href: "/settings/connections" },
  { label: "Integrations", href: "/settings/integrations", keywords: "data sources health" },
  { label: "Data providers", href: "/intelligence/data?tab=health", keywords: "api health sync failures licence review" },
  { label: "Sending", href: "/settings/sending" },
  { label: "Workspaces", href: "/settings/mandates", keywords: "entities mandates" },
  { label: "Members", href: "/settings/members" },
  { label: "Jobs", href: "/settings/jobs" },
  { label: "Claude", href: "/settings/claude", keywords: "prompts ai" },
  { label: "Extension", href: "/settings/extension" },
  { label: "Demo data", href: "/settings/demo", ownerOnly:true },
  { label: "Product governance", href: "/settings/product", keywords: "backlog technical debt product debt requests roadmap" },
  { label: "API & MCP", href: "/connect/mcp", keywords: "tokens" },
];

export type NavUser = { modules?: readonly string[] | "all"; internal: boolean; owner?: boolean };

/** The navigation this user may use: modules they are entitled to; Regenera-internal groups only for staff. */
export function navFor(u: NavUser): NavGroup[] {
  return NAV.filter(g => !g.internal || u.internal).flatMap(g => {
    const sections = g.sections.map(s => ({ ...s, items: s.items.filter(i => pathAllowed(u.modules, i.href) && (!i.internalOnly || u.internal) && (!i.ownerOnly || u.owner !== false)) })).filter(s => s.items.length);
    // A group with a submenu is shown when any leaf is allowed; a single-page group when its page is.
    if (g.sections.length ? !sections.length : !(g.href && pathAllowed(u.modules, g.href))) return [];
    // The label opens the landing page when the user may open it, otherwise the first leaf they may open.
    const href = g.href && pathAllowed(u.modules, g.href) ? g.href : sections[0]?.items[0]?.href;
    return [{ ...g, href, sections }];
  });
}

export const settingsFor = (u: NavUser) => (u.internal ? SETTINGS_NAV.filter(i=>!i.ownerOnly||u.owner!==false) : SETTINGS_NAV.filter(i => i.href === "/org" || (i.href === "/connect/mcp" && pathAllowed(u.modules, i.href))));

/** Flat list for menu search and Cmd+K: "Systems › Energy › Power & large loads". */
export function flatNav(u: NavUser) {
  const out: { label: string; path: string; href: string; keywords: string }[] = [];
  for (const g of navFor(u)) {
    if (g.href) out.push({ label: g.label, path: g.label, href: g.href, keywords: `${g.key} ${g.description??''}` });
    for (const s of g.sections) for (const i of s.items) out.push({ label: i.label, path: [g.label, s.label, i.label].filter(Boolean).join(" › "), href: i.href, keywords: i.keywords ?? "" });
  }
  for (const i of settingsFor(u)) out.push({ label: i.label, path: `Settings › ${i.label}`, href: i.href, keywords: i.keywords ?? "" });
  return out;
}
