'use strict';
/** Strict, bounded synthetic sensory events, independent of Node-RED and hardware. */
const {createHash}=require('node:crypto');
const {validateFrame}=require('../vendor/r03/lib/circuit.cjs');
const SCHEMA='mechanicus.sensor-frame/1';
const digest=o=>createHash('sha256').update(JSON.stringify(o)).digest('hex');
function assert(x,m){if(!x)throw Error(m);}
function makeFrame({sequence,tick,pixels,source='genesis.synthetic.8x8',channel='vision.gray8x8'}={}){
 assert(Number.isSafeInteger(sequence)&&sequence>=0,'invalid sensor sequence');
 assert(Number.isSafeInteger(tick)&&tick>=0,'invalid sensor tick');
 assert(source==='genesis.synthetic.8x8','only synthetic fixture source is permitted');
 assert(channel==='vision.gray8x8','unsupported sensory channel');
 validateFrame(pixels);
 const core={schema:SCHEMA,source,channel,sequence,tick,pixels:pixels.slice()};
 return {...core,sha256:digest(core)};
}
function verifyFrame(frame,expectedSequence,expectedTick){
 assert(frame&&typeof frame==='object'&&!Array.isArray(frame),'sensor frame must be object');
 assert(Object.keys(frame).sort().join(',')==='channel,pixels,schema,sequence,sha256,source,tick','sensor frame has unknown or missing fields');
 assert(frame.schema===SCHEMA,'sensor schema mismatch');
 const recreated=makeFrame(frame);
 assert(recreated.sha256===frame.sha256,'sensor frame integrity mismatch');
 assert(frame.sequence===expectedSequence,'out-of-order or replayed sensory sequence');
 assert(frame.tick===expectedTick,'noncontiguous sensory tick');
 return recreated;
}
class BoundedSensoryStream {
 constructor(circuit,{maxQueued=8}={}){
  assert(circuit&&typeof circuit.step==='function','neural circuit required');
  assert(Number.isSafeInteger(maxQueued)&&maxQueued>=1&&maxQueued<=64,'invalid sensory queue budget');
  this.circuit=circuit;this.maxQueued=maxQueued;this.queue=[];this.nextSequence=0;this.dropped=0;this.accepted=0;
 }
 enqueue(frame){
  assert(this.queue.length<this.maxQueued,'sensory backpressure limit exceeded');
  const prepared=verifyFrame(frame,this.nextSequence+this.queue.length,this.circuit.stepNumber+this.queue.length);
  assert(this.circuit.stepNumber+this.queue.length<this.circuit.maxSteps,'neural step budget exhausted');
  this.queue.push(prepared);
  return {accepted:true,queued:this.queue.length,sequence:prepared.sequence};
 }
 drainOne({gain=1}={}){
  assert(this.queue.length>0,'no queued sensor frame');
  assert(typeof gain==='number'&&Number.isFinite(gain)&&gain>=0.1&&gain<=1,'invalid bounded sensory gain');
  const frame=this.queue[0];verifyFrame(frame,this.nextSequence,this.circuit.stepNumber);
  // Stepping is synchronous and R03 refuses input outside the allowed range.
  // A failed downstream step leaves the original queued frame available to retry.
  const result=this.circuit.step(frame.pixels.map(v=>v*gain));
  this.queue.shift();this.nextSequence++;this.accepted++;
  return {...result,sensor_frame:{source:frame.source,sequence:frame.sequence,sha256:frame.sha256}};
 }
 status(){return {schema:'mechanicus.sensory-stream-status/1',queued:this.queue.length,queue_capacity:this.maxQueued,accepted:this.accepted,next_sequence:this.nextSequence,tick:this.circuit.stepNumber,hardware_access:false};}
}
module.exports={SCHEMA,digest,makeFrame,verifyFrame,BoundedSensoryStream};
