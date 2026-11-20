'use strict';
/**
 * GENESIS Neural Engine R02 — isolated, CPU-only, sparse deterministic experiment.
 * Architecture-first: virtual count describes the phenotype, not materialized cells.
 * This is an engineering toy spiking solver, NOT a calibrated biophysical simulator.
 */
const {createHash} = require('node:crypto');
const {validateRegion,allocateLayers,apportion} = require('./region-contract.cjs');
const VERSION='mechanicus.neural-cpu/2';
const DEFAULTS=Object.freeze({dtMs:1,maxActive:4096,maxSynapses:60000,maxDelayTicks:64,maxSteps:5000,seed:42,
  neuronBytesEstimate:64,synapseBytesEstimate:40,losslessCheckpoint:true});
function assert(cond,msg){if(!cond)throw new Error(msg);}
function shaObj(obj){return createHash('sha256').update(JSON.stringify(obj)).digest('hex');}
function u32(x){return x>>>0;}
class PRNG {
  constructor(seed){assert(Number.isSafeInteger(seed)&&seed>=0&&seed<=0xffffffff,'invalid seed');this.state=u32(seed)||0x9e3779b9;}
  next(){let x=this.state;x^=x<<13;x^=x>>>17;x^=x<<5;this.state=u32(x);return this.state/4294967296;}
  int(max){return Math.floor(this.next()*max);}
}
function validNumber(v){return typeof v==='number'&&Number.isFinite(v);}
function safeOptions(options={}){
  assert(options && typeof options==='object' && !Array.isArray(options),'options must be object');
  const o={...DEFAULTS,...options};
  const caps={maxActive:4096,maxSynapses:200000,maxDelayTicks:256,maxSteps:50000};
  for(const [k,cap] of Object.entries(caps))assert(Number.isSafeInteger(o[k])&&o[k]>0&&o[k]<=cap,'invalid budget '+k);
  assert(validNumber(o.dtMs)&&o.dtMs>0&&o.dtMs<=10,'dtMs out of range');
  assert(Number.isSafeInteger(o.seed)&&o.seed>=0&&o.seed<=0xffffffff,'seed invalid');
  return o;
}
function populationList(region,activeBudget){
  const allocated=allocateLayers(region);
  const list=[];
  for(let i=0;i<region.layers.length;i++){
    const layer=region.layers[i];
    assert(Array.isArray(layer.populations)&&layer.populations.length>0,'R02 requires explicitly described populations per layer');
    const shares=layer.populations.map(p=>p.share);
    assert(shares.every(v=>validNumber(v)&&v>=0),'invalid population share');
    // Source config represents population shares as fractions of the *layer*.
    assert(Math.abs(shares.reduce((a,b)=>a+b,0)-1)<1e-6,'population fractions must total 1');
    for(let j=0;j<layer.populations.length;j++){
      const p=layer.populations[j];
      assert(p.kind==='excitatory'||p.kind==='inhibitory','R02 supports excitatory/inhibitory populations only');
      assert(['AdEx','Izhikevich','LIF'].includes(p.cell_model),'unsupported cell model contract: '+p.cell_model);
      list.push({id:p.id,layer:layer.id,kind:p.kind,cellModel:p.cell_model,sourceCount:allocated.layers[i].neurons*shares[j],
        receptors:new Set((p.receptors||[]).map(r=>r.type))});
    }
  }
  assert(list.length>0 && list.length<=256,'population budget exceeded');
  const counts=apportion(activeBudget,list.map(p=>p.sourceCount));
  let offset=0;
  list.forEach((p,i)=>{p.count=counts[i];p.offset=offset;offset+=counts[i];});
  assert(counts.reduce((a,b)=>a+b,0)===activeBudget,'active allocation error');
  return list;
}
class SparseNeuralEngine {
 constructor(region,options={}){
  this.options=safeOptions(options);
  const v=validateRegion(region);
  assert(v.ok,'invalid GENESIS R01 config: '+v.errors.map(e=>e.path).join(','));
  assert(region.identity.profile==='biological-spiking','R02 supports biological-spiking region only');
  assert(region.runtime.mode==='design-only','R02 expects design-only source config');
  assert(region.neurons.total>0,'empty virtual phenotype');
  const budget=options.activeBudget??region.runtime.active_budget??896;
  assert(Number.isSafeInteger(budget)&&budget>0&&budget<=this.options.maxActive,'active neuron budget exceeded');
  assert(budget<=region.neurons.total,'active budget exceeds region neuron count');
  this.region=structuredClone(region);this.regionHash=shaObj(region);this.seed=this.options.seed;this.rng=new PRNG(this.seed);
  this.populations=populationList(region,budget);
  this.map=new Map(this.populations.map(p=>[p.id,p]));
  this.active=budget;this.virtual=region.neurons.total;
  this.state=new Float32Array(budget*4); // Four compartments per cell: soma/proximal/distal/axon; simplified coupling
  this.adapt=new Float32Array(budget);this.refractory=new Int8Array(budget);
  this.preTrace=new Float32Array(budget);this.postTrace=new Float32Array(budget);
  this.spikes=new Uint8Array(budget);this.lastSpike=new Int32Array(budget).fill(-1000000);
  this.extCurrent=new Float32Array(budget);this.gampa=new Float32Array(budget);this.gnmda=new Float32Array(budget);this.ggabaa=new Float32Array(budget);
  this.weights=[];this.synapses=[];this.outgoing=Array.from({length:budget},()=>[]);this.incoming=Array.from({length:budget},()=>[]);
  this.pending=Array.from({length:this.options.maxDelayTicks+1},()=>[]);
  this.popIndex=new Int16Array(budget);
  this.populations.forEach((p,i)=>{for(let j=p.offset;j<p.offset+p.count;j++)this.popIndex[j]=i;});
  this.stepIndex=0;this.totalSpikes=0;this.reward=0;this.warnings=[];this.unknownProjections=[];
  this.perProjection={};this.initialWeights=[];
  this.buildSparseConnections();
  this.initialWeights=this.synapses.map(s=>s.weight);
  this.state.fill(0);
 }
 buildSparseConnections(){
  const max=this.options.maxSynapses;
  for(const proj of this.region.projections){
   const src=this.map.get(proj.source),dst=this.map.get(proj.target);
   if(!src||!dst){this.unknownProjections.push({id:proj.id,reason:'external population unresolved; not simulated'});continue;}
   if(proj.rule?.mode!=='probabilistic'||!validNumber(proj.rule.probability)){
    this.unknownProjections.push({id:proj.id,reason:'declarative projection not materialized'});continue;
   }
   let p=proj.rule.probability;
   assert(p>=0&&p<=1,'invalid projection probability');
   let delay=Math.max(1,Math.ceil((proj.rule.delay_ms??1)/this.options.dtMs));
   assert(delay<=this.options.maxDelayTicks,'synaptic delay exceeds configured buffer');
   let allowed=src.kind==='inhibitory'?dst.receptors.has('GABA-A'):dst.receptors.has('AMPA');
   if(!allowed){this.unknownProjections.push({id:proj.id,reason:'target missing corresponding receptor'});continue;}
   this.perProjection[proj.id]=0;
   // One candidate source→destination neuron pair max once; synapse count ≠ axons or unique pairs generally.
   // Here these are equal only within the simplified one-contact-per-pair experiment.
   for(let a=0;a<src.count;a++)for(let b=0;b<dst.count;b++){
    if(src.id===dst.id&&a===b)continue;
    if(this.rng.next()>=p)continue;
    assert(this.synapses.length<max,'synapse budget exceeded before allocation');
    const si=src.offset+a,di=dst.offset+b;
    const syn={from:si,to:di,weight:src.kind==='inhibitory'?.65:.34,initialWeight:src.kind==='inhibitory'?.65:.34,
      delay,kind:src.kind==='inhibitory'?'GABA':'GLUTAMATE',projection:proj.id};
    const id=this.synapses.push(syn)-1;
    this.outgoing[si].push(id);this.incoming[di].push(id);this.perProjection[proj.id]++;
   }
  }
  assert(this.synapses.length>0,'no supported materializable synapses');
 }
 stimulation(popId,count=16,amplitude=2.0){
  const p=this.map.get(popId);assert(p,'unknown population for stimulus');
  assert(Number.isSafeInteger(count)&&count>0&&count<=this.options.maxActive,'invalid stimulus count');
  assert(validNumber(amplitude)&&amplitude>0&&amplitude<=20,'invalid stimulus amplitude');
  if(p.count===0)return 0;
  for(let j=0;j<Math.min(count,p.count);j++){
   const index=p.offset + (j%p.count);
   this.extCurrent[index]+=amplitude;
  }
  return Math.min(count,p.count);
 }
 setReward(value){assert(validNumber(value)&&value>=-1&&value<=1,'reward outside [-1,1]');this.reward=value;}
 step(stimulus=null){
  assert(this.stepIndex<this.options.maxSteps,'step budget exceeded');
  if(stimulus){const {population='L4.E',count=16,amplitude=2.0}=stimulus;this.stimulation(population,count,amplitude);}
  const N=this.active, dt=this.options.dtMs, idx=this.stepIndex;
  const arrivals=this.pending[idx%this.pending.length];
  for(let k=0;k<arrivals.length;k++){
   const {to,kind,weight}=arrivals[k];
   if(kind==='GABA')this.ggabaa[to]=Math.min(100,this.ggabaa[to]+weight);
   else{this.gampa[to]=Math.min(100,this.gampa[to]+weight); if(this.populations[this.popIndex[to]].receptors.has('NMDA'))this.gnmda[to]=Math.min(100,this.gnmda[to]+weight*.24);}
  }
  this.pending[idx%this.pending.length]=[];
  let spikes=0;
  for(let i=0;i<N;i++){
   const o=i*4;
   this.gampa[i]*=.72;this.gnmda[i]*=.955;this.ggabaa[i]*=.78;
   this.preTrace[i]*=.94;this.postTrace[i]*=.94;
   // Simple four-compartment relaxation, not Hodgkin-Huxley or full AdEx/Izhikevich equations.
   const dendriteInput=this.gampa[i]*.58+this.gnmda[i]*.12-this.ggabaa[i]*.48;
   this.state[o+2]=Math.max(-50,Math.min(50,this.state[o+2]*.88+dendriteInput));
   this.state[o+1]=Math.max(-50,Math.min(50,this.state[o+1]*.81+this.state[o+2]*.24));
   this.state[o]=Math.max(-50,Math.min(50,this.state[o]*.86+this.state[o+1]*.21+this.extCurrent[i] -this.adapt[i]));
   this.state[o+3]=this.state[o+3]*.65;
   this.extCurrent[i]=0;
   this.adapt[i]*=.94;
   if(this.refractory[i]>0){this.refractory[i]--;this.state[o]=0;this.spikes[i]=0;continue;}
   const fired=this.state[o]>1.05;
   this.spikes[i]=fired?1:0;
   if(!fired)continue;
   spikes++;this.totalSpikes++;this.lastSpike[i]=idx;
   this.state[o]=0;this.state[o+3]=1;this.refractory[i]=2;this.adapt[i]+=.075;
  }
  // Plasticity follows the vector of spikes; no iteration-order bias between neurons.
  let changed=0;
  const lr=.0018*(1+this.reward*.8);
  for(let i=0;i<N;i++)if(this.spikes[i]){
   for(const si of this.outgoing[i]){
    const s=this.synapses[si];
    if(s.kind==='GLUTAMATE'){
     const updated=Math.max(.01,Math.min(1.5,s.weight-lr*.75*this.postTrace[s.to]));
     if(updated!==s.weight)changed++;s.weight=updated;
    }
    this.pending[(idx+s.delay)%this.pending.length].push({to:s.to,weight:s.weight,kind:s.kind});
   }
  }
  for(let i=0;i<N;i++)if(this.spikes[i]){
   for(const si of this.incoming[i]){
    const s=this.synapses[si];if(s.kind!=='GLUTAMATE')continue;
    const updated=Math.max(.01,Math.min(1.5,s.weight+lr*this.preTrace[s.from]));
    if(updated!==s.weight)changed++;s.weight=updated;
   }
  }
  for(let i=0;i<N;i++)if(this.spikes[i]){this.preTrace[i]+=1;this.postTrace[i]+=1;}
  this.stepIndex++;
  return {event:'neural.tick',schema:VERSION,region_id:this.region.id,step:this.stepIndex,spikes,activity_ratio:spikes/N,
    synapses:this.synapses.length,plasticity_updates:changed,virtual_neurons:this.virtual,materialized_neurons:N,
    unresolved_projections:this.unknownProjections.length};
 }
 populationAt(index){
  for(const p of this.populations)if(index>=p.offset&&index<p.offset+p.count)return p;
  throw new RangeError('active address unmapped');
 }
 run(steps,{stimulate='L4.E',count=16,amplitude=2,period=2,reward=0,collectEvery=1}={}){
  assert(Number.isSafeInteger(steps)&&steps>=0&&this.stepIndex+steps<=this.options.maxSteps,'invalid run steps');
  assert(Number.isSafeInteger(collectEvery)&&collectEvery>0,'invalid telemetry sample stride');
  assert(Number.isSafeInteger(period)&&period>0&&period<=10000,'period invalid');
  this.setReward(reward);
  const traces=[];let eventTotal=0,updates=0;
  for(let i=0;i<steps;i++){
   const t=this.stepIndex;
   const x=this.step(t%period===0?{population:stimulate,count,amplitude}:null);
   eventTotal+=x.spikes;updates+=x.plasticity_updates;
   if(i%collectEvery===0||i===steps-1)traces.push(x);
  }
  return {traces,totalSpikes:eventTotal,plasticityUpdates:updates,summary:this.summary()};
 }
 acquired(){
  const changes=[];
  for(let i=0;i<this.synapses.length;i++){
   const delta=this.synapses[i].weight-this.initialWeights[i];
   if(Math.abs(delta)>1e-8)changes.push({synapse:i,delta:Number(delta.toFixed(7))});
  }
  return {schema:'mechanicus.acquired-genome-delta/1',source_genome_id:this.region.genome.source.id,
    simulation_steps:this.stepIndex,changed_synapses:changes.length,changes};
 }
 summary(){
  const perPopulation={};
  for(const p of this.populations)perPopulation[p.id]={active:p.count,source_count_approx:p.sourceCount};
  return {schema:VERSION,region_id:this.region.id,genome_source:this.region.genome.source.id,
   virtual_region_neurons:this.virtual,virtual_address_cap:this.region.runtime.virtual_address_limit,
   materialized_neurons:this.active,materialized_synapses:this.synapses.length,
   synapses_by_projection:{...this.perProjection},unresolved_projections:this.unknownProjections,
   steps:this.stepIndex,total_spikes:this.totalSpikes,changed_synapses:this.acquired().changed_synapses,
   resource_estimate_bytes:this.state.byteLength+this.adapt.byteLength+this.refractory.byteLength+this.preTrace.byteLength+this.postTrace.byteLength+this.spikes.byteLength+this.lastSpike.byteLength+this.extCurrent.byteLength+this.gampa.byteLength+this.gnmda.byteLength+this.ggabaa.byteLength+this.synapses.length*64,
   backend:'nodejs-cpu',numerics:'float32',biological_fidelity:'experimental-toy',trained_model:false,
   region_config_sha256:this.regionHash};
 }
 checkpoint(){
  const state={version:VERSION,region_id:this.region.id,region_config_sha256:this.regionHash,options:{...this.options},seed:this.seed,
   step:this.stepIndex,total_spikes:this.totalSpikes,rng_state:this.rng.state,reward:this.reward,
   state:Array.from(this.state),adapt:Array.from(this.adapt),refractory:Array.from(this.refractory),
   pre_trace:Array.from(this.preTrace),post_trace:Array.from(this.postTrace),spikes:Array.from(this.spikes),last_spike:Array.from(this.lastSpike),
   ext_current:Array.from(this.extCurrent),gampa:Array.from(this.gampa),gnmda:Array.from(this.gnmda),ggabaa:Array.from(this.ggabaa),
   weights:this.synapses.map(s=>s.weight),pending:this.pending.map(slot=>slot.map(e=>({...e}))),initial_weights:this.initialWeights.slice()};
  return {schema:'mechanicus.neural-checkpoint/1',sha256:shaObj(state),state};
 }
 restore(checkpoint){
  assert(checkpoint?.schema==='mechanicus.neural-checkpoint/1','invalid checkpoint schema');
  assert(checkpoint.sha256===shaObj(checkpoint.state),'checkpoint hash mismatch');
  const s=checkpoint.state;
  assert(s.version===VERSION && s.region_id===this.region.id && s.region_config_sha256===this.regionHash,'checkpoint region/version mismatch');
  assert(s.seed===this.seed,'seed mismatch');
  assert(JSON.stringify(s.options)===JSON.stringify(this.options),'engine options mismatch');
  const N=this.active, sync=(name,target)=>{
   assert(Array.isArray(s[name])&&s[name].length===target.length,'checkpoint '+name+' length mismatch');
   assert(s[name].every(validNumber),'checkpoint '+name+' invalid numeric entries');
   target.set(s[name]);
  };
  assert(Number.isSafeInteger(s.step)&&s.step>=0&&s.step<=this.options.maxSteps,'invalid step');
  assert(Number.isSafeInteger(s.total_spikes)&&s.total_spikes>=0,'invalid spikes');
  for(const [name,target] of [['state',this.state],['adapt',this.adapt],['refractory',this.refractory],['pre_trace',this.preTrace],['post_trace',this.postTrace],['spikes',this.spikes],['last_spike',this.lastSpike],['ext_current',this.extCurrent],['gampa',this.gampa],['gnmda',this.gnmda],['ggabaa',this.ggabaa]])sync(name,target);
  assert(Array.isArray(s.weights)&&s.weights.length===this.synapses.length&&s.weights.every(x=>validNumber(x)&&x>=0&&x<=1.5),'invalid weights');
  assert(Array.isArray(s.initial_weights)&&s.initial_weights.length===this.synapses.length&&s.initial_weights.every(x=>validNumber(x)&&x>=0&&x<=1.5),'invalid baseline weights');
  assert(Array.isArray(s.pending)&&s.pending.length===this.pending.length,'invalid delay-ring slots');
  let eventCount=0;
  for(const slot of s.pending){assert(Array.isArray(slot),'invalid delay-ring');eventCount+=slot.length;assert(eventCount<=this.options.maxSynapses*this.options.maxDelayTicks,'checkpoint delay event budget');for(const ev of slot){assert(ev&&Number.isSafeInteger(ev.to)&&ev.to>=0&&ev.to<N&&['GABA','GLUTAMATE'].includes(ev.kind)&&validNumber(ev.weight)&&ev.weight>=0&&ev.weight<=1.5,'invalid delayed event');}}
  assert(Number.isSafeInteger(s.rng_state)&&s.rng_state>=0&&s.rng_state<=0xffffffff,'invalid RNG state');
  assert(validNumber(s.reward)&&s.reward>=-1&&s.reward<=1,'invalid reward');
  this.stepIndex=s.step;this.totalSpikes=s.total_spikes;this.rng.state=s.rng_state;this.reward=s.reward;
  this.synapses.forEach((syn,i)=>{syn.weight=s.weights[i];});this.initialWeights=s.initial_weights.slice();
  this.pending=s.pending.map(slot=>slot.map(e=>({...e})));
  return this;
 }
}
module.exports={SparseNeuralEngine,PRNG,VERSION,safeOptions,populationList};
