'use strict';
/** Full deterministic session checkpoint: dynamic neuronal state + sensory queue + runtime policy. */
const {digest,verifyFrame}=require('./typed-sensory.cjs');
const {validatePolicy}=require('./revision-manager.cjs');
const {DanteSession}=require('./session.cjs');
const SCHEMA='mechanicus.dante-session-checkpoint/1';
const assert=(v,m)=>{if(!v)throw Error(m)};
function checkpointSession(session){
 assert(session instanceof DanteSession,'DanteSession required');
 assert(session.revisions.pending===null,'cannot checkpoint pending revision');
 const s=session.stream,c=session.circuit;
 assert(s.accepted===c.stepNumber&&s.nextSequence===c.stepNumber,'sensory sequence state mismatch');
 const state={schema:SCHEMA,config:{seed:c.seed,pattern:c.pattern,activeV1:c.engines.V1.active,maxSteps:c.maxSteps},
  circuit:c.checkpoint(),sequence:s.nextSequence,accepted:s.accepted,queue:structuredClone(s.queue),
  revisions:session.revisions.status()};
 return {...state,sha256:digest(state)};
}
function resumeSession(record){
 assert(record?.schema===SCHEMA,'session checkpoint schema mismatch');
 const {sha256,...state}=record;assert(sha256===digest(state),'session checkpoint integrity mismatch');
 const c=state.config;
 assert(c&&Number.isSafeInteger(c.seed)&&Number.isSafeInteger(c.activeV1)&&Number.isSafeInteger(c.maxSteps),'session config invalid');
 const s=new DanteSession(c);
 s.circuit.restore(state.circuit);
 const n=state.sequence;
 assert(Number.isSafeInteger(n)&&n===s.circuit.stepNumber,'sensory sequence/tick mismatch');
 assert(state.accepted===n,'sensory accepted count mismatch');
 assert(Array.isArray(state.queue)&&state.queue.length<=s.stream.maxQueued,'sensory queue limit mismatch');
 for(let i=0;i<state.queue.length;i++)verifyFrame(state.queue[i],n+i,s.circuit.stepNumber+i);
 s.stream.nextSequence=n;s.stream.accepted=n;s.stream.queue=structuredClone(state.queue);
 const rev=state.revisions;
 assert(rev?.schema==='mechanicus.neural-runtime-revision/1','session revision schema invalid');
 assert(Number.isSafeInteger(rev.version)&&rev.version>=0&&rev.version<=10000,'revision count invalid');
 assert(Array.isArray(rev.history)&&rev.history.length===rev.version,'revision history invalid');
 assert(rev.pending===false,'session cannot resume pending policy');
 assert(typeof rev.revision==='string'&&rev.revision.length>0&&rev.revision.length<=65,'revision name invalid');
 assert(JSON.stringify(rev.genome_hashes)===JSON.stringify(s.circuit.genomeHashes),'session genome mismatch');
 const policy=validatePolicy(rev.policy);
 for(const [k,e] of Object.entries(s.circuit.engines))assert(e.reward===policy.reward[k],'revision reward differs from neuron checkpoint');
 s.revisions.current=rev.revision;s.revisions.version=rev.version;
 s.revisions.policy=policy;s.revisions.history=structuredClone(rev.history);
 return s;
}
module.exports={SCHEMA,checkpointSession,resumeSession};
