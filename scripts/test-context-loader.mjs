import {registerHooks} from 'node:module';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
registerHooks({resolve(specifier,context,next){if(specifier==='cloudflare:workers')return {url:'data:text/javascript,export const env = {}',shortCircuit:true};if(specifier.startsWith('@/')||specifier.startsWith('.')){const base=specifier.startsWith('@/')?resolve(specifier.slice(2)):fileURLToPath(new URL(specifier,context.parentURL));for(const candidate of [base,base+'.ts',base+'.tsx',resolve(base,'index.ts')])if(existsSync(candidate)&&/\.(ts|tsx)$/.test(candidate))return {url:pathToFileURL(candidate).href,shortCircuit:true};}return next(specifier,context);}});
