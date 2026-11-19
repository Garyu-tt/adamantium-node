// SPDX-License-Identifier: Apache-2.0
// The only write path: pinned identity + Node-RED Admin v2 revision CAS + readback.
import {createHash} from 'node:crypto';
const fail=code=>{throw Object.assign(new Error(code),{code});};
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const copy=x=>JSON.parse(JSON.stringify(x));
const id=/^adamantium-[a-z][a-z0-9-]{1,48}$/;
const idem=/^[a-zA-Z0-9._:-]{8,96}$/;

export class FactorySandboxAdmin{
 constructor({baseUrl,token,sandboxId}){
  const url=new URL(baseUrl);
  if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||
   url.pathname!=='/'||url.search||url.hash||!url.port)
   throw new TypeError('sandbox_must_be_pinned_loopback');
  if(typeof token!=='string'||token.length<24||
   !/^[a-z0-9-]{16,96}$/.test(sandboxId||''))
   throw new TypeError('sandbox_identity_required');
  this.baseUrl=url.origin;
  this.token=token;
  this.sandboxId=sandboxId;
  this.memos=new Map();
 }
 async request(method,path,body,expectStatus=200){
  const response=await fetch(this.baseUrl+path,{
   method,redirect:'error',signal:AbortSignal.timeout(12000),
   headers:{Authorization:'Bearer '+this.token,
    'Node-RED-API-Version':'v2',
    ...(body===undefined?{}:{'Content-Type':'application/json'})},
   ...(body===undefined?{}:{body:JSON.stringify(body)})
  });
  if(response.headers.get('x-adamantium-sandbox-id')!==this.sandboxId)
   fail('foreign_node_red_instance');
  if(response.status!==expectStatus){
   const e=Object.assign(new Error('admin_http_status_'+response.status),{
    status:response.status});
   throw e;
  }
  return response.status===204?null:response.json();
 }
 async inspect(){
  const state=await this.request('GET','/flows');
  if(!state||typeof state.rev!=='string'||state.rev.length<1||
   state.rev.length>256||!Array.isArray(state.flows)||state.flows.length>256)
   fail('invalid_node_red_revision_envelope');
  return copy({rev:state.rev,flows:state.flows});
 }
 async availableTypes(){
  const nodes=await this.request('GET','/nodes');
  if(!Array.isArray(nodes))fail('invalid_palette_registry');
  return nodes;
 }
 async deployFactory({nodeType,baseRevision,idempotencyKey}){
  if(!id.test(nodeType||'')||!idem.test(idempotencyKey||'')||
   typeof baseRevision!=='string')
   fail('invalid_factory_deploy_request');
  const input={nodeType,baseRevision};
  const saved=this.memos.get('deploy:'+idempotencyKey);
  if(saved){
   if(saved.hash!==hash(input))fail('idempotency_payload_conflict');
   return copy(saved.result);
  }
  const previous=await this.inspect();
  if(previous.rev!==baseRevision)fail('revision_conflict');
  // Only an empty, dedicated userDir may be touched, never existing flows.
  if(previous.flows.length!==0)fail('nonempty_sandbox_refused');
  const registry=await this.availableTypes();
  if(!JSON.stringify(registry).includes('"'+nodeType+'"'))
   fail('generated_node_not_registered');
  const flows=factoryTestFlow(nodeType);
  const response=await this.request('POST','/flows',
   {rev:baseRevision,flows});
  if(!response||typeof response.rev!=='string'||response.rev===baseRevision)
   fail('invalid_deployment_receipt');
  const after=await this.inspect();
  if(after.rev!==response.rev||hash(after.flows)!==hash(flows))
   fail('deployment_readback_mismatch');
  const result={
   schema:'adamantium.sandbox.deployment/1',sandboxId:this.sandboxId,
   nodeType,revisionBefore:previous.rev,revisionAfter:after.rev,
   beforeDigest:hash(previous.flows),afterDigest:hash(after.flows),
   previousFlows:previous.flows,proposedFlows:flows,
   verifiedReadback:true,productionDeployment:false,
   rollbackRequired:true
  };
  this.memos.set('deploy:'+idempotencyKey,{hash:hash(input),result:copy(result)});
  return copy(result);
 }
 async rollbackFactory({ticket,baseRevision,idempotencyKey}){
  if(!idem.test(idempotencyKey||'')||!ticket||
   ticket.sandboxId!==this.sandboxId||typeof baseRevision!=='string')
   fail('invalid_rollback_ticket');
  const input={ticket,baseRevision};
  const saved=this.memos.get('rollback:'+idempotencyKey);
  if(saved){
   if(saved.hash!==hash(input))fail('idempotency_payload_conflict');
   return copy(saved.result);
  }
  const current=await this.inspect();
  if(current.rev!==baseRevision||current.rev!==ticket.revisionAfter)
   fail('revision_conflict');
  if(hash(current.flows)!==ticket.afterDigest||
   !Array.isArray(ticket.previousFlows)||
   ticket.previousFlows.length!==0||
   hash(ticket.previousFlows)!==ticket.beforeDigest)
   fail('unsafe_rollback_checkpoint');
  const response=await this.request('POST','/flows',
   {rev:current.rev,flows:ticket.previousFlows});
  const after=await this.inspect();
  if(after.rev!==response.rev||hash(after.flows)!==ticket.beforeDigest||
   after.flows.length!==0)
   fail('rollback_readback_mismatch');
  const result={schema:'adamantium.sandbox.rollback/1',
   sandboxId:this.sandboxId,from:baseRevision,to:after.rev,
   verifiedReadback:true,flowsRestored:0,productionRollback:false};
  this.memos.set('rollback:'+idempotencyKey,{hash:hash(input),result:copy(result)});
  return copy(result);
 }
}
export function factoryTestFlow(nodeType){
 if(!id.test(nodeType||''))fail('invalid_generated_node_type');
 const tab='factory-r03-tab',producer='factory-r03-source';
 const transform='factory-r03-transform',sink='factory-r03-debug';
 return [
  {id:tab,type:'tab',label:'Adamantium Factory R03 sandbox',disabled:false,info:''},
  {id:producer,type:'inject',z:tab,name:'one-shot fixture',
   props:[{p:'payload'}],repeat:'',crontab:'',once:true,onceDelay:0.35,
   topic:'',payload:'node factory r03 verified',payloadType:'str',
   x:160,y:120,wires:[[transform]]},
  {id:transform,type:nodeType,z:tab,name:'generated verified transform',
   x:380,y:120,wires:[[sink]]},
  {id:sink,type:'debug',z:tab,name:'isolated verification',
   active:true,tosidebar:false,console:true,tostatus:false,
   complete:'payload',targetType:'msg',statusVal:'',statusType:'auto',
   x:630,y:120,wires:[]}
 ];
}
