'use strict';
/** Durable, separate acquired synapse-weight state. Not a live-neuron checkpoint. */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {digest}=require('./typed-sensory.cjs');
const SCHEMA='mechanicus.acquired-circuit/2';
function assert(x,m){if(!x)throw Error(m);}
function captureAcquired(circuit){
 assert(circuit&&circuit.engines&&circuit.genomeHashes,'circuit required');
 const regions={};
 for(const [name,e] of Object.entries(circuit.engines)){
  const weights=[];
  for(let i=0;i<e.synapses.length;i++)if(e.synapses[i].weight!==e.initialWeights[i])weights.push({index:i,value:e.synapses[i].weight});
  regions[name]={region_id:e.region.id,source_genome_id:e.region.genome.source.id,genome_sha256:e.regionHash,
   initial_weights_sha256:digest(e.initialWeights),synapse_count:e.synapses.length,changed_synapses:weights.length,weights};
 }
 const payload={schema:SCHEMA,step:circuit.stepNumber,seed:circuit.seed,genome_hashes:structuredClone(circuit.genomeHashes),regions,
  scope:'acquired synaptic weights only; not dynamic neuronal state'};
 return {...payload,sha256:digest(payload)};
}
function verifyAcquired(circuit,record){
 assert(record&&record.schema===SCHEMA,'invalid acquired record schema');
 const {sha256,...payload}=record;
 assert(sha256===digest(payload),'acquired record integrity mismatch');
 assert(record.seed===circuit.seed,'acquired seed mismatch');
 assert(JSON.stringify(record.genome_hashes)===JSON.stringify(circuit.genomeHashes),'acquired genome mismatch');
 assert(Object.keys(record.regions).sort().join(',')===Object.keys(circuit.engines).sort().join(','),'acquired region set differs');
 const plan=[];
 for(const [name,e] of Object.entries(circuit.engines)){
  const r=record.regions[name];
  assert(r&&r.region_id===e.region.id&&r.source_genome_id===e.region.genome.source.id&&r.genome_sha256===e.regionHash,'acquired region identity mismatch');
  assert(r.synapse_count===e.synapses.length&&r.initial_weights_sha256===digest(e.initialWeights),'acquired topology mismatch');
  assert(Array.isArray(r.weights)&&r.weights.length===r.changed_synapses&&r.weights.length<=e.synapses.length,'acquired synapse count invalid');
  let last=-1;
  for(const v of r.weights){
   assert(Number.isSafeInteger(v.index)&&v.index>last&&v.index<e.synapses.length,'duplicate/out-of-range acquired synapse');
   assert(typeof v.value==='number'&&Number.isFinite(v.value)&&v.value>=0&&v.value<=1.5,'invalid acquired synapse weight');
   last=v.index;
  }
  plan.push([e,r.weights]);
 }
 return plan;
}
function applyAcquired(circuit,record){
 assert(circuit.stepNumber===0,'acquired weights may only be applied to a fresh circuit; checkpoint restore for continuation');
 const plan=verifyAcquired(circuit,record); // validate the entire change set before mutating anything
 for(const [engine,weights] of plan)for(const item of weights)engine.synapses[item.index].weight=item.value;
 return circuit;
}
function safeId(x){assert(typeof x==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(x),'invalid artifact ID');return x;}
function writeImmutable(directory,id,record){
 safeId(id);assert(path.isAbsolute(directory),'artifact destination must be absolute');
 assert(record?.sha256&&record.sha256===digest((({sha256,...p})=>p)(record)),'refuse unverified artifact');
 fs.mkdirSync(directory,{recursive:true});
 const target=path.join(directory,id+'.json');const tmp=path.join(directory,'.'+id+'.'+crypto.randomUUID()+'.tmp');
 const bytes=JSON.stringify(record,null,2)+'\n';
 assert(Buffer.byteLength(bytes)<8*1024*1024,'acquired artifact exceeds 8MiB limit');
 let fd;
 try{
  fd=fs.openSync(tmp,'wx',0o600);fs.writeFileSync(fd,bytes,{encoding:'utf8'});fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;
  // Same-directory hard link is atomic create-only on NTFS/POSIX; no replacement of preexisting artifacts.
  fs.linkSync(tmp,target);
 }finally{if(fd!==undefined)fs.closeSync(fd);try{fs.unlinkSync(tmp)}catch{}}
 return target;
}
function readImmutable(file){
 const s=fs.readFileSync(file,'utf8');assert(Buffer.byteLength(s)<=8*1024*1024,'acquired file too large');
 const r=JSON.parse(s);assert(r?.sha256===digest((({sha256,...p})=>p)(r)),'acquired file integrity mismatch');return r;
}
module.exports={SCHEMA,captureAcquired,verifyAcquired,applyAcquired,writeImmutable,readImmutable};
