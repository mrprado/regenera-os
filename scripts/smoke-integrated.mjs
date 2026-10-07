import assert from 'node:assert/strict';
const base=process.env.PREVIEW_URL??'http://127.0.0.1:4311';
const login=await fetch(base+'/api/demo/start',{method:'POST',headers:{origin:base,'Content-Type':'application/x-www-form-urlencoded'},body:'role=founder',redirect:'manual'});assert.equal(login.status,303);
const headers={cookie:login.headers.get('set-cookie').split(';')[0]};
const home=await fetch(base+'/today',{headers});const text=await home.text();assert.equal(home.status,200);assert.ok(text.includes('Your workspace for projects, capital, and execution.'));assert.ok(text.includes('Integrated project operating layer'));
const project=text.match(/href="(\/projects\/[^"?]+)\?tab=operating/)[1];
for(const [view,expected]of [['memory','Persistent project context'],['graph','Project relationship graph'],['evidence','Narrative consistency audit'],['readiness','Institutional Readiness'],['scenarios','Development scenario comparison'],['missions','Advanced intelligence and saved missions'],['decisions','Decision Room'],['close','Operating close and board reporting'],['agents','Bounded specialist agents'],['ledger','Track Record Ledger']]){const response=await fetch(base+project+'?tab=operating&view='+view,{headers});const html=await response.text();assert.equal(response.status,200,view);assert.ok(html.includes(expected),view+' did not render its primary content');console.log(view+' rendered');}
console.log('Original Command and all 10 integrated views passed HTTP render checks.');
