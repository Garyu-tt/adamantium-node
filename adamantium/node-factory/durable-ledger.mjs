// SPDX-License-Identifier: Apache-2.0
// Durable, single-writer, fail-closed audit of factory candidates. NOT a MAS grant.
// A local hash chain cannot prevent whole-history rollback without an independent head.
import {mkdir,writeFile,readFile,open,rm,lstat,rename} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {validateFactoryContract} from './contract.mjs';
import {renderNodePackage} from './generate.mjs';

const error=code=>Object.assign(new Error(code),{code});
const sha=s=>'sha256:'+createHash('sha256').update(s).digest('hex');
const ZERO='sha256:'+'0'.repeat(64);
const types=new Set(['factory.proposed','factory.verified','factory.rejected','factory.promotion.requested']);
const id=/^candidate-[a-f0-9]{16,64}$/;
const digest=/^sha256:[a-f0-9]{64}$/;
const exact=(x,keys)=>!!x&&typeof x==='object'&&!Array.isArray(x)&&
 Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
const clone=x=>JSON.parse(JSON.stringify(x));
const files={journal:'journal.jsonl',view:'view.json',lock:'writer.lock'};
function inspectPayload(kind,payload,state){
 if(!payload||typeof payload!=='object'||Array.isArray(payload))
  throw error('invalid_factory_event_payload');
 if(kind==='factory.proposed'){
  if(!exact(payload,['proposalId','contract','sourceDigest'])||
    !id.test(payload.proposalId)||!digest.test(payload.sourceDigest)||
    state.proposals[payload.proposalId])throw error('invalid_factory_proposal_event');
  validateFactoryContract(payload.contract);
  if(sha(JSON.stringify(renderNodePackage(payload.contract).sha256))!==payload.sourceDigest)
   throw error('factory_proposal_digest_mismatch');
 } else if(kind==='factory.verified'){
  if(!exact(payload,['proposalId','verificationDigest','proof'])||
     !id.test(payload.proposalId)||!digest.test(payload.verificationDigest)||
     state.proposals[payload.proposalId]?.status!=='proposed')
    throw error('invalid_factory_verification_event');
  const expected=renderNodePackage(state.proposals[payload.proposalId].contract);
  const proof=payload.proof;
  if(!proof||typeof proof!=='object'||
     proof.nodeType!==expected.nodeType||
     proof.packageName!==expected.packageName||
     JSON.stringify(proof.artifactHashes)!==JSON.stringify(expected.sha256)||
     proof.installedBytesVerified!==true||
     proof.actualNodeRedExecution!==true||
     proof.expectedOutputObserved!==true||
     proof.registeredInTestPalette!==true||
     proof.rollbackVerified!==true||proof.sandboxDestroyed!==true||
     proof.productionDeployment!==false||proof.productionPublication!==false||
     proof.authorizedForLifecycle!==false||
     sha(JSON.stringify(proof))!==payload.verificationDigest)
    throw error('factory_verification_proof_invalid');
 } else if(kind==='factory.rejected'){
  if(!exact(payload,['proposalId','reason'])||
    !id.test(payload.proposalId)||
    !/^[a-z_]{4,64}$/.test(payload.reason||'')||
    state.proposals[payload.proposalId]?.status!=='proposed')
    throw error('invalid_factory_rejection_event');
 } else if(kind==='factory.promotion.requested'){
  if(!exact(payload,['proposalId','approvalEffect'])||
    !id.test(payload.proposalId)||payload.approvalEffect!==false||
    state.proposals[payload.proposalId]?.status!=='verified')
    throw error('invalid_factory_promotion_request');
 } else throw error('unsupported_factory_event');
}
function apply(state,record){
 inspectPayload(record.kind,record.payload,state);
 const {proposalId}=record.payload;
 if(record.kind==='factory.proposed'){
  state.proposals[proposalId]={
   status:'proposed',contract:record.payload.contract,
   sourceDigest:record.payload.sourceDigest,
   recordedSequence:record.sequence,
   authorized:false,published:false
  };
 }else if(record.kind==='factory.verified'){
  const p=state.proposals[proposalId];
  p.status='verified';p.verificationDigest=record.payload.verificationDigest;
  p.proof=record.payload.proof;
 }else if(record.kind==='factory.rejected'){
  const p=state.proposals[proposalId];
  p.status='rejected';p.failure=record.payload.reason;
 }else if(record.kind==='factory.promotion.requested'){
  state.proposals[proposalId].promotionRequested=true;
 }
 state.sequence=record.sequence;state.head=record.hash;
 state.events++;
 return state;
}
function initial(){
 return {schema:'adamantium.factory.ledger/1',sequence:0,head:ZERO,
  events:0,proposals:Object.create(null),productionInstalled:false,
  authorizationEffective:false,persistence:'file-journal-fsync',
  independentlyWitnessed:false};
}
async function scan(root,{trustedHead, trustedSequence}={}){
 const file=join(root,files.journal);
 if(!(await lstat(file)).isFile())throw error('journal_not_regular_file');
 const body=await readFile(file,'utf8');
 if(Buffer.byteLength(body)>4*1024*1024)throw error('journal_size_exceeded');
 if(body&&!body.endsWith('\n'))throw error('torn_journal_tail');
 const state=initial();const heads=new Map([[0,ZERO]]);
 for(const line of body.split('\n')){
  if(!line)continue;
  let record;
  try{record=JSON.parse(line);}catch{throw error('journal_parse_failed');}
  if(!exact(record,['schema','sequence','previous','kind','recordedAt','payload','hash'])||
    record.schema!=='adamantium.factory.event/1'||
    record.sequence!==state.sequence+1||record.previous!==state.head||
    !types.has(record.kind)||typeof record.recordedAt!=='string'||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(record.recordedAt))
   throw error('journal_sequence_or_schema_invalid');
  const {hash,...unsigned}=record;
  if(!digest.test(hash)||sha(JSON.stringify(unsigned))!==hash)
   throw error('journal_integrity_failed');
  apply(state,record);
  heads.set(record.sequence,record.hash);
 }
 if(trustedHead!==undefined){
  if(!Number.isSafeInteger(trustedSequence)||trustedSequence<0||
    heads.get(trustedSequence)!==trustedHead)
   throw error('journal_independent_head_mismatch');
 }
 return state;
}
async function writeView(root,state){
 const view=join(root,files.view);
 const temp=join(root,'view-'+randomUUID()+'.tmp');
 const contents=JSON.stringify(state,null,2)+'\n';
 try{
  await writeFile(temp,contents,{flag:'wx',mode:0o600});
  await rename(temp,view);
 }finally{await rm(temp,{force:true});}
}
export class DurableFactoryLedger{
 constructor(root){this.root=resolve(root);}
 static async create(root){
  if(typeof root!=='string'||!root)throw error('ledger_root_required');
  const dir=resolve(root);
  await mkdir(dir,{recursive:false,mode:0o700});
  await writeFile(join(dir,files.journal),'',{flag:'wx',mode:0o600});
  await writeView(dir,initial());
  return new DurableFactoryLedger(dir);
 }
 static async open(root,{trustedHead,trustedSequence}={}){
  if(typeof root!=='string'||!root)throw error('ledger_root_required');
  const ledger=new DurableFactoryLedger(root);
  await scan(ledger.root,{trustedHead,trustedSequence});
  return ledger;
 }
 async inspect(options){return clone(await scan(this.root,options));}
 async append({kind,payload,expectedSequence,expectedHead}){
  if(!Number.isSafeInteger(expectedSequence)||expectedSequence<0||
     !digest.test(expectedHead||'')||!types.has(kind))
   throw error('invalid_factory_append');
  const text=JSON.stringify(payload);
  if(!text||Buffer.byteLength(text)>8192)throw error('factory_event_budget_exceeded');
  const lock=join(this.root,files.lock);
  let handle;
  try{handle=await open(lock,'wx',0o600);}
  catch(e){if(e.code==='EEXIST')throw error('factory_writer_busy');throw e;}
  try{
   const state=await scan(this.root);
   if(state.sequence!==expectedSequence||state.head!==expectedHead)
    throw error('revision_conflict');
   inspectPayload(kind,payload,state);
   const unsigned={
    schema:'adamantium.factory.event/1',sequence:state.sequence+1,
    previous:state.head,kind,recordedAt:new Date().toISOString(),
    payload:clone(payload)
   };
   const record={...unsigned,hash:sha(JSON.stringify(unsigned))};
   // Write complete line, fsync it, then independently re-read / validate chain.
   const out=await open(join(this.root,files.journal),'a');
   try{await out.writeFile(JSON.stringify(record)+'\n','utf8');await out.sync();}
   finally{await out.close();}
   const after=await scan(this.root);
   if(after.sequence!==record.sequence||after.head!==record.hash)
    throw error('factory_append_readback_failed');
   await writeView(this.root,after);
   return {
    schema:'adamantium.factory.journal-receipt/1',sequence:after.sequence,
    head:after.head,kind,proposalId:payload.proposalId,
    independentlyWitnessed:false,productionWrite:false,
    approvalGranted:false
   };
  }finally{await handle.close();await rm(lock,{force:true});}
 }
}
export {ZERO as FACTORY_LEDGER_GENESIS,sha as factoryDigest};
