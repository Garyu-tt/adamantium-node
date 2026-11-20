'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {NeuralCircuit}=require('../vendor/r03/lib/circuit.cjs');
const {connectionKeys,neuronRefs}=require('../vendor/r05/development-planner.cjs');
const {LiveGrowth,indexMap,topologyRecords,constructTopology,pack,unpack}=require('../lib/live-growth.cjs');
const {createHash}=require('node:crypto');
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const setup=(ticks=120)=>{const p=new LiveGrowth(new NeuralCircuit());p.circuit.run(ticks);return p};
const req=(p,target=1024,id='r06-v1-1024')=>({active_v1:target,id,base:p.revision,genome_hashes:structuredClone(p.circuit.genomeHashes)});
function changedKeys(engine){const ids=connectionKeys(engine),m=new Map();for(let i=0;i<ids.length;i++)if(Math.abs(engine.synapses[i].weight-engine.initialWeights[i])>1e-8)m.set(ids[i],engine.synapses[i].weight);return m}
test('R06 stage is side-effect free after 120 ticks of learning',()=>{
 const p=setup(),before=p.circuit.checkpoint().sha256;
 const stage=p.stage(req(p));
 assert.equal(stage.source_tick,120);assert.equal(p.circuit.checkpoint().sha256,before);
 assert.equal(stage.source_acquired.changed_synapses,591);
 assert.equal(stage.source_acquired.changed_synapses_at_risk,320);
 assert.equal(stage.target_active_v1,1024);
});
test('R06 preserves all 896 old neurons under stable population ID maps',()=>{
 const p=setup(),old=p.circuit.engines.V1,r=p.stage(req(p));
 const newer=p.pending.candidate.engines.V1,indices=indexMap(old,newer);
 const names=neuronRefs(old),target=neuronRefs(newer);
 assert.equal(new Set(indices).size,896);assert.equal(target.length,1024);
 for(let i=0;i<896;i++)assert.equal(names[i],target[indices[i]]);
 assert.equal(r.actual_union.neurons_preserved,896);assert.equal(r.actual_union.neurons_added,128);
});
test('R06 preserves soma and all dynamic compartment fields exactly by neuron identity',()=>{
 const p=setup(),s=p.circuit.engines.V1;p.stage(req(p));const d=p.pending.candidate.engines.V1,m=indexMap(s,d);
 const fields=['adapt','refractory','preTrace','postTrace','spikes','lastSpike','extCurrent','gampa','gnmda','ggabaa'];
 for(let i=0;i<m.length;i++){
  assert.deepEqual(Array.from(d.state.slice(m[i]*4,m[i]*4+4)),Array.from(s.state.slice(i*4,i*4+4)));
  for(const k of fields)assert.equal(d[k][m[i]],s[k][i],`${k} cell ${i}`);
 }
 assert.equal(d.rng.state,s.rng.state);assert.equal(d.reward,s.reward);assert.equal(d.stepIndex,s.stepIndex);
});
test('R06 retains 100% old synapses, including all learned weights',()=>{
 const p=setup(),s=p.circuit.engines.V1,pre=changedKeys(s);const out=p.stage(req(p));const d=p.pending.candidate.engines.V1,post=changedKeys(d);
 assert.equal(s.synapses.length,2343);assert.equal(out.actual_union.old_synapses_retained,2343);
 assert.equal(out.actual_union.removed_synapses,0);assert.equal(out.actual_union.new_synapses,2981);
 assert.equal(d.synapses.length,5324);assert.equal(pre.size,329); // 591 changed across LGN, V1 and V2 combined
 for(const [id,w] of pre){assert.equal(post.get(id),w,`lost learned synapse ${id}`)}
});
test('R06 copies all V1 synaptic delay slots and remaps in-flight targets',()=>{
 const p=setup(),old=p.circuit.engines.V1;p.stage(req(p));const d=p.pending.candidate.engines.V1,ids=indexMap(old,d);
 const oldEvents=old.pending.flat(),newEvents=d.pending.flat();assert.equal(oldEvents.length,196);assert.equal(oldEvents.length,newEvents.length);
 for(let slot=0;slot<old.pending.length;slot++){
  assert.equal(old.pending[slot].length,d.pending[slot].length);
  for(let i=0;i<old.pending[slot].length;i++)assert.deepEqual(d.pending[slot][i],{...old.pending[slot][i],to:ids[old.pending[slot][i].to]});
 }
});
test('R06 preserves multi-region event queue, counts, and other regional checkpoints',()=>{
 const p=setup(),old=p.circuit;const oldLGN=old.engines.LGN.checkpoint(),oldV2=old.engines.V2.checkpoint();const oldCross=structuredClone(old.queue);p.stage(req(p));const next=p.pending.candidate;
 assert.equal(next.stepNumber,120);assert.equal(next.totalFrames,old.totalFrames);
 assert.deepEqual(next.queue,oldCross);assert.deepEqual(next.delivered,old.delivered);assert.deepEqual(next.scheduled,old.scheduled);
 assert.deepEqual(next.engines.LGN.checkpoint(),oldLGN);assert.deepEqual(next.engines.V2.checkpoint(),oldV2);
});
test('R06 can commit after actual live execution, preserving circuit tick and genotype',()=>{
 const p=setup(),before=p.circuit.checkpoint().sha256;const proposal=p.stage(req(p));const commit=p.commit(proposal.sha256);
 assert.equal(commit.tick,120);assert.equal(commit.active_v1,1024);assert.equal(commit.source_unchanged,true);
 assert.equal(p.circuit.stepNumber,120);assert.equal(p.circuit.summary().genomes_unchanged,true);
 assert.equal(p.status().active_v1,1024);assert.notEqual(p.circuit.checkpoint().sha256,before);
});
test('R06 pointer rollback before next tick restores previous circuit byte for byte',()=>{
 const p=setup(),oldSha=p.circuit.checkpoint().sha256;const proposal=p.stage(req(p));p.commit(proposal.sha256);assert.equal(p.status().rollback_available,true);
 const out=p.rollback();assert.equal(out.active_v1,896);assert.equal(p.circuit.checkpoint().sha256,oldSha);assert.equal(out.revision,'r06-0');
});
test('R06 refuses rollback after new tick and preserves grown state',()=>{ const p=setup(),proposal=p.stage(req(p));p.commit(proposal.sha256);p.circuit.step();const sha=p.circuit.checkpoint().sha256;
 assert.throws(()=>p.rollback(),/unsafe/);assert.equal(p.circuit.checkpoint().sha256,sha);assert.equal(p.status().rollback_available,false);
});
test('R06 proposal is stale after concurrent simulation or reward change',()=>{
 const p=setup(),proposal=p.stage(req(p));p.circuit.step();assert.throws(()=>p.commit(proposal.sha256),/source state changed/);p.abort();
 const q=setup(),another=q.stage(req(q));q.circuit.engines.V1.setReward(.5);assert.throws(()=>q.commit(another.sha256),/source state changed/);
});
test('R06 proposed candidate tampering fails closed with no pointer switch',()=>{
 const p=setup(),proposal=p.stage(req(p));const before=p.circuit.checkpoint().sha256;p.pending.candidate.engines.V1.synapses[0].weight=.32;
 assert.throws(()=>p.commit(proposal.sha256),/candidate state changed/);assert.equal(p.circuit.checkpoint().sha256,before);
});
test('R06 refuses wrong checksum, revision and missing pending proposal',()=>{
 const p=setup();assert.throws(()=>p.commit('0'.repeat(64)),/no growth/);
 const proposal=p.stage(req(p));assert.throws(()=>p.commit('0'.repeat(64)),/checksum/);
 assert.equal(p.abort(),true);assert.equal(p.abort(),false);assert.throws(()=>p.commit(proposal.sha256),/no growth/);
});
test('R06 rejects pruning, no-op, budget overflow and malformed targets',()=>{
 const p=setup();for(const n of [896,640,0,2049,1.5,NaN,Infinity,'1024'])assert.throws(()=>p.stage(req(p,n)),/growth target/);
});
test('R06 rejects stale base, altered source hash and unapproved fields',()=>{
 const p=setup(),r=req(p);r.base='stale';assert.throws(()=>p.stage(r),/stale/);
 r.base=p.revision;r.genome_hashes.V1='bad';assert.throws(()=>p.stage(r),/genome binding/);
 r.genome_hashes=structuredClone(p.circuit.genomeHashes);r.shell='powershell';assert.throws(()=>p.stage(r),/not allowlisted/);
});
test('R06 rejects invalid identifiers and simultaneous staged writes',()=>{
 const p=setup();assert.throws(()=>p.stage(req(p,1024,'../../bad')),/id/);
 p.stage(req(p));assert.throws(()=>p.stage(req(p,1152,'r06-v1-1152')),/pending growth/);
});
test('R06 snapshot restores exact structural union and weights on isolated runtime',()=>{
 const p=setup(),r=p.stage(req(p));p.commit(r.sha256);
 const frozen=p.snapshot();const resumed=LiveGrowth.resume(frozen);
 assert.equal(resumed.circuit.checkpoint().sha256,p.circuit.checkpoint().sha256);
 assert.deepEqual(connectionKeys(resumed.circuit.engines.V1),connectionKeys(p.circuit.engines.V1));
 assert.equal(resumed.revision,p.revision);assert.equal(frozen.topology.V1.length,5324);
});
test('R06 saved growth state resumes and reproduces later spikes deterministically',()=>{
 const p=setup(),plan=p.stage(req(p));p.commit(plan.sha256);const q=LiveGrowth.resume(p.snapshot());
 const ar=p.circuit.run(12),br=q.circuit.run(12);
 assert.deepEqual(ar.telemetry,br.telemetry);
 assert.equal(p.circuit.checkpoint().sha256,q.circuit.checkpoint().sha256);
});
test('R06 mutated snapshot checksum is rejected before restore',()=>{
 const p=setup(),plan=p.stage(req(p));p.commit(plan.sha256);const s=p.snapshot();s.topology.V1[0].weight=.87;
 assert.throws(()=>LiveGrowth.resume(s),/snapshot hash mismatch/);
});
test('R06 forged snapshot with valid fresh checksum but missing neuronal reference fails closed',()=>{
 const p=setup(),plan=p.stage(req(p));p.commit(plan.sha256);const s=p.snapshot();s.topology.V1[0].from='L4.E@987654';const {sha256,...rest}=s;s.sha256=sha(rest);
 assert.throws(()=>LiveGrowth.resume(s),/neuron missing/);
});
test('R06 forged snapshot with synaptic identity collision is rejected',()=>{
 const p=setup(),plan=p.stage(req(p));p.commit(plan.sha256);const s=p.snapshot();s.topology.V1[1]={...s.topology.V1[0]};const {sha256,...rest}=s;s.sha256=sha(rest);
 assert.throws(()=>LiveGrowth.resume(s),/duplicate synapse identity/);
});
test('R06 snapshot creation forbids pending uncommitted proposals',()=>{
 const p=setup();p.stage(req(p));assert.throws(()=>p.snapshot(),/staged candidate/);
});
test('R06 only accepts real R03 NeuralCircuit object',()=>{assert.throws(()=>new LiveGrowth({}),/NeuralCircuit/)});
test('R06 two same-seed growth plans produce identical hashes and topology',()=>{
 const p=setup(),q=setup(),x=p.stage(req(p)),y=q.stage(req(q));assert.equal(x.sha256,y.sha256);
 assert.deepEqual(connectionKeys(p.pending.candidate.engines.V1),connectionKeys(q.pending.candidate.engines.V1));
});
test('R06 original source object is unchanged by staging, committing, or executing grown clone',()=>{
 const p=setup(),old=p.circuit,oldHash=old.checkpoint().sha256;const req0=p.stage(req(p));p.commit(req0.sha256);p.circuit.run(5);
 assert.equal(old.checkpoint().sha256,oldHash);
});
test('R06 no physical camera, sensor or external worker required',()=>{
 const p=setup(),t=p.stage(req(p));assert.match(t.policy,/CPU-only/);assert.match(t.atomic_commit_scope,/local in-process/);
 assert.equal(p.circuit.summary().sensor.raw_camera_access,false);
});
test('R06 can grow again after restoring a migrated brain (1024 -> 1152)',()=>{
 const p=setup();const a=p.stage(req(p));p.commit(a.sha256);p.circuit.run(9);
 const snap=p.snapshot();const recovered=LiveGrowth.resume(snap);
 const sourceSnapshot=recovered.circuit.checkpoint().sha256;
 const plan=recovered.stage(req(recovered,1152,'r06-v1-1152'));
 assert.equal(plan.actual_union.neurons_preserved,1024);assert.equal(plan.actual_union.neurons_added,128);
 assert.equal(plan.actual_union.removed_synapses,0);
 recovered.commit(plan.sha256);
 const prevOldKeys=connectionKeys(p.circuit.engines.V1),newKeys=connectionKeys(recovered.circuit.engines.V1);
 assert.deepEqual(newKeys.slice(0,prevOldKeys.length),prevOldKeys);
 assert.ok(recovered.circuit.summary().genomes_unchanged);
 const restored=LiveGrowth.resume(recovered.snapshot());
 assert.equal(restored.circuit.checkpoint().sha256,recovered.circuit.checkpoint().sha256);
 assert.notEqual(recovered.circuit.checkpoint().sha256,sourceSnapshot);
});
test('R06 forged snapshot rejects neurotransmitter mismatch even with recomputed checksum',()=>{
 const p=setup(),plan=p.stage(req(p));p.commit(plan.sha256);const s=p.snapshot();s.topology.V1[0].kind=s.topology.V1[0].kind==='GABA'?'GLUTAMATE':'GABA';
 const {sha256,...rest}=s;s.sha256=sha(rest);
 assert.throws(()=>LiveGrowth.resume(s),/neurotransmitter type mismatch/);
});
test('R06 forged snapshot rejects synaptic delay disagreement with declared projection',()=>{
 const p=setup(),plan=p.stage(req(p));p.commit(plan.sha256);const s=p.snapshot();s.topology.V1[0].delay+=1;
 const {sha256,...rest}=s;s.sha256=sha(rest);
 assert.throws(()=>LiveGrowth.resume(s),/delay violates projection/);
});
