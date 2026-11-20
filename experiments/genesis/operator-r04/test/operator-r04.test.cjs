'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process');
const operator=path.resolve(__dirname,'../operator.cjs');
const source=process.env.GENESIS_TEST_R04_PATH;
const evidence={schema:'mechanicus.genesis-r04-deployment-evidence/1',
 provenance_commit:'ff731742cc9552709d5ed52eab095297b1f9087c',
 sha256:'5e13361a770b30dce532642874f6490cfee8e649850f47287012f7945d4a8bcc',
 result:'verified',source_genomes_unchanged:true};
function call(root,action,id){
 const argv=[operator,action,...(id?[id]:[])];
 return cp.spawnSync(process.execPath,argv,{env:{...process.env,LOCALAPPDATA:root},encoding:'utf8',timeout:90000});
}
function passed(root,action,id){
 const r=call(root,action,id);
 assert.equal(r.status,0,`${action}: ${r.stderr?.slice(0,800)}`);
 const j=JSON.parse(r.stdout.trim());
 assert.equal(j.passed,true);assert.equal(j.action,action);assert.equal(j.request_id,id);
 return j;
}
function fails(root,action,id,reason){
 const r=call(root,action,id);
 assert.notEqual(r.status,0,`${action} should have failed`);
 assert.match(r.stderr,new RegExp(reason));
}
// Keep test isolated: no production Windows operator is modified and no camera is accessed.
test('R04 extension preserves legacy actions, enforces pinned evidence and runs only synthetic fixtures',async()=>{
 assert.ok(source&&fs.existsSync(path.join(source,'package.json')),'GENESIS_TEST_R04_PATH must point to verified R04 source');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'genesis-op-r04-'));
 try{
  const dst=path.join(root,'Mechanicus','experiments','genesis_neural_stream_r04');
  fs.mkdirSync(path.dirname(dst),{recursive:true});fs.cpSync(source,dst,{recursive:true});
  fs.writeFileSync(path.join(dst,'deployment-evidence.json'),JSON.stringify(evidence));
  const r03=path.join(root,'Mechanicus','experiments','genesis_neural_circuit_r03');
  fs.cpSync(path.join(source,'vendor','r03'),r03,{recursive:true});
  const status=call(root,'status');assert.equal(status.status,0);
  const info=JSON.parse(status.stdout);
  for(const action of ['test-r02','test-r03','run-r03-moving','run-r03-dark','run-r03-bright','run-r03-checkerboard',
   'test-r04','run-r04-moving','run-r04-dark','run-r04-bright','run-r04-checkerboard']){
   assert.ok(info.available_actions.includes(action));
  }
  assert.equal(info.installed.r04,true);assert.equal(info.installed.r03,true);
  const tests=passed(root,'test-r04','r04test01');assert.equal(tests.r04_tests,26);assert.equal(tests.r03_regressions,15);
  passed(root,'test-r03','r03test01');
  const older=passed(root,'run-r03-moving','r03moving01');assert.equal(older.summary.total_spikes,2646);
  for(const [kind,spikes] of [['moving',2646],['dark',0],['bright',8809],['checkerboard',6173]]){
   const action='run-r04-'+kind,id='r04-'+kind+'-test01';
   const res=passed(root,action,id);
   assert.equal(res.summary.total_spikes,spikes);
   assert.equal(res.summary.genomes_unchanged,true);
   assert.equal(res.summary.sensory_stream.accepted,120);
   assert.equal(res.summary.sensor.raw_camera_access,false);
   assert.ok(fs.existsSync(res.artifacts.summary));assert.ok(fs.existsSync(res.artifacts.acquired));
  }
  const last=JSON.parse(fs.readFileSync(path.join(root,'Mechanicus','ops','genesis-operator-r01','latest.json'),'utf8'));
  assert.equal(last.action,'run-r04-checkerboard');assert.equal(last.summary.total_spikes,6173);
  fails(root,'run-r04-moving','r04-moving-test01','EEXIST');
  fails(root,'run-r04-powershell','r04-no-shell-01','not allowlisted');
  fails(root,'test-r04','../../traversal','request ID');
  fails(root,'test-r04','xx','request ID');
  fs.writeFileSync(path.join(dst,'deployment-evidence.json'),JSON.stringify({...evidence,sha256:'0'.repeat(64)}));
  fails(root,'test-r04','r04-badhash01','provenance mismatch');
  const s=JSON.parse(call(root,'status').stdout);assert.equal(s.installed.r04,false);
 }finally{fs.rmSync(root,{force:true,recursive:true})}
});
