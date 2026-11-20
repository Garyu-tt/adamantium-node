'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process');
const {DanteSession}=require('../session.cjs');
const {makeFrame,verifyFrame,BoundedSensoryStream}=require('../typed-sensory.cjs');
const {captureAcquired,verifyAcquired,applyAcquired,writeImmutable,readImmutable}=require('../acquired-store.cjs');
const {RevisionManager}=require('../revision-manager.cjs');
const {NeuralCircuit,patternFrame}=require('../../vendor/r03/lib/circuit.cjs');
const frame=(seq,tick,pattern='moving-bar')=>makeFrame({sequence:seq,tick,pixels:patternFrame(pattern,tick)});
const currentPolicy=(s,gain=1,reward={LGN:0,V1:0,V2:0})=>({id:'r04-new-policy',base:s.revisions.current,genome_hashes:structuredClone(s.circuit.genomeHashes),policy:{reward,sensory_gain:gain}});

test('typed synthetic sensory frame seals full normalized sample',()=>{
 const f=frame(0,0);assert.equal(f.schema,'mechanicus.sensor-frame/1');assert.equal(f.pixels.length,64);
 assert.equal(verifyFrame(f,0,0).sha256,f.sha256);
});
test('rejects unknown and hardware-origin sensor input',()=>{
 assert.throws(()=>makeFrame({sequence:0,tick:0,pixels:Array(64).fill(0),source:'camera'}),/only synthetic/);
 assert.throws(()=>makeFrame({sequence:0,tick:0,pixels:Array(64).fill(0),channel:'microphone'}),/unsupported/);
 assert.throws(()=>verifyFrame({...frame(0,0),camera:true},0,0),/unknown or missing/);
});
test('rejects invalid floating-point input, out-of-range, and wrong sensor shape',()=>{
 for(const value of [NaN,Infinity,-1,1.001,'0'])assert.throws(()=>makeFrame({sequence:0,tick:0,pixels:Array(64).fill(value)}));
 assert.throws(()=>makeFrame({sequence:0,tick:0,pixels:Array(63).fill(.5)}),/64/);
});
test('refuses tampering with sensor payload and digest',()=>{
 const f=frame(0,0);f.pixels[0]=.125;assert.throws(()=>verifyFrame(f,0,0),/integrity/);
 const k=frame(0,0);k.sha256='x'.repeat(64);assert.throws(()=>verifyFrame(k,0,0),/integrity/);
});
test('strict ordering detects duplicate, missing or stale stream ticks',()=>{
 const s=new DanteSession();s.enqueue(frame(0,0));s.step();
 assert.throws(()=>s.enqueue(frame(0,1)),/out-of-order/);
 assert.throws(()=>s.enqueue(frame(2,1)),/out-of-order/);
 assert.throws(()=>s.enqueue(frame(1,0)),/tick/);
 assert.equal(s.stream.status().next_sequence,1);
});
test('bounded backpressure rejects a ninth queued frame before stepping',()=>{
 const s=new DanteSession();for(let i=0;i<8;i++)s.enqueue(frame(i,i));
 assert.throws(()=>s.enqueue(frame(8,8)),/backpressure/);assert.equal(s.circuit.stepNumber,0);
 assert.equal(s.step().sensor_frame.sequence,0);assert.equal(s.stream.status().queued,7);
});
test('invalid frame leaves circuit and queue unchanged',()=>{
 const s=new DanteSession();const bad=frame(0,0);bad.sha256='bad';
 const before=s.circuit.checkpoint().sha256;
 assert.throws(()=>s.enqueue(bad),/integrity/);
 assert.equal(s.circuit.checkpoint().sha256,before);assert.equal(s.stream.queue.length,0);
});
test('stream produces exact 120-step R03 baseline with no policy changes',()=>{
 const r=new NeuralCircuit(),s=new DanteSession();const a=r.run(120),b=s.runSynthetic(120);
 assert.equal(b.summary.total_spikes,2646);assert.equal(b.summary.total_spikes,a.summary.total_spikes);
 assert.deepEqual(b.summary.cross_region_links,a.summary.cross_region_links);
 assert.equal(s.circuit.checkpoint().sha256,r.checkpoint().sha256);
 assert.equal(b.summary.sensory_stream.accepted,120);
});
test('dark sensory stream is silent and never uses raw hardware access',()=>{
 const s=new DanteSession({pattern:'dark'});s.runSynthetic(40,'dark');
 assert.equal(s.summary().total_spikes,0);assert.equal(s.summary().sensor.raw_camera_access,false);
 assert.equal(s.stream.status().hardware_access,false);
});
test('identical seeds and typed streams reproduce all circuit checkpoints',()=>{
 const a=new DanteSession(),b=new DanteSession();a.runSynthetic(32);b.runSynthetic(32);
 assert.equal(a.circuit.checkpoint().sha256,b.circuit.checkpoint().sha256);
 assert.equal(a.acquired().sha256,b.acquired().sha256);
});
test('acquired region overlay has its own immutable schema and changed weights',()=>{
 const s=new DanteSession();s.runSynthetic(120);const rec=s.acquired();
 assert.equal(rec.schema,'mechanicus.acquired-circuit/2');assert.equal(rec.step,120);
 assert.equal(rec.regions.LGN.changed_synapses,230);assert.equal(rec.regions.V1.changed_synapses,329);
 assert.equal(rec.regions.V2.changed_synapses,32);assert.equal(s.summary().genomes_unchanged,true);
 assert.equal(verifyAcquired(new DanteSession().circuit,rec).length,3);
});
test('save acquired overlay create-only and verify data after read',()=>{
 const s=new DanteSession();s.runSynthetic(20);const record=s.acquired();const dir=fs.mkdtempSync(path.join(os.tmpdir(),'genesis-r04-'));
 try{const p=writeImmutable(dir,'acquired-dante',record);assert.ok(fs.existsSync(p));
 assert.deepEqual(readImmutable(p),record);assert.throws(()=>writeImmutable(dir,'acquired-dante',record),/EEXIST/);
 }finally{fs.rmSync(dir,{force:true,recursive:true})}
});
test('read fails closed on changed acquired artifact, even if JSON is valid',()=>{
 const s=new DanteSession();s.runSynthetic(20);const rec=s.acquired();const dir=fs.mkdtempSync(path.join(os.tmpdir(),'genesis-r04-'));
 try{const p=writeImmutable(dir,'acquired-dante',rec);const bad=readImmutable(p);bad.regions.LGN.changed_synapses++;
 fs.writeFileSync(p,JSON.stringify(bad));assert.throws(()=>readImmutable(p),/integrity/);
 }finally{fs.rmSync(dir,{force:true,recursive:true})}
});
test('rehydrates exact learned synapse weights onto matching fresh circuit',()=>{
 const s=new DanteSession();s.runSynthetic(100);const rec=s.acquired();const target=new DanteSession();
 target.applyAcquired(rec);for(const [key,e] of Object.entries(s.circuit.engines)){
  assert.deepEqual(target.circuit.engines[key].synapses.map(x=>x.weight),e.synapses.map(x=>x.weight));
 }
 assert.equal(target.circuit.stepNumber,0);assert.equal(target.summary().genomes_unchanged,true);
});
test('mismatched seed, topology, or missing region rejects acquired overlays atomically',()=>{
 const s=new DanteSession();s.runSynthetic(20);const rec=s.acquired();const different=new DanteSession({seed:44});
 assert.throws(()=>different.applyAcquired(rec),/seed/);
 const t=new DanteSession(),before=t.circuit.checkpoint().sha256;
 const invalid=structuredClone(rec);invalid.regions.V2.synapse_count++;
 const {digest}=require('../typed-sensory.cjs');invalid.sha256=digest((({sha256,...rest})=>rest)(invalid));
 assert.throws(()=>t.applyAcquired(invalid),/topology/);assert.equal(t.circuit.checkpoint().sha256,before);
 delete invalid.regions.V1;invalid.sha256=digest((({sha256,...rest})=>rest)(invalid));
 assert.throws(()=>t.applyAcquired(invalid),/region set/);
});
test('acquired overlays must not replace the full dynamic neuronal checkpoint',()=>{
 const s=new DanteSession();s.runSynthetic(10);const record=s.acquired();
 assert.throws(()=>s.applyAcquired(record),/fresh circuit/);
 assert.equal(record.regions.LGN.weights.length>0,true);
});
test('runtime revision is allowlisted, scoped to current source genome',()=>{
 const s=new DanteSession();s.runSynthetic(5);const stage=s.stageRevision(currentPolicy(s,.8,{LGN:.1,V1:-.2,V2:.3}));
 assert.equal(stage.commit_at_tick,5);const commit=s.commitRevision();
 assert.equal(commit.at_tick,5);assert.equal(s.revisions.policy.sensory_gain,.8);
 assert.equal(s.circuit.engines.V1.reward,-.2);assert.equal(s.revisions.status().version,1);
 assert.equal(s.summary().genomes_unchanged,true);
});
test('rejects revision with nonallowlisted, unbounded, or wrong-genome fields',()=>{
 const s=new DanteSession();const item=currentPolicy(s);item.policy.execution='powershell';
 assert.throws(()=>s.stageRevision(item),/not allowlisted/);assert.equal(s.revisions.pending,null);
 const bad=currentPolicy(s,1.2);assert.throws(()=>s.stageRevision(bad),/gain/);
 const mutated=currentPolicy(s);mutated.genome_hashes.V1='wrong';assert.throws(()=>s.stageRevision(mutated),/genome/);
});
test('stale policy base and concurrent staged revisions are rejected',()=>{
 const s=new DanteSession();const a=currentPolicy(s);
 a.base='outdated';assert.throws(()=>s.stageRevision(a),/stale/);
 s.stageRevision(currentPolicy(s));assert.throws(()=>s.stageRevision(currentPolicy(s)),/pending revision/);
 assert.equal(s.revisions.abort(),true);assert.equal(s.revisions.abort(),false);
});
test('no policy hot swap while sensory events are queued',()=>{
 const s=new DanteSession();s.enqueue(frame(0,0));s.stageRevision(currentPolicy(s));
 assert.throws(()=>s.commitRevision(),/queued/);assert.equal(s.circuit.stepNumber,0);
 s.step();s.commitRevision();assert.equal(s.revisions.status().version,1);
});
test('policy failure rolls back full circuit state and keeps prior revision',()=>{
 const s=new DanteSession();s.runSynthetic(12);const cp=s.circuit.checkpoint().sha256;
 s.stageRevision(currentPolicy(s,.5,{LGN:.3,V1:.2,V2:.1}));
 const engine=s.circuit.engines.V2;const original=engine.setReward;engine.setReward=()=>{throw Error('simulated failure')};
 try{assert.throws(()=>s.commitRevision(),/simulated failure/)}finally{engine.setReward=original}
 assert.equal(s.circuit.checkpoint().sha256,cp);assert.equal(s.revisions.current,'r04-policy-0');
 assert.equal(s.revisions.pending,null);assert.equal(s.revisions.history.length,0);
});
test('CLI creates a run and refuses overwrite of a previously published run',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'genesis-r04-'));
 try{const argv=[path.join(__dirname,'../cli.cjs'),'demo','--steps','12','--pattern','moving-bar','--out',dir,'--id','r04-run-test'];
 const r=cp.spawnSync(process.execPath,argv,{encoding:'utf8'});assert.equal(r.status,0,r.stderr);
 const result=JSON.parse(r.stdout);assert.equal(result.ok,true);assert.equal(readImmutable(result.acquired).step,12);
 const rerun=cp.spawnSync(process.execPath,argv,{encoding:'utf8'});assert.equal(rerun.status,1);assert.match(rerun.stderr,/EEXIST/);
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});

