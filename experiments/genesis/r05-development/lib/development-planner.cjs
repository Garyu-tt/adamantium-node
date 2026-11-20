'use strict';
/**
 * GENESIS R05 — phenotype development via deterministic, bounded shadow compilation.
 * No direct neuron/synapse mutation, no pretending to provide live topology hot-swap.
 * Source genotype is read-only; only active cell allocation is changed.
 */
const {createHash}=require('node:crypto');
const {NeuralCircuit}=require('../vendor/r03/lib/circuit.cjs');
const SCHEMA='mechanicus.genesis-development-plan/1';
const MAX_ACTIVE=2048;
const MAX_SYN_MATCH=100000;
const sha=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const assert=(v,m)=>{if(!v)throw new Error(m)};
const isObj=v=>v&&typeof v==='object'&&!Array.isArray(v);
function currentGenes(c){return Object.fromEntries(Object.entries(c.engines).map(([k,e])=>[k,e.regionHash]));}
function neuronRefs(engine){
 const a=new Array(engine.active);
 for(const p of engine.populations){for(let i=0;i<p.count;i++)a[p.offset+i]=p.id+'@'+i;}
 assert(a.every(x=>typeof x==='string'),'incomplete neuron-address map');return a;
}
function connectionKeys(engine){
 assert(engine.synapses.length<=MAX_SYN_MATCH,'synapse comparison budget exceeded');
 const refs=neuronRefs(engine);
 const keys=new Array(engine.synapses.length);
 const seen=new Set();
 for(let i=0;i<engine.synapses.length;i++){
  const s=engine.synapses[i];
  const key=[s.projection,refs[s.from],refs[s.to],s.kind,s.delay].join('|');
  // Duplicate projection/contact keys would make learned-weight migration ambiguous.
  assert(!seen.has(key),'ambiguous duplicate synaptic identity');
  seen.add(key);keys[i]=key;
 }
 return keys;
}
function candidateStats(current,shadow){
 const per={};let retained=0,removed=0,added=0,learnedAtRisk=0,learnedTotal=0;
 for(const [name,e] of Object.entries(current.engines)){
  const next=shadow.engines[name];
  const before=connectionKeys(e),after=connectionKeys(next),nextSet=new Set(after),beforeSet=new Set(before);
  const keep=before.filter(k=>nextSet.has(k)).length;
  const lost=before.length-keep,gained=after.filter(k=>!beforeSet.has(k)).length;
  let learned=0,lostLearned=0;
  for(let i=0;i<before.length;i++){
   if(Math.abs(e.synapses[i].weight-e.initialWeights[i])>1e-8){learned++;if(!nextSet.has(before[i]))lostLearned++;}
  }
  const cells=e.active,fromSyn=e.synapses.length,toSyn=next.synapses.length;
  per[name]={active_from:cells,active_to:next.active,added_active:Math.max(0,next.active-cells),removed_active:Math.max(0,cells-next.active),
   synapses_from:fromSyn,synapses_to:toSyn,retained_synapses:keep,removed_synapses:lost,added_synapses:gained,
   acquired_synapses:learned,learned_synapses_lost_if_rebuilt:lostLearned,
   resource_estimate_from_bytes:e.summary().resource_estimate_bytes,resource_estimate_to_bytes:next.summary().resource_estimate_bytes};
  retained+=keep;removed+=lost;added+=gained;learnedAtRisk+=lostLearned;learnedTotal+=learned;
 }
 return {regions:per,structural:{retained_synapses:retained,removed_synapses:removed,added_synapses:added},
  acquisition:{changed_synapses:learnedTotal,changed_synapses_at_risk:learnedAtRisk}};
}
class DevelopmentPlanner{
 constructor(circuit=new NeuralCircuit()){
  assert(circuit instanceof NeuralCircuit,'NeuralCircuit instance required');
  this.circuit=circuit;
  this.revision='r05-dev-0';this.version=0;this.pending=null;this.history=[];this.lastRollback=null;
 }
 stage(request){
  assert(this.pending===null,'pending proposal must be committed or aborted first');
  assert(isObj(request),'stage request must be an object');
  assert(Object.keys(request).sort().join(',')==='active_v1,base,genome_hashes,id','stage fields not allowlisted');
  assert(typeof request.id==='string'&&/^r05-[a-z0-9-]{2,40}$/.test(request.id)&&request.id!==this.revision,'invalid revision identifier');
  assert(request.base===this.revision,'stale base revision');
  assert(Number.isSafeInteger(request.active_v1)&&request.active_v1>=128&&request.active_v1<=MAX_ACTIVE,'active budget outside [128,2048]');
  assert(request.active_v1!==this.circuit.engines.V1.active,'no growth or pruning requested');
  assert(isObj(request.genome_hashes)&&Object.keys(request.genome_hashes).sort().join(',')==='LGN,V1,V2','invalid genome hash map');
  assert(JSON.stringify(request.genome_hashes)===JSON.stringify(this.circuit.genomeHashes),'genome hashes do not match source circuit');
  assert(JSON.stringify(currentGenes(this.circuit))===JSON.stringify(this.circuit.genomeHashes),'source genotype changed');
  const anchor=this.circuit.checkpoint().sha256;
  const candidate=new NeuralCircuit({seed:this.circuit.seed,pattern:this.circuit.pattern,maxSteps:this.circuit.maxSteps,activeV1:request.active_v1});
  assert(JSON.stringify(candidate.genomeHashes)===JSON.stringify(this.circuit.genomeHashes),'candidate compiler mutated source genotype');
  const delta=candidateStats(this.circuit,candidate);
  const plan={schema:SCHEMA,id:request.id,base:this.revision,genome_hashes:structuredClone(request.genome_hashes),
   source_checkpoint_sha256:anchor,source_tick:this.circuit.stepNumber,target_active_v1:request.active_v1,
   target_circuit_checkpoint_sha256:candidate.checkpoint().sha256,...delta,
   commit_allowed:this.circuit.stepNumber===0&&this.circuit.queue.length===0&&delta.acquisition.changed_synapses===0,
   policy:'PRE-START ONLY: rebuild of sparse circuit, never live neuronal hot swap; rejects learned or in-flight state',
   source_genotype_unchanged:true};
  const digest=sha(plan);
  this.pending={plan,candidate,digest};return structuredClone({...plan,sha256:digest});
 }
 abort(){const had=!!this.pending;this.pending=null;return had;}
 commit(expectedPlanSha256){
  const p=this.pending;assert(p,'no staged development plan');
  assert(typeof expectedPlanSha256==='string'&&expectedPlanSha256===p.digest,'proposal checksum mismatch');
  assert(p.plan.base===this.revision,'stale planned revision');
  assert(p.plan.source_checkpoint_sha256===this.circuit.checkpoint().sha256,'source state changed after staging');
  assert(JSON.stringify(this.circuit.genomeHashes)===JSON.stringify(p.plan.genome_hashes),'genome mismatch at commit');
  assert(this.circuit.stepNumber===0&&this.circuit.queue.length===0,'unsafe structural switch after simulation started');
  assert(p.plan.acquisition.changed_synapses===0,'learned synaptic state requires an explicit migration mechanism');
  assert(p.plan.commit_allowed,'development plan is preview-only');
  const previous=this.circuit,from=this.revision;
  this.circuit=p.candidate;this.revision=p.plan.id;this.version++;
  const record={schema:'mechanicus.genesis-development-commit/1',from,to:this.revision,at_tick:0,active_v1:this.circuit.engines.V1.active,plan_sha256:p.digest};
  this.history.push(record);this.lastRollback={previous,revision:from,commitRevision:this.revision};this.pending=null;
  return structuredClone(record);
 }
 rollback(){
  const r=this.lastRollback;
  assert(r&&r.commitRevision===this.revision,'no rollback candidate for current revision');
  assert(this.circuit.stepNumber===0&&this.circuit.queue.length===0,'cannot rollback after new execution started');
  assert(this.pending===null,'abort pending proposal before rollback');
  this.circuit=r.previous;this.revision=r.revision;this.version++;
  this.history.push({schema:'mechanicus.genesis-development-rollback/1',from:r.commitRevision,to:this.revision,at_tick:0});
  this.lastRollback=null;return this.status();
 }
 status(){return {schema:'mechanicus.genesis-development/1',revision:this.revision,version:this.version,pending:!!this.pending,
  active_v1:this.circuit.engines.V1.active,circuit_tick:this.circuit.stepNumber,genome_hashes:structuredClone(this.circuit.genomeHashes),
  history:structuredClone(this.history),live_topology_hot_swap:false};}
}
module.exports={DevelopmentPlanner,candidateStats,neuronRefs,connectionKeys,SCHEMA};
