'use strict';
/**
 * GENESIS R06 + R04: sequential, non-concurrent session growth with queued sensory frames.
 * No camera or remote worker; R04 restricted synthetic sensory records only.
 */
const {createHash}=require('node:crypto');
const {DanteSession}=require('../r04/session.cjs');
const {verifyFrame}=require('../r04/typed-sensory.cjs');
const {validatePolicy}=require('../r04/revision-manager.cjs');
const {LiveGrowth}=require('./live-growth.cjs');
const SCHEMA='mechanicus.dante-growth-session/1';
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const check=(ok,m)=>{if(!ok)throw new Error(m)};
function sessionState(s){
 const stream=s.stream,policy=s.revisions.status();
 check(s.revisions.pending===null,'runtime policy revision pending');
 check(stream.nextSequence===s.circuit.stepNumber&&stream.accepted===stream.nextSequence,'sensory sequence and circuit tick differ');
 check(stream.queue.length<=stream.maxQueued,'sensory queue overflow');
 stream.queue.forEach((f,i)=>verifyFrame(f,stream.nextSequence+i,s.circuit.stepNumber+i));
 return {sensory:{maxQueued:stream.maxQueued,nextSequence:stream.nextSequence,accepted:stream.accepted,dropped:stream.dropped,queue:structuredClone(stream.queue)},
   policy};
}
function snapshotSession(manager){
 check(manager instanceof LiveSessionGrowth,'LiveSessionGrowth instance required');
 check(manager.growth.pending===null,'cannot snapshot uncommitted growth');
 const state={schema:SCHEMA,growth:manager.growth.snapshot(),...sessionState(manager.session)};
 return {...state,sha256:sha(state)};
}
function restoreSession(record){
 check(record?.schema===SCHEMA,'R06 session schema invalid');
 const {sha256,...state}=record;check(sha256===sha(state),'R06 session checksum mismatch');
 const growth=LiveGrowth.resume(record.growth);
 const options={seed:growth.circuit.seed,pattern:growth.circuit.pattern,maxSteps:growth.circuit.maxSteps,activeV1:growth.circuit.engines.V1.active};
 const s=new DanteSession(options);
 s.circuit=growth.circuit;s.stream.circuit=growth.circuit;s.revisions.circuit=growth.circuit;
 const st=record.sensory;
 check(st&&Number.isSafeInteger(st.maxQueued)&&st.maxQueued>=1&&st.maxQueued<=64,'sensory queue capacity invalid');
 check(st.nextSequence===growth.circuit.stepNumber&&st.accepted===st.nextSequence,'sensory sequence mismatches checkpoint');
 check(Number.isSafeInteger(st.dropped)&&st.dropped>=0,'invalid dropped sensor count');
 check(Array.isArray(st.queue)&&st.queue.length<=st.maxQueued,'sensory queue invalid');
 st.queue.forEach((f,i)=>verifyFrame(f,st.nextSequence+i,growth.circuit.stepNumber+i));
 s.stream.maxQueued=st.maxQueued;s.stream.nextSequence=st.nextSequence;s.stream.accepted=st.accepted;s.stream.dropped=st.dropped;s.stream.queue=structuredClone(st.queue);
 const rev=record.policy;
 check(rev?.schema==='mechanicus.neural-runtime-revision/1'&&rev.pending===false,'policy revision invalid');
 check(Number.isSafeInteger(rev.version)&&rev.version>=0&&rev.version<=10000,'revision count invalid');
 check(Array.isArray(rev.history)&&rev.history.length===rev.version,'policy history invalid');
 check(typeof rev.revision==='string'&&rev.revision.length>0&&rev.revision.length<=65,'policy revision ID invalid');
 check(JSON.stringify(rev.genome_hashes)===JSON.stringify(s.circuit.genomeHashes),'policy genome hashes differ');
 const policy=validatePolicy(rev.policy);
 for(const [name,e] of Object.entries(s.circuit.engines))check(e.reward===policy.reward[name],'policy/checkpoint reward mismatch');
 s.revisions.current=rev.revision;s.revisions.version=rev.version;s.revisions.history=structuredClone(rev.history);s.revisions.policy=policy;
 const out=new LiveSessionGrowth(s,growth);
 check(snapshotSession(out).sha256===record.sha256,'session snapshot round trip differs');
 return out;
}
class LiveSessionGrowth{
 constructor(session=new DanteSession(),growth=null){
  check(session instanceof DanteSession,'DanteSession required');
  this.session=session;this.growth=growth||new LiveGrowth(session.circuit);
  check(this.growth.circuit===session.circuit,'session/growth circuit pointer mismatch');
  this.pendingSessionHash=null;this.rollbackSessionHash=null;
 }
 stage(request){
  check(this.session.revisions.pending===null,'pending R04 policy revision must be committed or aborted');
  const state=sessionState(this.session),hash=sha(state);
  const proposal=this.growth.stage(request);
  this.pendingSessionHash=hash;
  return {...proposal,sensory_frames_queued:state.sensory.queue.length,session_state_sha256:hash};
 }
 commit(planSha){
  check(this.pendingSessionHash!==null,'no session proposal');
  check(this.growth.circuit===this.session.circuit,'underlying session switched outside growth manager');
  check(sha(sessionState(this.session))===this.pendingSessionHash,'session frames/policy changed after staging');
  const result=this.growth.commit(planSha);
  this.session.circuit=this.growth.circuit;
  this.session.stream.circuit=this.growth.circuit;
  this.session.revisions.circuit=this.growth.circuit;
  this.rollbackSessionHash=sha(sessionState(this.session));
  this.pendingSessionHash=null;
  return {...result,sensory_queue_preserved:this.session.stream.queue.length,policy_preserved:true};
 }
 abort(){this.pendingSessionHash=null;return this.growth.abort();}
 rollback(){
  check(this.rollbackSessionHash!==null,'no session rollback');
  check(sha(sessionState(this.session))===this.rollbackSessionHash,'session changed since growth');
  const r=this.growth.rollback();
  this.session.circuit=this.growth.circuit;
  this.session.stream.circuit=this.growth.circuit;
  this.session.revisions.circuit=this.growth.circuit;
  this.rollbackSessionHash=null;
  return r;
 }
 snapshot(){return snapshotSession(this);}
 static resume(record){return restoreSession(record);}
}
module.exports={LiveSessionGrowth,sessionState,snapshotSession,restoreSession,SCHEMA};
