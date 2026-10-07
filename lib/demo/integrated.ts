import {and,eq} from 'drizzle-orm';
import type {Db} from '@/db';
import {authSessions,mandates,mandateMembers,projects,organizations,decisions,triggers,contextRecords,contextEdges,reportingPeriods} from '@/db/schema';
import {seedDemo,DEMO_MANDATE} from './seed';
import {addClaim,addEvidence} from '@/lib/evidence/engine';
import {newToken,hashToken} from '@/lib/session';
import {capitalDimensions,institutionalDimensions} from '@/lib/project-context/model';
export const DEMO_IDENTITIES={founder:'founder@example.test',reviewer:'reviewer@example.test'};
export async function ensureIntegratedDemo(db:Db){
 const workspaces=await db.select({id:mandates.id}).from(mandates);if(workspaces.some(w=>w.id!==DEMO_MANDATE))throw new Error('This demo entry refuses a database containing any other workspace');
 await seedDemo(db,DEMO_IDENTITIES.founder);for(const email of Object.values(DEMO_IDENTITIES))await db.insert(mandateMembers).values({mandateId:DEMO_MANDATE,email,role:'owner'}).onConflictDoNothing();
 return seedDemoContext(db);
}
/** Project-context sample (claims with evidence, memory, readiness, scenarios, missions, decision, reporting period) for the
 *  DEMO workspace only. Safe in a database with real workspaces: every row is written to DEMO_MANDATE, the workspace is
 *  marked sandbox, and a second run changes nothing. Used by the isolated demo and by Settings → Demo data. */
export async function seedDemoContext(db:Db){
 await db.update(mandates).set({sandbox:true}).where(eq(mandates.id,DEMO_MANDATE));
 const [project]=await db.select().from(projects).where(and(eq(projects.mandateId,DEMO_MANDATE),eq(projects.assetClass,'solar')));if(!project)throw new Error('Demo project missing');
 const [existing]=await db.select().from(contextRecords).where(and(eq(contextRecords.projectId,project.id),eq(contextRecords.kind,'memory'))).limit(1);if(existing)return project;
 const claim=await addClaim(db,{mandateId:DEMO_MANDATE,entityType:'project',entityId:project.id,statement:'DEMO — calculated DC capacity 100 MWDC',claimType:'metric',field:'capacity',value:'100',unit:'MWDC',status:'calculated',createdBy:'demo'},'demo');
 const evidence=await addEvidence(db,claim.id,{method:'document',provider:'Synthetic demonstration model',excerpt:'Illustrative capacity basis only; not a real engineering assessment',sourceDate:'2026-10-05',confidence:'medium'},'demo');
 const deck=await addClaim(db,{mandateId:DEMO_MANDATE,entityType:'project',entityId:project.id,statement:'DEMO — investor deck states 120 MWDC',claimType:'metric',field:'capacity',value:'120',unit:'MWDC',status:'source_provided',createdBy:'demo'},'demo');await addEvidence(db,deck.id,{method:'document',provider:'Synthetic demonstration deck',excerpt:'Inconsistent invented deck figure for training',sourceDate:'2026-10-05',confidence:'low'},'demo');
 const add=async(kind:typeof contextRecords.$inferInsert.kind,title:string,data:Record<string,unknown>)=>db.insert(contextRecords).values({mandateId:DEMO_MANDATE,projectId:project.id,kind,title,data,createdBy:'demo'});
 await add('memory','DEMO — resolve capacity basis before next investor call',{scope:'project',evidenceId:evidence.id});await add('memory','DEMO — sponsor history requires independent references',{scope:'organization',evidenceId:evidence.id});
 for(const [type,dimensions]of [['capital',capitalDimensions],['institutional',institutionalDimensions]] as const)for(const [i,dimension]of dimensions.entries())await add('readiness',dimension.replaceAll('_',' '),{type,dimension,score:(type==='capital'?[70,45,55,60,80,40,65,20,85,60]:[50,30,15,55,45,60,40,55,65,70,60,45])[i],evidenceId:evidence.id,demo:true});
 for(const [name,capex,irr,timeline,water,ecology]of [['Solar + BESS',92,14,24,80,-2],['Regenerative agriculture',9,7,18,120,2],['Regenerative community',35,9,36,60,3],['Conservation + limited development',5,4,12,15,4]] as const)await add('scenario',`DEMO — ${name}`,{capex,irr,timeline,water,ecology,permittingRisk:'source review required',community:'Consent and baseline required',evidenceId:evidence.id,classification:'modelled estimate'});
 await add('land_pathway','DEMO — Land → Rights → Value',{state:'land_control',target:'investment_ready',milestones:['Raw land','Title review','Land control','Zoning','Environment','Access','Planning','Entitlement','Development rights','Investment readiness'],completed:3,next:'Confirm zoning and community consent',evidenceId:evidence.id});
 await add('mission','LatAm Solar Capital Need',{sector:'energy',country:'MEX',minCapacity:100,types:['ppa','permit'],days:180,exclude:['financing'],evidenceId:evidence.id});
 await add('mission','US BESS Financing Watch',{sector:'energy',country:'USA',minCapacity:50,types:['financing','construction'],days:90,evidenceId:evidence.id});
 await db.insert(decisions).values({mandateId:DEMO_MANDATE,projectId:project.id,title:'DEMO — choose development pathway',context:'Compare source-backed site and capital scenarios',options:'Solar + BESS | Regenerative agriculture | Regenerative community | Conservation + limited development',status:'open',evidence:'Synthetic model; reviewer must confirm assumptions'});
 await db.insert(reportingPeriods).values({mandateId:DEMO_MANDATE,projectId:project.id,name:'October 2026 — demo',cadence:'monthly'});
 const orgs=await db.select().from(organizations).where(eq(organizations.mandateId,DEMO_MANDATE));for(const org of orgs.slice(0,4))await db.insert(contextEdges).values({mandateId:DEMO_MANDATE,projectId:project.id,sourceType:'organization',sourceId:org.id,predicate:org.name.includes('EPC')?'epc_for':org.name.includes('Family')?'reviewed':'associated_with',targetType:'project',targetId:project.id,evidenceId:evidence.id});
 await db.insert(triggers).values({mandateId:DEMO_MANDATE,projectId:project.id,orgId:orgs[0].id,type:'capital',summary:'DEMO — illustrative capital vehicle launch',source:'demo',eventDate:'2026-10-01',status:'new'});
 return project;
}
export async function demoSession(db:Db,role:keyof typeof DEMO_IDENTITIES){await ensureIntegratedDemo(db);const email=DEMO_IDENTITIES[role];const token=newToken();await db.insert(authSessions).values({email,tokenHash:await hashToken(token),createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+86400000).toISOString()});return token;}
