// Vite 8 probes mapped drives with `net use`. A denied optional probe must behave like its callback error path.
// This does not change application code or grant process permissions, and is unused on the hosted Linux builder.
import childProcess from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {EventEmitter} from 'node:events';
if(process.platform==='win32'){
 const original=childProcess.exec;
 childProcess.exec=function(command,...args){try{return original.call(this,command,...args);}catch(error){if(command!=='net use'||error.code!=='EPERM')throw error;const callback=args.findLast(arg=>typeof arg==='function');queueMicrotask(()=>callback?.(error,'',''));return new EventEmitter();}};
 syncBuiltinESMExports();
}
