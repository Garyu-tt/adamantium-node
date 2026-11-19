// SPDX-License-Identifier: Apache-2.0
// R04: bounded, volatile proposal catalog. No installed executable enters this store.
import {createHash} from 'node:crypto';
import {renderNodePackage} from '../node-factory/generate.mjs';

const fail=code=>{throw Object.assign(new Error(code),{code});};
const stable=value=>JSON.stringify(value);
const digest=value=>'sha256:'+createHash('sha256').update(stable(value)).digest('hex');
const keyPattern=/^[a-zA-Z0-9._:-]{8,96}$/;
const own=(x,k)=>Object.prototype.hasOwnProperty.call(x,k);
const exact=(x,keys)=>!!x&&typeof x==='object'&&!Array.isArray(x)&&
 Object.keys(x).length===keys.length&&keys.every(k=>own(x,k));
const copy=x=>JSON.parse(JSON.stringify(x));
export class FactoryCatalog {
 constructor({maxProposals=12}={}){
  this.revision=0;this.maxProposals=maxProposals;
  this.proposals=new Map();this.requests=new Map();
 }
 inspect(){
  return {schema:'adamantium.factory.catalog/1',revision:this.revision,
   proposals:[...this.proposals.values()].map(p=>copy(p.public)),
   persistence:'volatile',verifyEnabled:false,publishEnabled:false};
 }
 lookup(id){
  const item=this.proposals.get(id);
  if(!item)fail('proposal_not_found');
  return item;
 }
 propose(args){
  if(!exact(args,['contract','base_revision','idempotency_key'])||
   typeof args.idempotency_key!=='string'||!keyPattern.test(args.idempotency_key))
   fail('invalid_factory_proposal');
  const rendered=renderNodePackage(args.contract);
  const signature=digest({contract:rendered.contract,base_revision:args.base_revision});
  const earlier=this.requests.get(args.idempotency_key);
  if(earlier){
   if(earlier.signature!==signature)fail('idempotency_payload_conflict');
   return copy(earlier.result);
  }
  if(args.base_revision!==this.revision)fail('revision_conflict');
  if(this.proposals.size>=this.maxProposals)fail('factory_proposal_quota_exhausted');
  const id='candidate-'+digest(rendered.contract).slice(7,31);
  if(this.proposals.has(id))fail('duplicate_factory_candidate');
  const publicProposal={
   id,revision:this.revision+1,status:'proposed',
   nodeType:rendered.nodeType,packageName:rendered.packageName,
   contract:rendered.contract,sourceDigests:rendered.sha256,
   outputDigest:digest(rendered.sha256),verified:false,
   published:false,installedInProduction:false
  };
  this.proposals.set(id,{public:publicProposal,contract:rendered.contract});
  this.revision++;
  const result={...publicProposal,catalogRevision:this.revision,
   actualNodeRedExecution:false,requiresVerification:true};
  this.requests.set(args.idempotency_key,{signature,result:copy(result)});
  return copy(result);
 }
 complete(id,receipt){
  const item=this.lookup(id);
  if(item.public.status!=='proposed')fail('candidate_already_processed');
  item.public.status='verified';
  item.public.verified=true;
  item.public.verification=copy(receipt);
  this.revision++;
 }
 fail(id,code){
  const item=this.lookup(id);
  if(item.public.status!=='proposed')return;
  item.public.status='rejected';
  item.public.failureCode=code;
  this.revision++;
 }
}
export {digest,keyPattern,exact,fail,copy};
