'use strict';
/**
 * GENESIS R06 — append-only structural growth across a stopped, synchronous tick boundary.
 * No actual concurrently running live replacement, no pruning, no background mutation.
 * Stable neuron IDs = (population.id, ordinal within that population).
 * Stable synthetic synapse IDs = (projection, neuron IDs, kind, delay).
 * Not a biological connectome. The newly compiled random graph is unioned with all old edges.
 */
const {createHash}=require('node:crypto');
const {NeuralCircuit}=require('../vendor/r03/lib/circuit.cjs');
const {neuronRefs,connectionKeys,candidateStats}=require('../vendor/r05/development-planner.cjs');
const SCHEMA='mechanicus.genesis-live-growth/1';
const SNAPSHOT='mechanicus.genesis-growth-snapshot/1';
const STRUCTURE='mechanicus.genesis-growth-structure/1';
const MAX_ACTIVE=2048;
const MAX_SYN=200000;
const sha=obj=>createHash('sha256').update(JSON.stringify(obj)).digest('hex');
const check=(cond,msg)=>{if(!cond)throw new Error(msg)};
const object=x=>!!x&&typeof x==='object'&&!Array.isArray(x);
function indexMap(oldEngine,newEngine){
 const oldRefs=neuronRefs(oldEngine),newRefs=neuronRefs(newEngine);
 const map=new Map(newRefs.map((v,i)=>[v,i]));
 check(map.size===newRefs.length,'ambiguous target neuron identity');
 const indices=oldRefs.map(ref=>map.get(ref));
 check(indices.every(Number.isSafeInteger),'growth would remove a preexisting neuron');
 check(new Set(indices).size===oldRefs.length,'neuron identity collision');
 return indices;
}
function copyDynamics(src,dst,indices){
 // Transfer state in units of stable neuron identity, not array offset.
 const fields=['adapt','refractory','preTrace','postTrace','spikes','lastSpike','extCurrent','gampa','gnmda','ggabaa'];
 for(let i=0;i<indices.length;i++){
  const newIdx=indices[i];
  dst.state.set(src.state.subarray(i*4,i*4+4),newIdx*4);
  for(const field of fields)dst[field][newIdx]=src[field][i];
 }
 check(src.pending.length===dst.pending.length,'synaptic ring length mismatch');
 dst.pending=src.pending.map(slot=>slot.map(ev=>{
  check(Number.isSafeInteger(indices[ev.to]),'event target lost during growth');
  return {...ev,to:indices[ev.to]};
 }));
 dst.stepIndex=src.stepIndex;
 dst.totalSpikes=src.totalSpikes;
 dst.rng.state=src.rng.state;
 dst.reward=src.reward;
}
function constructTopology(dst,records){
 check(Array.isArray(records)&&records.length>0&&records.length<=Math.min(dst.options.maxSynapses,MAX_SYN),'topology budget exceeded');
 const refs=neuronRefs(dst),toIndex=new Map(refs.map((ref,i)=>[ref,i]));
 const project= new Map(dst.region.projections.map(p=>[p.id,p]));
 const seen=new Set(),synapses=[],initialWeights=[],perProjection={};
 for(const item of records){
  check(object(item)&&Object.keys(item).sort().join(',')==='delay,from,initialWeight,kind,projection,to,weight','topology fields not allowed');
  check(typeof item.from==='string'&&typeof item.to==='string'&&typeof item.projection==='string','topology identity invalid');
  const from=toIndex.get(item.from),to=toIndex.get(item.to);
  check(Number.isInteger(from)&&Number.isInteger(to),'topology source or target neuron missing');
  check(project.has(item.projection),'unknown projection');
  const proj=project.get(item.projection);
  check((item.from.startsWith(proj.source+'@'))&&(item.to.startsWith(proj.target+'@')),'projection population identity mismatch');
  check(proj.rule?.mode==='probabilistic'&&Number.isFinite(proj.rule.probability),'nonmaterialized projection rejected');
  const sourcePop=dst.map.get(proj.source),targetPop=dst.map.get(proj.target);
  check(!!sourcePop&&!!targetPop,'projection population unavailable');
  check(item.kind===(sourcePop.kind==='inhibitory'?'GABA':'GLUTAMATE'),'projection neurotransmitter type mismatch');
  check(targetPop.receptors.has(item.kind==='GABA'?'GABA-A':'AMPA'),'postsynaptic receptor missing');
  const requiredDelay=Math.max(1,Math.ceil((proj.rule.delay_ms??1)/dst.options.dtMs));
  check(Number.isInteger(item.delay)&&item.delay===requiredDelay&&item.delay<=dst.options.maxDelayTicks,'synaptic delay violates projection');
  check(Number.isFinite(item.weight)&&item.weight>=0&&item.weight<=1.5,'invalid current weight');
  check(Number.isFinite(item.initialWeight)&&item.initialWeight>=0&&item.initialWeight<=1.5,'invalid original weight');
  const key=[item.projection,item.from,item.to,item.kind,item.delay].join('|');
  check(!seen.has(key),'duplicate synapse identity');seen.add(key);
  synapses.push({from,to,weight:item.weight,initialWeight:item.initialWeight,kind:item.kind,delay:item.delay,projection:item.projection});
  initialWeights.push(item.initialWeight);
  perProjection[item.projection]=(perProjection[item.projection]||0)+1;
 }
 dst.synapses=synapses;dst.initialWeights=initialWeights;
 dst.outgoing=Array.from({length:dst.active},()=>[]);
 dst.incoming=Array.from({length:dst.active},()=>[]);
 dst.perProjection=perProjection;
 for(let i=0;i<synapses.length;i++){
  const s=synapses[i];dst.outgoing[s.from].push(i);dst.incoming[s.to].push(i);
 }
 check(connectionKeys(dst).length===synapses.length,'topology reconstruction failed');
 return synapses.length;
}
function topologyRecords(engine){
 const refs=neuronRefs(engine);
 return engine.synapses.map(s=>({projection:s.projection,from:refs[s.from],to:refs[s.to],kind:s.kind,delay:s.delay,
  weight:s.weight,initialWeight:s.initialWeight}));
}
function transplant(src,dst){
 check(src.regionHash===dst.regionHash,'source genotype differs');
 check(src.options.dtMs===dst.options.dtMs&&src.pending.length===dst.pending.length,'synapse timing contract differs');
 check(dst.active>=src.active,'live pruning not supported');
 const indices=indexMap(src,dst);
 const old=topologyRecords(src),next=topologyRecords(dst);
 const key=x=>[x.projection,x.from,x.to,x.kind,x.delay].join('|');
 const seen=new Set(old.map(key));
 check(seen.size===old.length,'ambiguous inherited synapse identity');
 const newOnly=next.filter(s=>!seen.has(key(s)));
 const records=[...old,...newOnly];
 check(records.length<=dst.options.maxSynapses,'union synapse budget exceeded');
 constructTopology(dst,records);
 copyDynamics(src,dst,indices);
 // Old indices are stable in the union. This preserves index-based learned deltas.
 for(let i=0;i<old.length;i++){
  const x=dst.synapses[i];
  check(x.weight===src.synapses[i].weight&&x.initialWeight===src.initialWeights[i],'learned weight was lost');
 }
 return {neurons_preserved:src.active,neurons_added:dst.active-src.active,old_synapses_retained:old.length,
  new_synapses:newOnly.length,removed_synapses:0,old_pending_events:src.pending.reduce((s,x)=>s+x.length,0),
  identity_map_sha256:sha(indices),all_acquired_weights_preserved:true};
}
function syncCircuit(src,dst){
 check(src.seed===dst.seed&&src.pattern===dst.pattern&&src.maxSteps===dst.maxSteps,'simulation configuration mismatch');
 check(JSON.stringify(src.genomeHashes)===JSON.stringify(dst.genomeHashes),'genome hashes mismatch');
 check(src.engines.LGN.active===dst.engines.LGN.active&&src.engines.V2.active===dst.engines.V2.active,'external region layout changed');
 dst.engines.LGN.restore(src.engines.LGN.checkpoint());
 dst.engines.V2.restore(src.engines.V2.checkpoint());
 const migrated=transplant(src.engines.V1,dst.engines.V1);
 dst.stepNumber=src.stepNumber;
 dst.queue=structuredClone(src.queue);
 dst.delivered={...src.delivered};dst.scheduled={...src.scheduled};dst.totalFrames=src.totalFrames;
 check(dst.checkpoint().state.engines.V1.state.step===src.stepNumber,'migrated engine step mismatch');
 check(dst.summary().genomes_unchanged,'inherited genome changed during migration');
 return migrated;
}
function config(circuit){return {seed:circuit.seed,pattern:circuit.pattern,maxSteps:circuit.maxSteps,activeV1:circuit.engines.V1.active};}
function pack(circuit,revision){
 const state={schema:SNAPSHOT,revision,config:config(circuit),genomeHashes:{...circuit.genomeHashes},
  topology:{schema:STRUCTURE,V1:topologyRecords(circuit.engines.V1)},checkpoint:circuit.checkpoint()};
 return {...state,sha256:sha(state)};
}
function unpack(record){
 check(object(record)&&record.schema===SNAPSHOT,'snapshot schema invalid');
 const {sha256,...s}=record;
 check(sha256===sha(s),'growth snapshot hash mismatch');
 check(s.topology?.schema===STRUCTURE,'growth topology missing');
 const c=new NeuralCircuit(s.config);
 check(JSON.stringify(c.genomeHashes)===JSON.stringify(s.genomeHashes),'growth snapshot genome mismatch');
 constructTopology(c.engines.V1,s.topology.V1);
 c.restore(s.checkpoint);
 check(c.summary().genomes_unchanged,'growth snapshot genotype changed');
 const rebound=pack(c,s.revision);
 check(rebound.sha256===record.sha256,'growth snapshot is not round-trip deterministic');
 return {circuit:c,revision:s.revision};
}
class LiveGrowth{
 constructor(circuit=new NeuralCircuit()){
  check(circuit instanceof NeuralCircuit,'NeuralCircuit instance required');
  this.circuit=circuit;this.revision='r06-0';this.version=0;
  this.pending=null;this.rollbackCopy=null;this.history=[];
 }
 stage(request){
  check(this.pending===null,'pending growth proposal exists');
  check(object(request)&&Object.keys(request).sort().join(',')==='active_v1,base,genome_hashes,id','growth fields not allowlisted');
  check(/^r06-[a-z0-9-]{2,40}$/.test(request.id||''),'invalid proposal id');
  check(request.base===this.revision,'stale growth revision');
  check(Number.isSafeInteger(request.active_v1)&&request.active_v1>this.circuit.engines.V1.active&&request.active_v1<=MAX_ACTIVE,'growth target invalid or pruning requested');
  check(JSON.stringify(request.genome_hashes)===JSON.stringify(this.circuit.genomeHashes),'genome binding mismatch');
  check(Object.entries(this.circuit.engines).every(([k,e])=>e.regionHash===this.circuit.genomeHashes[k]),'source genotype changed');
  const before=this.circuit.checkpoint().sha256;
  const candidate=new NeuralCircuit({...config(this.circuit),activeV1:request.active_v1});
  const shadow=candidateStats(this.circuit,candidate);
  const migrated=syncCircuit(this.circuit,candidate);
  const from=this.revision;
  const plan={schema:SCHEMA,id:request.id,base:from,source_checkpoint_sha256:before,
   source_tick:this.circuit.stepNumber,target_active_v1:request.active_v1,genome_hashes:structuredClone(this.circuit.genomeHashes),
   shadow_recompile:shadow.structural,actual_union:migrated,source_acquired:shadow.acquisition,
   candidate_checkpoint_sha256:candidate.checkpoint().sha256,
   policy:'CPU-only; single-threaded tick boundary; append-only growth, no pruning; state preserved; rollback before next tick',
   atomic_commit_scope:'local in-process object pointer only; no distributed consensus or scheduler quiescence'};
  const digest=sha(plan);this.pending={plan,candidate,digest};
  return structuredClone({...plan,sha256:digest});
 }
 commit(checksum){
  const p=this.pending;check(!!p,'no growth proposal');
  check(checksum===p.digest,'proposal checksum mismatch');
  check(p.plan.base===this.revision,'stale growth revision');
  check(this.circuit.checkpoint().sha256===p.plan.source_checkpoint_sha256,'source state changed since stage');
  check(p.candidate.checkpoint().sha256===p.plan.candidate_checkpoint_sha256,'candidate state changed since stage');
  const previous=this.circuit,oldRevision=this.revision;
  this.circuit=p.candidate;this.revision=p.plan.id;this.version++;
  this.rollbackCopy={previous,oldRevision,newRevision:this.revision,anchor:this.circuit.checkpoint().sha256};
  this.history.push({event:'growth.commit',from:oldRevision,to:this.revision,tick:this.circuit.stepNumber,plan_sha256:p.digest});
  this.pending=null;
  return {schema:'mechanicus.genesis-live-growth-commit/1',revision:this.revision,tick:this.circuit.stepNumber,active_v1:this.circuit.engines.V1.active,
   all_acquired_weights_preserved:true,rollback_available:true,source_unchanged:previous.checkpoint().sha256===p.plan.source_checkpoint_sha256};
 }
 abort(){const had=this.pending!==null;this.pending=null;return had;}
 rollback(){
  const r=this.rollbackCopy;check(r&&r.newRevision===this.revision,'no matching rollback');
  check(!this.pending,'pending proposal must be aborted');
  check(this.circuit.checkpoint().sha256===r.anchor,'rollback unsafe after state changed or new tick');
  this.circuit=r.previous;this.revision=r.oldRevision;this.rollbackCopy=null;this.version++;
  this.history.push({event:'growth.rollback',to:this.revision,tick:this.circuit.stepNumber});
  return this.status();
 }
 snapshot(){check(this.pending===null,'cannot snapshot staged candidate');return pack(this.circuit,this.revision);}
 static resume(snapshot){const state=unpack(snapshot);const planner=new LiveGrowth(state.circuit);planner.revision=state.revision;return planner;}
 status(){return {schema:SCHEMA,revision:this.revision,version:this.version,active_v1:this.circuit.engines.V1.active,
  tick:this.circuit.stepNumber,source_genome_unchanged:this.circuit.summary().genomes_unchanged,
  pending:!!this.pending,rollback_available:!!this.rollbackCopy&&this.circuit.checkpoint().sha256===this.rollbackCopy.anchor,
  hot_swap_scope:'synchronous local tick boundary (not thread-safe multi-host hot swap)',history:structuredClone(this.history)};}
}
module.exports={LiveGrowth,indexMap,transplant,topologyRecords,constructTopology,pack,unpack,SCHEMA};
