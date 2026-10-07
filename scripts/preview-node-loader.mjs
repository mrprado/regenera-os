import {registerHooks} from 'node:module';
registerHooks({resolve(specifier,context,next){if(specifier==='cloudflare:workers')return {url:'data:text/javascript,export const env=globalThis.__regeneraPreviewEnv;export const waitUntil=p=>p.catch(console.error);export const withEnv=(env,fn)=>fn();',shortCircuit:true};return next(specifier,context);}});
