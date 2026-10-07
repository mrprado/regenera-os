import {env} from 'cloudflare:workers';
import {sameOrigin,redirectTo,sessionCookie} from '@/lib/auth-http';
import {appDb} from '@/lib/db/scoped';
import {demoSession} from '@/lib/demo/integrated';
import {SESSION_COOKIE} from '@/lib/session';
export async function POST(request:Request){if(env.ISOLATED_DEMO!=='true'||env.APP_ENV!=='demo')return new Response('Demo unavailable',{status:404});if(!sameOrigin(request))return new Response('Forbidden',{status:403});const data=await request.formData();const role=data.get('role')==='reviewer'?'reviewer':'founder';try{const token=await demoSession(appDb(),role);return redirectTo(request,'/today',sessionCookie(request,SESSION_COOKIE,token,86400));}catch(error){console.error('Isolated demo initialization failed',error);return new Response('Demo initialization unavailable. Your production data has not been changed.',{status:503});}}
