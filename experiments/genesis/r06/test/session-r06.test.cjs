'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {LiveSessionGrowth}=require('../lib/session-growth.cjs');
const {patternFrame}=require('../vendor/r03/lib/circuit.cjs');
const {DanteSession}=require('../r04/session.cjs');
const {createHash}=require('node:crypto');
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const prep=()=>{const s=new LiveSessionGrowth();s.session.runSynthetic(120);return s};
const request=x=>({id:'r06-v1-1024',base:x.growth.revision,active_v1:1024,genome_hashes:structuredClone(x.session.circuit.genomeHashes)});
test('R06 R04 sensory queue survives physical-cell growth at a synchronous tick boundary',()=>{
 const m=prep();for(let i=0;i<3;i++)m.session.enqueue(m.session.frame(patternFrame('checkerboard',120+i)));
 const prior=m.session.stream.queue.map(x=>x.sha256);const old=m.session.circuit.checkpoint().sha256;
 const p=m.stage(request(m));assert.equal(p.sensory_frames_queued,3);
 const out=m.commit(p.sha256);assert.equal(out.sensory_queue_preserved,3);
 assert.deepEqual(m.session.stream.queue.map(x=>x.sha256),prior);
 assert.equal(m.session.stream.circuit,m.session.circuit);assert.equal(m.session.revisions.circuit,m.session.circuit);
 assert.equal(m.session.circuit.stepNumber,120);assert.notEqual(m.session.circuit.checkpoint().sha256,old);
});
test('R06 queued R04 sensory frame produces same replay after migrated snapshot',()=>{
 const m=prep();for(let i=0;i<3;i++)m.session.enqueue(m.session.frame(patternFrame('moving-bar',120+i)));
 const p=m.stage(request(m));m.commit(p.sha256);
 const twin=LiveSessionGrowth.resume(m.snapshot());
 for(let i=0;i<3;i++)assert.deepEqual(m.session.step(),twin.session.step());
 assert.equal(m.session.circuit.checkpoint().sha256,twin.session.circuit.checkpoint().sha256);
 assert.equal(m.session.stream.queue.length,0);
});
test('R06 retains R04 committed reward and sensory gain policy after growth',()=>{
 const m=prep();const r=m.session.revisions;
 r.stage({id:'r04-nonlinear-test',base:r.current,genome_hashes:structuredClone(m.session.circuit.genomeHashes),policy:{sensory_gain:0.7,reward:{LGN:0.1,V1:0.6,V2:-0.1}}});r.commit();
 const p=m.stage(request(m));m.commit(p.sha256);
 const resumed=LiveSessionGrowth.resume(m.snapshot());
 assert.deepEqual(resumed.session.revisions.status(),m.session.revisions.status());
 assert.equal(resumed.session.circuit.engines.V1.reward,0.6);
 assert.equal(resumed.session.revisions.policy.sensory_gain,0.7);
});
test('R06 rejects R04 policy commit while growth proposal is staged',()=>{
 const m=prep();const p=m.stage(request(m)),before=m.session.circuit.checkpoint().sha256;
 const rev=m.session.revisions;
 rev.stage({id:'r04-other',base:rev.current,genome_hashes:structuredClone(m.session.circuit.genomeHashes),policy:{sensory_gain:1,reward:{LGN:0,V1:0,V2:0}}});
 assert.throws(()=>m.commit(p.sha256),/runtime policy revision pending/);
 assert.equal(m.session.circuit.checkpoint().sha256,before);
 rev.abort();assert.equal(m.abort(),true);
});
test('R06 refuses migration if R04 sensory queue changes after stage',()=>{
 const m=prep();const p=m.stage(request(m));m.session.enqueue(m.session.frame(patternFrame('moving-bar',120)));
 assert.throws(()=>m.commit(p.sha256),/session frames\/policy changed/);
 assert.equal(m.growth.circuit.engines.V1.active,896);
});
test('R06 integrated rollback preserves R04 sensor records and policy at old brain',()=>{
 const m=prep();const original=m.session.circuit.checkpoint().sha256;
 m.session.enqueue(m.session.frame(patternFrame('bright',120)));
 const p=m.stage(request(m));m.commit(p.sha256);const out=m.rollback();
 assert.equal(out.active_v1,896);assert.equal(m.session.circuit.checkpoint().sha256,original);
 assert.equal(m.session.stream.queue.length,1);
 assert.equal(m.session.stream.circuit,m.session.circuit);
});
test('R06 refuses integrated rollback once sensory input was consumed',()=>{
 const m=prep();m.session.enqueue(m.session.frame(patternFrame('bright',120)));
 const p=m.stage(request(m));m.commit(p.sha256);m.session.step();const saved=m.session.circuit.checkpoint().sha256;
 assert.throws(()=>m.rollback(),/session changed|unsafe/);assert.equal(m.session.circuit.checkpoint().sha256,saved);
});
test('R06 session snapshot rejects policy tampering even when top-level digest is recomputed',()=>{
 const m=prep();const p=m.stage(request(m));m.commit(p.sha256);
 const snap=m.snapshot();snap.policy.policy.sensory_gain=2;
 const {sha256,...payload}=snap;snap.sha256=digest(payload);
 assert.throws(()=>LiveSessionGrowth.resume(snap),/sensory gain out of bounds/);
});
test('R06 session snapshot rejects corrupted queued frame even if wrapper digest recomputed',()=>{
 const m=prep();m.session.enqueue(m.session.frame(patternFrame('bright',120)));
 const p=m.stage(request(m));m.commit(p.sha256);
 const snap=m.snapshot();snap.sensory.queue[0].pixels[0]=0.5;
 const {sha256,...payload}=snap;snap.sha256=digest(payload);
 assert.throws(()=>LiveSessionGrowth.resume(snap),/sensor frame integrity mismatch/);
});
test('R06 preserves original R04 session through stage/abort without mutation',()=>{
 const s=new DanteSession();s.runSynthetic(15);const m=new LiveSessionGrowth(s),before=s.circuit.checkpoint().sha256;
 const p=m.stage(request(m));assert.equal(p.source_tick,15);assert.equal(m.abort(),true);
 assert.equal(s.circuit.checkpoint().sha256,before);assert.equal(s.stream.accepted,15);
});
