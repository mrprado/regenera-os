import { redirect } from "next/navigation";
import {env} from 'cloudflare:workers';

export default function Home() {
  if(env.ISOLATED_DEMO==='true'&&env.APP_ENV==='demo')redirect('/demo');
  redirect("/today");
}
