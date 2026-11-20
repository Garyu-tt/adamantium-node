'use strict';
/** Tick-boundary changes of runtime policy only. Never rewires a live neural topology. */
const {digest}=require('./typed-sensory.cjs');
function assert(x,m){if(!x)throw Error(m);}
function validatePolicy(p){
 assert(p&&typeof p==='object'&&!Array.isArray(p),'runtime policy must be object');
 assert(Object.keys(p).sort().join(',')==='reward,sensory_gain','runtime policy fields not allowlisted');
 assert(typeof p.sensory_gain==='number'&&Number.isFinite(p.sensory_gain)&&p.sensory_gain>=.1&&p.sensory_gain<=1,'sensory gain out of bounds');
 assert(p.reward&&Object.keys(p.reward).sort().join(',')==='LGN,V1,V2','invalid reward region map');
 for(const v of Object.values(p.reward))assert(typeof v==='number'&&Number.isFinite(v)&&v>=-1&&v<=1,'reward outside [-1,1]');
 return structuredClone(p);
}
class RevisionManager {
 constructor(circuit){
  assert(circuit?.engines&&circuit?.checkpoint,'NeuralCircuit required');
  this.circuit=circuit;this.current='r04-policy-0';this.version=0;
  this.policy=validatePolicy({reward:{LGN:0,V1:0,V2:0},sensory_gain:1});
  this.pending=null;this.history=[];
 }
 stage({id,base,policy,genome_hashes}={}){
  assert(!this.pending,'pending revision must be committed or aborted first');
  assert(typeof id==='string'&&/^r04-[a-zA-Z0-9-]{1,60}$/.test(id)&&id!==this.current,'invalid/duplicate revision id');
  assert(base===this.current,'stale runtime revision base');
  assert(JSON.stringify(genome_hashes)===JSON.stringify(this.circuit.genomeHashes),'runtime genome mismatch');
  const p=validatePolicy(policy);
  this.pending={id,base,genome_hashes:structuredClone(genome_hashes),policy:p};
  return {staged:true,id,commit_at_tick:this.circuit.stepNumber};
 }
 abort(){const had=!!this.pending;this.pending=null;return had;}
 commit(){
  assert(this.pending,'no staged revision');
  const item=this.pending;
  assert(item.base===this.current,'concurrent revision changed');
  assert(JSON.stringify(item.genome_hashes)===JSON.stringify(this.circuit.genomeHashes),'genome changed since staging');
  // All calls in this prototype are synchronous; commit can happen only between ticks.
  const saved=this.circuit.checkpoint();const prior=this.policy;
  try{
   for(const [name,e] of Object.entries(this.circuit.engines))e.setReward(item.policy.reward[name]);
   this.policy=item.policy;
   this.current=item.id;this.version++;
   this.history.push({from:item.base,to:item.id,at_tick:this.circuit.stepNumber,policy_sha256:digest(item.policy)});
   this.pending=null;
   return this.history[this.history.length-1];
  }catch(error){this.circuit.restore(saved);this.policy=prior;this.pending=null;throw error;}
 }
 status(){return {schema:'mechanicus.neural-runtime-revision/1',revision:this.current,version:this.version,genome_hashes:structuredClone(this.circuit.genomeHashes),pending:!!this.pending,policy:structuredClone(this.policy),history:structuredClone(this.history)};}
}
module.exports={RevisionManager,validatePolicy};
