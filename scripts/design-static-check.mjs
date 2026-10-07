import {readFileSync,readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import postcss from 'postcss';
const walk=dir=>readdirSync(dir,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?walk(resolve(dir,entry.name)):[resolve(dir,entry.name)]);
let files=0;for(const file of [...walk('app'),...walk('components'),...walk('styles')].filter(file=>file.endsWith('.css'))){postcss.parse(readFileSync(file,'utf8'),{from:file});files++;}
const rgb=hex=>hex.match(/\w\w/g).map(channel=>parseInt(channel,16)/255);const luminance=hex=>rgb(hex.slice(1)).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);const contrast=(a,b)=>{const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
for(const [name,foreground,background]of [['primary text','#20332a','#ffffff'],['secondary text','#586b5e','#ffffff'],['metadata','#64746a','#ffffff'],['header text','#bbc9bd','#1d2d26'],['gold identity','#d5ab4a','#1d2d26']]){const ratio=contrast(foreground,background);assert.ok(ratio>=4.5,name+' contrast '+ratio);console.log(name+' contrast '+ratio.toFixed(2));}
const sidebar=readFileSync('app/(app)/sidebar.tsx','utf8');assert.ok(!sidebar.includes('role="menu"'));assert.ok(sidebar.includes('aria-expanded'));assert.ok(sidebar.includes("event.key==='Escape'"));assert.ok(sidebar.includes("trigger.current?.focus()"));
console.log(files+' stylesheets parse; theme token contrast and disclosure semantics pass static checks.');
