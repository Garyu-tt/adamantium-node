'use strict';
/** CPU-first typed sensor sessions with revision manager and acquired state isolation. */
const {NeuralCircuit,patternFrame}=require('../vendor/r03/lib/circuit.cjs');
const {makeFrame,BoundedSensoryStream}=require('./typed-sensory.cjs');
const {RevisionManager}=require('./revision-manager.cjs');
const {captureAcquired,applyAcquired}=require('./acquired-store.cjs');
class DanteSession {
 constructor(options={}){
  this.circuit=new NeuralCircuit(options);this.stream=new BoundedSensoryStream(this.circuit);
  this.revisions=new RevisionManager(this.circuit);
 }
 frame(pixels,offset=0){return makeFrame({sequence:this.stream.nextSequence+this.stream.queue.length,
  tick:this.circuit.stepNumber+this.stream.queue.length,pixels});}
 enqueue(frame){return this.stream.enqueue(frame);}
 step(){return this.stream.drainOne({gain:this.revisions.policy.sensory_gain});}
 tickSynthetic(pattern=this.circuit.pattern){const f=this.frame(patternFrame(pattern,this.circuit.stepNumber));this.enqueue(f);return this.step();}
 runSynthetic(steps,pattern=this.circuit.pattern){if(!Number.isSafeInteger(steps)||steps<0||steps>2000)throw Error('invalid synthetic run steps');
  const traces=[];for(let i=0;i<steps;i++)traces.push(this.tickSynthetic(pattern));return {traces,summary:this.summary()};}
 acquired(){return captureAcquired(this.circuit);}
 applyAcquired(record){return applyAcquired(this.circuit,record);}
 stageRevision(change){return this.revisions.stage(change);}
 commitRevision(){if(this.stream.queue.length)throw Error('cannot commit runtime policy with queued unconsumed frames');return this.revisions.commit();}
 summary(){return {...this.circuit.summary(),sensory_stream:this.stream.status(),runtime_revision:this.revisions.status()};}
}
module.exports={DanteSession};
