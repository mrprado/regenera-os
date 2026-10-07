import assert from 'node:assert/strict';
const base='http://127.0.0.1:4311';
const login=await fetch(base+'/api/demo/start',{method:'POST',headers:{origin:base,'Content-Type':'application/x-www-form-urlencoded'},body:'role=founder',redirect:'manual'});
const cookie=login.headers.get('set-cookie').split(';')[0];
const home=await (await fetch(base+'/today',{headers:{cookie}})).text();const project=home.match(/href="(\/projects\/[^"?]+)\?tab=operating/)[1];const path=base+project+'?tab=operating&view=memory';
const html=await (await fetch(path,{headers:{cookie}})).text();const form=[...html.matchAll(/<form\b[\s\S]*?<\/form>/g)].map(x=>x[0]).find(x=>x.includes('name="note"'));assert.ok(form,'Memory form not rendered');
const data=new FormData();for(const input of form.matchAll(/<input\b[^>]*>/g)){const name=input[0].match(/name="([^"]*)"/)?.[1];const value=input[0].match(/value="([^"]*)"/)?.[1]??'';if(name)data.set(name,value.replaceAll('&amp;','&'));}const note='DEMO — integrated workflow form round-trip verified';data.set('note',note);
const result=await fetch(path,{method:'POST',headers:{cookie,origin:base},body:data,redirect:'manual'});assert.ok([200,303].includes(result.status),'Form response '+result.status);const after=await (await fetch(path,{headers:{cookie}})).text();assert.ok(after.includes(note),'Server action did not persist project memory');console.log('Actual compiled React server action persisted project memory.');
