// SPDX-License-Identifier: Apache-2.0
// R04 agent-facing contract factory: no arbitrary shell or production operations.
import {FactoryCatalog,fail,exact,keyPattern,digest,copy} from './factory-catalog.mjs';
import {verifyIsolatedFactory} from './factory-verify.mjs';
import {demoFactoryContract} from '../node-factory/contract.mjs';
import {renderNodePackage} from '../node-factory/generate.mjs';

const matches=(actual,expected)=>JSON.stringify(actual)===JSON.stringify(expected);
export class AgentFactoryService{
 constructor({verifyEnabled=false,runner=verifyIsolatedFactory,maxAttempts=3}={}){
  this.verifyEnabled=verifyEnabled===true;
  this.runner=runner;
  this.maxAttempts=maxAttempts;
  this.attempts=0;
  this.catalog=new FactoryCatalog();
  this.completed=new Map();
  this.inFlight=null;
 }
 inspect(){
  return {...this.catalog.inspect(),verifyEnabled:this.verifyEnabled,
   attemptsRemaining:Math.max(0,this.maxAttempts-this.attempts),
   busy:this.inFlight!==null};
 }
 template(){
  return {schema:'adamantium.factory.template/1',
   sample:demoFactoryContract(),transforms:['uppercase','suffix'],
   arbitrarySourceAllowed:false,publishEnabled:false,
   executionScope:'disposable-node-red-only'};
 }
 propose(args){return this.catalog.propose(args);}
 async verify(args){
  if(!exact(args,['proposal_id','base_revision','idempotency_key'])||
   !keyPattern.test(args.idempotency_key||'')||
   typeof args.proposal_id!=='string')
   fail('invalid_factory_verification_request');
  if(!this.verifyEnabled)fail('factory_verification_disabled');
  const signature=digest({id:args.proposal_id,revision:args.base_revision});
  const cached=this.completed.get(args.idempotency_key);
  if(cached){
   if(cached.signature!==signature)fail('idempotency_payload_conflict');
   return copy(cached.result);
  }
  if(this.inFlight){
   if(this.inFlight.key===args.idempotency_key){
    if(this.inFlight.signature!==signature)fail('idempotency_payload_conflict');
    return copy(await this.inFlight.promise);
   }
   fail('factory_worker_busy');
  }
  if(args.base_revision!==this.catalog.revision)fail('revision_conflict');
  const candidate=this.catalog.lookup(args.proposal_id);
  if(candidate.public.status!=='proposed')fail('candidate_not_pending');
  if(this.attempts>=this.maxAttempts)fail('factory_verification_quota');
  this.attempts++;
  const task=this.#run(candidate,args.proposal_id);
  this.inFlight={key:args.idempotency_key,signature,promise:task};
  try{
   const result=await task;
   this.completed.set(args.idempotency_key,{signature,result:copy(result)});
   return copy(result);
  }finally{this.inFlight=null;}
 }
 async #run(candidate,id){
  try{
   const report=await this.runner(copy(candidate.contract));
   const pinned=renderNodePackage(candidate.contract);
   if(!report||report.nodeType!==pinned.nodeType||
    report.packageName!==pinned.packageName||
    !matches(report.artifactHashes,pinned.sha256)||
    report.installedBytesVerified!==true||
    report.actualNodeRedExecution!==true||
    report.expectedOutputObserved!==true||
    report.registeredInTestPalette!==true||
    report.rollbackVerified!==true||
    report.sandboxDestroyed!==true||
    report.productionDeployment!==false||
    report.productionPublication!==false||
    report.authorizedForLifecycle!==false)
    fail('factory_proof_incomplete');
   const receipt={
    schema:'adamantium.factory.agent-verification/1',
    proposalId:id,packageName:pinned.packageName,nodeType:pinned.nodeType,
    sourceDigests:pinned.sha256,verifiedReport:report,
    actualNodeRedExecution:true,rollbackVerified:true,
    productionDeployment:false,published:false,
    needsIndependentMASApproval:true
   };
   this.catalog.complete(id,receipt);
   return {ok:true,receipt,catalogRevision:this.catalog.revision};
  }catch(e){
   const code=e.code==='factory_proof_incomplete'?e.code:
    'factory_verification_failed';
   this.catalog.fail(id,code);
   throw Object.assign(new Error(code),{code});
  }
 }
 async invoke(operation,args={}){
  switch(operation){
   case 'factory.inspect':return this.inspect();
   case 'factory.template':return this.template();
   case 'factory.propose':return this.propose(args);
   case 'factory.verify':return this.verify(args);
   case 'factory.publish':
   case 'factory.install':
   case 'factory.deploy':throw Object.assign(new Error('factory_publication_forbidden'),
    {code:'factory_publication_forbidden',status:403});
   default:fail('unknown_factory_operation');
  }
 }
}
