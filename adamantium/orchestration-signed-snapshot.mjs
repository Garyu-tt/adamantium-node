/**
 * AN-0005 — signed read-only Graph Manager snapshots (no transport or execution).
 * A verified snapshot is still NOT permission to invoke any MAS capability.
 * SPDX-License-Identifier: Apache-2.0
 */
import {createHash,sign as signEd,verify as verifyEd} from 'node:crypto';
import {TextDecoder} from 'node:util';
import {validateOrchestrationView} from './orchestration-view-contract.mjs';
import {projectOrchestrationMobileUI} from './orchestration-mobile-projection.mjs';

export const SNAPSHOT_SCHEMA='mechanicus.orchestration-signed-snapshot/1';
export const SNAPSHOT_EVENT='orchestration.snapshot';
const TTL=300000, FUTURE=30000, MAX_BYTES=768*1024;
const ID=/^[a-z][a-z0-9._:-]{0,127}$/;
const B64=/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
function fail(why){throw new TypeError('Snapshot rejected: '+why);}
function exact(x,keys,name){
 if(!object(x))fail(name+' must be an object');
 for(const k of Object.keys(x))if(!keys.includes(k))fail(name+' unknown property '+k);
 for(const k of keys)if(!Object.hasOwn(x,k))fail(name+' missing '+k);
}
function identity(x,name){if(typeof x!=='string'||!ID.test(x))fail('invalid '+name);return x;}
function number(x,name){if(!Number.isSafeInteger(x)||x<1)fail('invalid '+name);return x;}
function date(x,name){
 if(typeof x!=='string'||x.length>40||
 !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(x)||
 !Number.isFinite(Date.parse(x)))fail('invalid '+name);
 return Date.parse(x);
}
function decode(x,name,max){
 if(typeof x!=='string'||x.length>Math.ceil(max/3)*4+4||!B64.test(x))fail('invalid '+name);
 const b=Buffer.from(x,'base64');
 if(b.length>max||b.toString('base64')!==x)fail('noncanonical '+name);
 return b;
}
function deepFreeze(x){
 if(x!==null&&typeof x==='object'){
  for(const v of Object.values(x))deepFreeze(v);
  Object.freeze(x);
 }
 return x;
}
function shape(payload,{expectedAuthorityProviderId,now,allowExpired=false}){
 exact(payload,['schema','streamId','sequence','revision','issuerProviderId','issuedAt','expiresAt','snapshot'],'payload');
 if(payload.schema!==SNAPSHOT_SCHEMA)fail('schema mismatch');
 identity(payload.streamId,'streamId');
 identity(payload.issuerProviderId,'issuerProviderId');
 number(payload.sequence,'sequence');
 number(payload.revision,'revision');
 const issued=date(payload.issuedAt,'issuedAt');
 const expires=date(payload.expiresAt,'expiresAt');
 if(expires<=issued||expires-issued>TTL)fail('expiry window');
 if(issued>now+FUTURE)fail('future issuedAt');
 if(!allowExpired&&expires<=now)fail('expired payload');
 const view=validateOrchestrationView(payload.snapshot);
 if(view.authorityProviderId!==payload.issuerProviderId||
   view.authorityProviderId!==expectedAuthorityProviderId)fail('authority identity mismatch');
 if(payload.revision!==view.revision)fail('revision mismatch');
 const observed=date(payload.snapshot.observedAt,'observedAt');
 if(observed>issued+FUTURE||issued-observed>TTL)fail('stale or future observation');
 for(const p of view.providers){
  const seen=date(p.observedAt,'provider observedAt');
  if(seen>issued+FUTURE||issued-seen>TTL)fail('stale or future provider status');
 }
 for(const task of view.tasks){
  if(task.status==='complete'&&task.evidenceRef==null)fail('complete task needs evidence');
 }
 return view;
}
/* Reference signing helper. Production signing keys belong solely to approved Graph Manager. */
export function createSnapshotEnvelope(snapshot,{privateKey,keyId,issuerProviderId,streamId,sequence,issuedAt,expiresAt}){
 identity(keyId,'keyId');
 const payload={schema:SNAPSHOT_SCHEMA,streamId,sequence,revision:snapshot.revision,
  issuerProviderId,issuedAt,expiresAt,snapshot};
 shape(payload,{expectedAuthorityProviderId:issuerProviderId,now:date(issuedAt,'issuedAt')});
 const bytes=Buffer.from(JSON.stringify(payload));
 if(bytes.length>MAX_BYTES)fail('signed snapshot too large');
 const signature=signEd(null,bytes,privateKey);
 return Object.freeze({keyId,algorithm:'Ed25519',
  payloadBase64:bytes.toString('base64'),signatureBase64:signature.toString('base64')});
}
/* Pinned signer, bounded canonical bytes, short-lived view; no authorization returned. */
export function verifySnapshotEnvelope(envelope,{trustedKeys,expectedAuthorityProviderId,now=Date.now(),allowExpired=false}={}){
 exact(envelope,['keyId','algorithm','payloadBase64','signatureBase64'],'envelope');
 const keyId=identity(envelope.keyId,'keyId');
 if(envelope.algorithm!=='Ed25519')fail('algorithm');
 identity(expectedAuthorityProviderId,'expected authority');
 if(!Number.isFinite(now))fail('invalid time');
 const key=trustedKeys instanceof Map?trustedKeys.get(keyId):trustedKeys?.[keyId];
 if(!key)fail('untrusted signer key');
 const raw=decode(envelope.payloadBase64,'payloadBase64',MAX_BYTES);
 const signature=decode(envelope.signatureBase64,'signatureBase64',64);
 if(signature.length!==64||!verifyEd(null,raw,key,signature))fail('invalid signature');
 let payload;
 try{payload=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}
 catch{fail('invalid signed UTF-8/JSON');}
 if(!raw.equals(Buffer.from(JSON.stringify(payload))))fail('noncanonical signed JSON');
 const view=shape(payload,{expectedAuthorityProviderId,now,allowExpired});
 const projection=deepFreeze(projectOrchestrationMobileUI(payload.snapshot));
 return Object.freeze({
  signerKeyId:keyId,streamId:payload.streamId,sequence:payload.sequence,revision:payload.revision,
  issuedAt:payload.issuedAt,expiresAt:payload.expiresAt,
  expired:Date.parse(payload.expiresAt)<=now,
  digest:createHash('sha256').update(raw).digest('hex'),
  view,projection,invocationAuthorized:false,graphMutationAuthorized:false
 });
}
/* The platform, not this reference library, persists signed envelope/high-water mark. */
export class OrchestrationReadModel{
 #keys;#authority;#stream;#sequence;#last=null;#envelope=null;
 constructor({trustedKeys,expectedAuthorityProviderId,lastAcceptedSequence=0,expectedStreamId=null}){
  identity(expectedAuthorityProviderId,'expectedAuthorityProviderId');
  if(!Number.isSafeInteger(lastAcceptedSequence)||lastAcceptedSequence<0)fail('persisted high-water sequence');
  if(expectedStreamId!==null)identity(expectedStreamId,'expectedStreamId');
  this.#keys=trustedKeys;this.#authority=expectedAuthorityProviderId;
  this.#sequence=lastAcceptedSequence;this.#stream=expectedStreamId;
 }
 #check(envelope,now,allowExpired){
  const v=verifySnapshotEnvelope(envelope,{trustedKeys:this.#keys,
   expectedAuthorityProviderId:this.#authority,now,allowExpired});
  if(this.#stream!==null&&this.#stream!==v.streamId)fail('stream identity changed');
  return v;
 }
 #accept(v,envelope){
  this.#sequence=v.sequence;
  this.#stream??=v.streamId;
  this.#last=v;this.#envelope=structuredClone(envelope);
 }
 restoreSigned(envelope,{now=Date.now()}={}){
  if(this.#last)fail('restore over active state');
  const v=this.#check(envelope,now,true);
  if(v.sequence<this.#sequence)fail('restored sequence below high-water');
  this.#accept(v,envelope);
  return this.inspect({now});
 }
 ingestSigned(envelope,{now=Date.now()}={}){
  const v=this.#check(envelope,now,false);
  if(v.sequence<=this.#sequence)fail('replayed sequence');
  if(this.#last&&v.revision<=this.#last.revision)fail('replayed graph revision');
  this.#accept(v,envelope);
  return this.inspect({now});
 }
 ingestSSEFrame(frame,{now=Date.now()}={}){
  if(typeof frame!=='string'||Buffer.byteLength(frame)>1080*1024)fail('SSE frame size');
  const lines=frame.replace(/\r\n/g,'\n').trimEnd().split('\n');
  if(lines.length!==3||!lines[0].startsWith('event: ')||
    !lines[1].startsWith('id: ')||!lines[2].startsWith('data: '))fail('SSE frame shape');
  if(lines[0].slice(7)!==SNAPSHOT_EVENT)fail('unexpected SSE event');
  let envelope;
  try{envelope=JSON.parse(lines[2].slice(6));}catch{fail('invalid SSE JSON');}
  const v=this.#check(envelope,now,false);
  if(lines[1].slice(4)!==String(v.sequence))fail('SSE id/sequence mismatch');
  return this.ingestSigned(envelope,{now});
 }
 inspect({now=Date.now()}={}){
  if(!this.#last)return Object.freeze({status:'empty',cached:false,displayOnly:true,
   invocationAuthorized:false,graphMutationAuthorized:false});
  return Object.freeze({
   status:Date.parse(this.#last.expiresAt)<=now?'offline-stale':'verified-snapshot',
   cached:true,displayOnly:true,sequence:this.#last.sequence,revision:this.#last.revision,
   expiresAt:this.#last.expiresAt,digest:this.#last.digest,
   envelope:structuredClone(this.#envelope),projection:this.#last.projection,
   invocationAuthorized:false,graphMutationAuthorized:false
  });
 }
}
