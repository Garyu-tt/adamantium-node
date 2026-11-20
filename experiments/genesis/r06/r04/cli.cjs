#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path');
const {DanteSession}=require('./session.cjs');
const {writeImmutable}=require('./acquired-store.cjs');
const allowed=new Set(['moving-bar','bright','dark','checkerboard']);
function arg(name,otherwise){const idx=process.argv.indexOf('--'+name);return idx<0?otherwise:process.argv[idx+1]}
try{
 if(process.argv[2]!=='demo')throw Error('only demo subcommand allowed');
 const pattern=arg('pattern','moving-bar'),steps=Number(arg('steps','120'));
 if(!allowed.has(pattern))throw Error('not a synthetic fixture pattern');
 if(!Number.isSafeInteger(steps)||steps<0||steps>2000)throw Error('invalid steps');
 const runId=arg('id','r04-fixture-'+pattern);
 if(!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(runId))throw Error('invalid run id');
 const out=path.resolve(arg('out',path.join(process.cwd(),'runs')));
 const session=new DanteSession({seed:42,pattern});const result=session.runSynthetic(steps,pattern);
 const payload={schema:'mechanicus.dante-r04-run/1',mode:'synthetic-only',steps,pattern,summary:result.summary,
   trace_digest:require('./typed-sensory.cjs').digest(result.traces)};
 // Create-only on hardlinked same-directory publication; no arbitrary commands or overwritten runs.
 const filename=writeImmutable(out,runId+'-acquired',session.acquired());
 const summary=path.join(out,runId+'-summary.json');
 fs.writeFileSync(summary,JSON.stringify(payload,null,2)+'\n',{encoding:'utf8',flag:'wx'});
 console.log(JSON.stringify({ok:true,run:runId,steps,spikes:result.summary.total_spikes,acquired:filename,summary}));
}catch(e){console.error('GENESIS R04:',e.message);process.exitCode=1}
