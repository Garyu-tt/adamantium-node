#!/usr/bin/env node
'use strict';
// GENESIS Operator R04: additive and least-privilege extension of Operator R01.
// Control authorization belongs to JediControl/MAS, not to this executable.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const ACTIONS=Object.freeze([
  'status','test-r02','test-r03','run-r03-moving','run-r03-dark','run-r03-bright','run-r03-checkerboard',
  'test-r04','run-r04-moving','run-r04-dark','run-r04-bright','run-r04-checkerboard'
]);
const FIXTURES=Object.freeze({'moving':'moving-bar','dark':'dark','bright':'bright','checkerboard':'checkerboard'});
const root=process.env.LOCALAPPDATA||'';
const experiment=path.join(root,'Mechanicus','experiments');
const reportRoot=path.join(root,'Mechanicus','ops','genesis-operator-r01','runs');
const EXACT_R04_SHA='5e13361a770b30dce532642874f6490cfee8e649850f47287012f7945d4a8bcc';
const EXACT_R04_COMMIT='ff731742cc9552709d5ed52eab095297b1f9087c';
const project=(kind)=>path.join(experiment,{
  r02:'genesis_neural_engine_r02',r03:'genesis_neural_circuit_r03',r04:'genesis_neural_stream_r04'
}[kind]);
function requireOK(v,m){if(!v)throw Error(m);}
function stableRunId(s){return typeof s==='string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{7,63}$/.test(s);}
function atomicLatest(o){
 const dir=path.dirname(reportRoot);fs.mkdirSync(dir,{recursive:true});
 const tmp=path.join(dir,'latest-'+process.pid+'.tmp');
 fs.writeFileSync(tmp,JSON.stringify(o,null,2)+'\n',{flag:'wx'});
 fs.renameSync(tmp,path.join(dir,'latest.json'));
}
function record(out){
 const dir=path.dirname(reportRoot);fs.mkdirSync(dir,{recursive:true});
 fs.appendFileSync(path.join(dir,'audit.jsonl'),JSON.stringify({at:new Date().toISOString(),...out})+'\n');
}
function runNode(args,cwd,timeout=45000){
 const childEnv={...process.env};delete childEnv.NODE_TEST_CONTEXT;
 const p=cp.spawnSync(process.execPath,args,{cwd,env:childEnv,encoding:'utf8',timeout,maxBuffer:2*1024*1024,windowsHide:true});
 requireOK(!p.error,`process launch failed: ${p.error?.message}`);
 requireOK(p.status===0,`operation failed (${p.status}): ${String(p.stderr||p.stdout).slice(-450)}`);
 return {stdout:p.stdout,stderr:p.stderr};
}
function ensureR04Evidence(dir){
 const p=path.join(dir,'deployment-evidence.json');
 requireOK(fs.existsSync(p),'R04 deployment evidence missing');
 let proof;try{proof=JSON.parse(fs.readFileSync(p,'utf8'))}catch{throw Error('R04 evidence invalid JSON')}
 requireOK(proof.schema==='mechanicus.genesis-r04-deployment-evidence/1','R04 evidence schema invalid');
 requireOK(proof.sha256===EXACT_R04_SHA && proof.provenance_commit===EXACT_R04_COMMIT,'R04 artifact provenance mismatch');
 requireOK(proof.result==='verified' && proof.source_genomes_unchanged===true,'R04 installation is not verified');
 const pkg=JSON.parse(fs.readFileSync(path.join(dir,'package.json'),'utf8'));
 requireOK(pkg.name==='@mechanicus/genesis-neural-stream-r04','R04 installed package name invalid');
 return proof;
}
function status(){
 const names=['r02','r03','r04'];
 const installed=Object.fromEntries(names.map(n=>[n,fs.existsSync(path.join(project(n),'package.json'))]));
 if(installed.r04){try{ensureR04Evidence(project('r04'))}catch{installed.r04=false}}
 const l=path.join(path.dirname(reportRoot),'latest.json');
 let latest=null;if(fs.existsSync(l)){try{latest=JSON.parse(fs.readFileSync(l,'utf8'))}catch{latest={corrupted:true}}}
 return {schema:'mechanicus.genesis-operator/1',available_actions:ACTIONS,installed,latest};
}
function kindOf(action){if(action==='test-r02')return 'r02';return action.includes('r04')?'r04':'r03'}
function processAction(action,requestId){
 requireOK(ACTIONS.includes(action),'requested operation is not allowlisted');
 if(action==='status')return status();
 requireOK(stableRunId(requestId),'request ID must be an 8..64 char ASCII identifier');
 const kind=kindOf(action),dir=project(kind);
 requireOK(fs.existsSync(path.join(dir,'package.json')),'required experiment is not installed');
 if(kind==='r04')ensureR04Evidence(dir);
 const logDir=path.join(reportRoot,requestId);
 fs.mkdirSync(reportRoot,{recursive:true});fs.mkdirSync(logDir); // Exclusive run IDs: no automatic retry/overwrite.
 record({request_id:requestId,action,phase:'started'});
 try{
  let result;
  if(action.startsWith('test-')){
   let tests,legacy=null;
   if(kind==='r04'){
     tests=runNode(['--test','test/r04.test.cjs'],dir,60000);
     legacy=runNode(['--test','vendor/r03/test/circuit.test.cjs'],dir,60000);
     requireOK(/(?:#|ℹ)\s+pass\s+26\b/.test(tests.stdout),'R04 test count is not 26: '+tests.stdout.slice(-280));
     requireOK(/(?:#|ℹ)\s+pass\s+15\b/.test(legacy.stdout),'R03 regression count is not 15');
   }else{
     const entries=fs.readdirSync(path.join(dir,'test')).filter(n=>n.endsWith('.test.cjs')).sort();
     tests=runNode(['--test',...entries.map(n=>path.join('test',n))],dir);
   }
   const lines=tests.stdout.split(/\r?\n/).filter(Boolean);
   result={schema:'mechanicus.genesis-operator/1',request_id:requestId,action,passed:true,
     last_lines:lines.slice(-12),...(legacy?{r03_regressions:15,r04_tests:26}:{})};
  }else if(kind==='r04'){
   const name=action.slice('run-r04-'.length),pattern=FIXTURES[name];
   requireOK(typeof pattern==='string','unknown R04 synthetic fixture');
   const outputDir=path.join(logDir,'artifacts');
   runNode(['cli.cjs','demo','--pattern',pattern,'--steps','120','--id',requestId,'--out',outputDir],dir,60000);
   const summaryFile=path.join(outputDir,requestId+'-summary.json');
   const acquiredFile=path.join(outputDir,requestId+'-acquired.json');
   requireOK(fs.existsSync(acquiredFile),'R04 acquired overlay missing');
   const report=JSON.parse(fs.readFileSync(summaryFile,'utf8'));
   requireOK(report.schema==='mechanicus.dante-r04-run/1' && report.mode==='synthetic-only','R04 run schema/mode invalid');
   requireOK(report.steps===120 && report.pattern===pattern,'R04 fixture or number of steps mismatched');
   requireOK(report.summary?.schema==='mechanicus.neural-circuit/3' && report.summary.simulation_steps===120,'R04 circuit summary invalid');
   requireOK(report.summary.genomes_unchanged===true && report.summary.sensory_stream?.accepted===120,'R04 genotype or frame count invariant failed');
   requireOK(report.summary.sensor?.raw_camera_access===false,'Unexpected hardware access indication');
   requireOK(Object.keys(report.summary.regions||{}).sort().join(',')==='LGN,V1,V2','R04 region set changed');
   const expected={'moving-bar':2646,dark:0,bright:8809,checkerboard:6173};
   requireOK(report.summary.total_spikes===expected[pattern],'R04 deterministic baseline changed');
   requireOK(/^[a-f0-9]{64}$/.test(report.trace_digest),'Invalid R04 trace digest');
   result={schema:'mechanicus.genesis-operator/1',request_id:requestId,action,passed:true,
     summary:report.summary,artifacts:{summary:summaryFile,acquired:acquiredFile},trace_digest:report.trace_digest};
  }else{
   const pattern=action==='run-r03-moving'?'moving-bar':action.slice('run-r03-'.length);
   const summaryFile=path.join(logDir,'summary.json'),traceFile=path.join(logDir,'trace.jsonl');
   const checkpointFile=path.join(logDir,'checkpoint.json');
   runNode(['cli.cjs','demo','--steps','120','--seed','42','--pattern',pattern,'--out',summaryFile,
     '--trace-out',traceFile,'--checkpoint-out',checkpointFile],dir);
   const s=JSON.parse(fs.readFileSync(summaryFile,'utf8'));
   requireOK(s.schema==='mechanicus.neural-circuit/3'&&s.genomes_unchanged&&s.simulation_steps===120,'unverified circuit output');
   result={schema:'mechanicus.genesis-operator/1',request_id:requestId,action,passed:true,summary:s,
     artifacts:{summary:summaryFile,trace:traceFile,checkpoint:checkpointFile}};
  }
  fs.writeFileSync(path.join(logDir,'result.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
  atomicLatest({request_id:requestId,action,finished_at:new Date().toISOString(),status:'passed',summary:result.summary||null});
  record({request_id:requestId,action,phase:'completed',ok:true});return result;
 }catch(e){record({request_id:requestId,action,phase:'failed',error:String(e.message).slice(0,400)});throw e;}
}
function main(){
 try{
  requireOK(root!=='','LOCALAPPDATA not set');
  requireOK(process.argv.length<=4,'no arbitrary command arguments');
  const [action,requestId]=process.argv.slice(2);
  console.log(JSON.stringify(processAction(action,requestId)));
 }catch(e){console.error('GENESIS_OPERATOR_ERROR:',e.message);process.exitCode=1;}
}
if(require.main===module)main();
module.exports={ACTIONS,status,processAction,ensureR04Evidence};
