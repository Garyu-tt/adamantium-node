// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import {AgentFactoryService} from '../../adamantium/agent-gateway/factory-service.mjs';
import {demoFactoryContract} from '../../adamantium/node-factory/contract.mjs';
import {renderNodePackage} from '../../adamantium/node-factory/generate.mjs';
const draft=(contract=demoFactoryContract())=>({
 contract,base_revision:0,idempotency_key:'unit-propose-0001'
});
const verify=(proposal,revision)=>({
 proposal_id:proposal.id,base_revision:revision,
 idempotency_key:'unit-verify-0001'
});
function fakeReport(contract){
 const result=renderNodePackage(contract);
 return {nodeType:result.nodeType,packageName:result.packageName,
  artifactHashes:result.sha256,installedBytesVerified:true,
  actualNodeRedExecution:true,expectedOutputObserved:true,
  registeredInTestPalette:true,rollbackVerified:true,sandboxDestroyed:true,
  productionDeployment:false,productionPublication:false,
  authorizedForLifecycle:false};
}
test('R04 proposes only a bounded typed, idempotent package contract',async()=>{
 const factory=new AgentFactoryService();
 const first=factory.propose(draft());
 assert.equal(first.status,'proposed');
 assert.equal(first.catalogRevision,1);
 assert.equal(first.published,false);
 assert.equal(first.nodeType,'adamantium-demo-uppercase');
 assert.deepEqual(factory.propose(draft()),first);
 assert.equal(factory.inspect().revision,1);
 assert.deepEqual(factory.template().transforms,['uppercase','suffix']);
 assert.throws(()=>factory.propose({...draft(),base_revision:0,
  idempotency_key:'fresh-request-1'}),/revision_conflict/);
 assert.throws(()=>factory.propose({...draft(),contract:{...demoFactoryContract(),
  arbitraryJS:'require("child_process")'}}),/invalid_contract_fields/);
 assert.throws(()=>factory.propose({...draft(),contract:{...demoFactoryContract(),
  suffix:'INVALID'}}),/unsafe_node_suffix/);
 await assert.rejects(factory.verify(verify(first,1)),/factory_verification_disabled/);
 await assert.rejects(factory.invoke('factory.publish',{}),/factory_publication_forbidden/);
 await assert.rejects(factory.invoke('factory.install',{}),/factory_publication_forbidden/);
});
test('agent verification grants evidence only, never production install',async()=>{
 let runs=0;
 const factory=new AgentFactoryService({verifyEnabled:true,runner:async contract=>{
  runs++;return fakeReport(contract);
 }});
 const proposal=factory.propose(draft());
 const verified=await factory.verify(verify(proposal,1));
 assert.equal(runs,1);
 assert.equal(verified.receipt.actualNodeRedExecution,true);
 assert.equal(verified.receipt.rollbackVerified,true);
 assert.equal(verified.receipt.productionDeployment,false);
 assert.equal(verified.receipt.needsIndependentMASApproval,true);
 assert.equal(factory.inspect().proposals[0].status,'verified');
 assert.equal(factory.inspect().revision,2);
 assert.deepEqual(await factory.verify(verify(proposal,1)),verified);
 assert.equal(runs,1);
 await assert.rejects(factory.verify({...verify(proposal,1),
  proposal_id:'candidate-different'}),/idempotency_payload_conflict/);
});
test('in-flight CAS lease deduplicates one request and rejects concurrent mutation',async()=>{
 let release;const gate=new Promise(resolve=>{release=resolve;});
 let calls=0;
 const factory=new AgentFactoryService({verifyEnabled:true,runner:async contract=>{
  calls++;await gate;return fakeReport(contract);
 }});
 const proposal=factory.propose(draft());
 const task1=factory.verify(verify(proposal,1));
 const task2=factory.verify(verify(proposal,1));
 await assert.rejects(factory.verify({...verify(proposal,1),
  idempotency_key:'second-verification-attempt'}),/factory_worker_busy/);
 release();
 const [a,b]=await Promise.all([task1,task2]);
 assert.deepEqual(a,b);
 assert.equal(calls,1);
 assert.equal(factory.inspect().busy,false);
});
test('untrusted test receipts fail closed with no promotion and no retries',async()=>{
 const factory=new AgentFactoryService({verifyEnabled:true,runner:async c=>({
  ...fakeReport(c),sandboxDestroyed:false
 })});
 const proposal=factory.propose(draft());
 await assert.rejects(factory.verify(verify(proposal,1)),/factory_proof_incomplete/);
 assert.equal(factory.inspect().proposals[0].status,'rejected');
 await assert.rejects(factory.verify({...verify(proposal,2),
  idempotency_key:'repeat-after-failure'}),/candidate_not_pending/);
 assert.equal(factory.inspect().proposals[0].verified,false);
});
test('actual verification runner failure is redacted and sandbox stays unpromoted',async()=>{
 const factory=new AgentFactoryService({verifyEnabled:true,runner:async()=>{
  throw new Error('/private/path/with/token=should-never-appear');
 }});
 const proposal=factory.propose(draft());
 await assert.rejects(factory.verify(verify(proposal,1)),e=>
  e.code==='factory_verification_failed'&&!e.message.includes('private'));
 assert.equal(factory.inspect().proposals[0].failureCode,'factory_verification_failed');
});
