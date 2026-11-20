'use strict';
const {createHash}=require('node:crypto');
const {SparseNeuralEngine}=require('./neural-engine.cjs');
const V1=require('../examples/dante-v1-left.json');
const LGN=require('../examples/lgn.json');
const V2=require('../examples/v2.json');
const SCHEMA='mechanicus.neural-circuit/3';
const hash=o=>createHash('sha256').update(JSON.stringify(o)).digest('hex');
function requireFlag(ok,msg){if(!ok)throw Error(msg);}
function patternFrame(pattern,tick){
 requireFlag(['moving-bar','dark','bright','checkerboard'].includes(pattern),'unknown fixture pattern');
 const frame=[];
 for(let y=0;y<8;y++)for(let x=0;x<8;x++){
  let v=0;
  if(pattern==='moving-bar')v=x===Math.floor(tick/4)%8?1:0;
  if(pattern==='bright')v=1;
  if(pattern==='checkerboard')v=((x+y+Math.floor(tick/4))%2)?1:0;
  frame.push(v);
 }
 return frame;
}
function validateFrame(frame){
 requireFlag(Array.isArray(frame)&&frame.length===64,'sensor frame must contain exactly 64 float samples');
 requireFlag(frame.every(x=>typeof x==='number'&&Number.isFinite(x)&&x>=0&&x<=1),'sensor values must lie within [0,1]');
 return frame;
}
const links=Object.freeze([
 {id:'LGN→V1',source:'LGN',sourcePop:'LGN.E',dest:'V1',destPop:'L4.E',delay:2,maxFanout:16,amp:2.6},
 {id:'V1→V2',source:'V1',sourcePop:'L2.E',dest:'V2',destPop:'V2.E',delay:3,maxFanout:14,amp:2.5},
 {id:'V2→V1',source:'V2',sourcePop:'V2.E',dest:'V1',destPop:'L6.E',delay:4,maxFanout:8,amp:1.8}
]);
class NeuralCircuit {
 constructor({seed=42,pattern='moving-bar',activeV1=896,maxSteps=2000}={}){
  requireFlag(Number.isSafeInteger(seed)&&seed>=0&&seed<=4294967295,'invalid seed');
  requireFlag(Number.isInteger(activeV1)&&activeV1>0&&activeV1<=2048,'invalid V1 budget');
  requireFlag(Number.isInteger(maxSteps)&&maxSteps>0&&maxSteps<=50000,'invalid step budget');
  patternFrame(pattern,0);
  this.pattern=pattern;this.seed=seed;this.maxSteps=maxSteps;
  this.engines={LGN:new SparseNeuralEngine(LGN,{seed,maxActive:2048,maxSteps}),
    V1:new SparseNeuralEngine(V1,{seed,activeBudget:activeV1,maxActive:2048,maxSteps}),
    V2:new SparseNeuralEngine(V2,{seed,maxActive:2048,maxSteps})};
  this.stepNumber=0;this.queue=[];
  this.delivered={};this.scheduled={};this.totalFrames=0;
  for(const l of links){this.delivered[l.id]=0;this.scheduled[l.id]=0;
    requireFlag(this.engines[l.source].map.has(l.sourcePop),'missing source '+l.sourcePop);
    requireFlag(this.engines[l.dest].map.has(l.destPop),'missing target '+l.destPop);
  }
  this.genomeHashes=Object.fromEntries(Object.entries(this.engines).map(([k,v])=>[k,v.regionHash]));
 }
 applyInput(frame){
  validateFrame(frame);
  const e=this.engines.LGN,p=e.map.get('LGN.E');
  let applied=0;
  // Spatial proxy: 8x8 grayscale sensors map deterministically onto materialized relay cells.
  for(let i=0;i<p.count;i++){
   const sensorIndex=Math.floor(i*64/p.count);
   const brightness=frame[sensorIndex];
   if(brightness>0){e.extCurrent[p.offset+i]+=3.2*brightness;applied++;}
  }
  this.totalFrames++;
  return applied;
 }
 step(frame=null){
  requireFlag(this.stepNumber<this.maxSteps,'step budget exceeded');
  const t=this.stepNumber;
  const sourceFrame=frame===null?patternFrame(this.pattern,t):validateFrame(frame);
  const inputCells=this.applyInput(sourceFrame);
  const due=this.queue.filter(x=>x.at===t);
  this.queue=this.queue.filter(x=>x.at!==t);
  for(const event of due){
   const cfg=links.find(x=>x.id===event.link);requireFlag(!!cfg,'unknown projection event');
   const dest=this.engines[cfg.dest],p=dest.map.get(cfg.destPop);
   const n=Math.min(event.count,p.count);
   for(let i=0;i<n;i++)dest.extCurrent[p.offset+i]+=event.amp;
   this.delivered[cfg.id]+=n;
  }
  const regionTicks={};
  for(const [name,e] of Object.entries(this.engines))regionTicks[name]=e.step();
  const scheduled=[];
  for(const cfg of links){
   const src=this.engines[cfg.source],pop=src.map.get(cfg.sourcePop);
   let fired=0;
   for(let k=pop.offset;k<pop.offset+pop.count;k++)fired+=src.spikes[k];
   if(fired===0)continue;
   const count=Math.min(cfg.maxFanout,fired);
   requireFlag(this.queue.length<1024,'inter-region event queue budget exceeded');
   this.queue.push({link:cfg.id,at:t+cfg.delay,count,amp:cfg.amp});
   this.scheduled[cfg.id]+=count;scheduled.push({link:cfg.id,spikes:fired,relayed:count,due:t+cfg.delay});
  }
  this.stepNumber++;
  return {schema:SCHEMA,event:'circuit.tick',tick:this.stepNumber,fixture:this.pattern,sensor_cells_excited:inputCells,
    region_spikes:Object.fromEntries(Object.entries(regionTicks).map(([key,v])=>[key,v.spikes])),
    delivered:due.map(x=>({link:x.link,count:x.count})),scheduled,queued_events:this.queue.length};
 }
 run(steps,{collectEvery=1}={}){
  requireFlag(Number.isInteger(steps)&&steps>=0&&steps+this.stepNumber<=this.maxSteps,'invalid steps');
  requireFlag(Number.isInteger(collectEvery)&&collectEvery>0&&collectEvery<=10000,'invalid telemetry stride');
  const telemetry=[];
  for(let i=0;i<steps;i++){const t=this.step();if(i%collectEvery===0||i===steps-1)telemetry.push(t)}
  return {telemetry,summary:this.summary()};
 }
 summary(){
  const regions=Object.fromEntries(Object.entries(this.engines).map(([k,v])=>[k,v.summary()]));
  return {schema:SCHEMA,event:'circuit.summary',simulation_steps:this.stepNumber,seed:this.seed,pattern:this.pattern,
    regions,bridge_type:'bounded_populations_to_current_proxy_not_anatomical_axons',
    cross_region_links:links.map(l=>({id:l.id,from:l.sourcePop,to:l.destPop,delay_ticks:l.delay,scheduled:this.scheduled[l.id],delivered:this.delivered[l.id]})),
    sensor:{kind:'synthetic-8x8-grayscale-fixture',frames:this.totalFrames,raw_camera_access:false},
    total_spikes:Object.values(regions).reduce((s,r)=>s+r.total_spikes,0),
    genomes_unchanged:Object.entries(this.engines).every(([k,e])=>e.regionHash===this.genomeHashes[k]),
    note:'Toy dynamics and bridge-current proxy; no real brain or clinical inference; no physical sensor access.'};
 }
 checkpoint(){
  const state={version:SCHEMA,pattern:this.pattern,seed:this.seed,maxSteps:this.maxSteps,stepNumber:this.stepNumber,
    genomeHashes:this.genomeHashes,queue:structuredClone(this.queue),scheduled:{...this.scheduled},delivered:{...this.delivered},totalFrames:this.totalFrames,
    engines:Object.fromEntries(Object.entries(this.engines).map(([k,v])=>[k,v.checkpoint()]))};
  return {schema:'mechanicus.neural-circuit-checkpoint/1',sha256:hash(state),state};
 }
 restore(cp){
  requireFlag(cp?.schema==='mechanicus.neural-circuit-checkpoint/1','invalid circuit checkpoint schema');
  requireFlag(cp.sha256===hash(cp.state),'circuit checkpoint corrupted');
  const s=cp.state;
  requireFlag(s.version===SCHEMA&&s.seed===this.seed&&s.pattern===this.pattern&&s.maxSteps===this.maxSteps,'circuit parameters differ');
  requireFlag(JSON.stringify(s.genomeHashes)===JSON.stringify(this.genomeHashes),'genome mismatch');
  requireFlag(Number.isSafeInteger(s.stepNumber)&&s.stepNumber>=0&&s.stepNumber<=this.maxSteps,'invalid circuit checkpoint step');
  requireFlag(Array.isArray(s.queue)&&s.queue.length<=1024,'invalid event queue');
  for(const ev of s.queue)requireFlag(links.some(l=>l.id===ev.link)&&Number.isSafeInteger(ev.at)&&ev.at>=s.stepNumber&&ev.at<=s.stepNumber+8&&Number.isInteger(ev.count)&&ev.count>0&&ev.count<=16&&typeof ev.amp==='number'&&ev.amp>0&&ev.amp<=4,'invalid queued event');
  for(const [k,v] of Object.entries(this.engines)){
   requireFlag(s.engines?.[k]?.state?.step===s.stepNumber,'engine step mismatch');v.restore(s.engines[k]);
  }
  this.queue=structuredClone(s.queue);this.stepNumber=s.stepNumber;this.scheduled={...s.scheduled};this.delivered={...s.delivered};this.totalFrames=s.totalFrames;
  return this;
 }
}
module.exports={NeuralCircuit,SCHEMA,patternFrame,validateFrame,links};
