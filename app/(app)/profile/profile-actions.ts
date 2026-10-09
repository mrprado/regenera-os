"use server";
import {and,eq} from 'drizzle-orm';
import {redirect} from 'next/navigation';
import {z} from 'zod';
import {withOsUser} from '@/lib/auth';
import {appDb} from '@/lib/db/scoped';
import {tenantMembers} from '@/db/schema';
import {audit} from '@/lib/audit';
/** Updates only the signed-in user's own display name (identity from the session, never from the form). Audited. */
export async function saveProfileAction(form:FormData){
 const name=z.string().trim().min(1).max(120).parse(form.get('name'));
 await withOsUser(async user=>{
  const db=appDb(),where=and(eq(tenantMembers.email,user.email),eq(tenantMembers.status,'active'));
  const rows=await db.select({id:tenantMembers.id,name:tenantMembers.name}).from(tenantMembers).where(where);
  if(!rows.length)throw Error('No active profile is recorded.');
  await db.update(tenantMembers).set({name,updatedAt:new Date().toISOString()}).where(where);
  await audit(db,{actor:user.email,action:'profile_name_updated',entity:'tenant_members',entityId:rows[0].id,before:rows,after:{name}});
 });
 redirect('/profile?saved=1');
}