test('full R04 checkpoint replays exactly including runtime policy and sensory sequence',()=>{
 const {checkpointSession,resumeSession}=require('../session-checkpoint.cjs');
 const a=new DanteSession();a.runSynthetic(18);
 a.stageRevision(currentPolicy(a,.75,{LGN:.1,V1:.25,V2:0}));a.commitRevision();
 a.runSynthetic(14);const snap=checkpointSession(a);const b=resumeSession(snap);
 assert.deepEqual(b.summary(),a.summary());
 a.runSynthetic(13);b.runSynthetic(13);
 assert.equal(a.circuit.checkpoint().sha256,b.circuit.checkpoint().sha256);
 assert.deepEqual(a.revisions.status(),b.revisions.status());
});
test('queued but unconsumed sensory frames survive R04 checkpoint',()=>{
 const {checkpointSession,resumeSession}=require('../session-checkpoint.cjs');
 const a=new DanteSession();a.runSynthetic(6);
 a.enqueue(frame(6,6));a.enqueue(frame(7,7));
 const b=resumeSession(checkpointSession(a));
 assert.equal(b.stream.status().queued,2);
 for(let i=0;i<2;i++){a.step();b.step()}
 assert.equal(a.circuit.checkpoint().sha256,b.circuit.checkpoint().sha256);
});
test('tampered or incompatible R04 checkpoint is rejected before restoring',()=>{
 const {checkpointSession,resumeSession}=require('../session-checkpoint.cjs');
 const s=new DanteSession();s.runSynthetic(8);const cp=checkpointSession(s);
 cp.sequence++;assert.throws(()=>resumeSession(cp),/integrity/);
 const valid=checkpointSession(s);valid.revisions.policy.reward.V1=.33;
 valid.sha256=require('../typed-sensory.cjs').digest((({sha256,...p})=>p)(valid));
 assert.throws(()=>resumeSession(valid),/reward differs/);
});
test('session checkpoint refuses incomplete pending policy transaction',()=>{
 const {checkpointSession}=require('../session-checkpoint.cjs');const s=new DanteSession();
 s.stageRevision(currentPolicy(s));assert.throws(()=>checkpointSession(s),/pending revision/);
});
