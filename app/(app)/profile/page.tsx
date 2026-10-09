import Link from 'next/link';
import {and,eq} from 'drizzle-orm';
import {requireOsUser} from '@/lib/auth';
import {appDb,isInternal} from '@/lib/db/scoped';
import {tenantMembers} from '@/db/schema';
import {USER_TYPES} from '@/lib/tenancy/vocab';
import {PageHeader} from '@/components/page';
import {saveProfileAction} from './profile-actions';
import s from '../shell.module.css';
export const dynamic='force-dynamic';
export const metadata={title:'Your profile'};
// Your own display name only; user type and access are assigned by an administrator and never change here.
export default async function ProfilePage({searchParams}:{searchParams:Promise<{saved?:string}>}){
 const user=await requireOsUser('/profile'),params=await searchParams;
 const [member]=await appDb().select().from(tenantMembers).where(and(eq(tenantMembers.email,user.email),eq(tenantMembers.status,'active'))).limit(1);
 const canManage=(isInternal(user.scope)&&user.scope.ownerOf.length>0)||!!user.scope.adminOf?.length;
 const editable=!!member&&!user.visitor&&user.scope.userType!=='read_only';
 return <><PageHeader title="Your profile"/><div className={s.profilePage}>{params.saved==='1'&&<p role="status">Profile saved.</p>}<form action={saveProfileAction}><label>Display name<input name="name" defaultValue={member?.name||user.displayName} maxLength={120} required disabled={!editable}/></label><label>Email<input value={user.email} readOnly/></label><p>Your email identifies your account and is managed through sign-in.</p>{editable&&<button className="btn btn--primary" type="submit">Save profile</button>}</form><section id="user-type"><h2>User type &amp; access</h2><p>{USER_TYPES[user.scope.userType??'regenera_internal'].label}</p><p>User type controls workspace access and is assigned by an authorized administrator.</p>{canManage&&<Link className="btn" href="/org?tab=users">Manage user types</Link>}</section><nav aria-label="Account settings"><Link href="/org">Organization</Link><Link href="/org?tab=security">Account security</Link><Link href="/notifications">Notifications</Link></nav></div></>;
}
