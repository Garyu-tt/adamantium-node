// SPDX-License-Identifier: Apache-2.0
// Complete R02→R06 proof with actual disposable Node-RED 5, no production install.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DurableFactoryWorkflow} from '../../adamantium/node-factory/durable-workflow.mjs';
import {FACTORY_LEDGER_GENESIS} from '../../adamantium/node-factory/durable-ledger.mjs';
import {FactoryAuditWitness} from '../../adamantium/node-factory/audit-witness-r06.mjs';
import {demoFactoryContract} from '../../adamantium/node-factory/contract.mjs';

test('real Node-RED proof → durable journal → signed R06 witness and advisory review',
 {timeout:180000},async()=>{
 const parent=await mkdtemp(join(tmpdir(),'mechanicus-factory-r06-real-'));
 try{
  const ledgerRoot=join(parent,'ledger');
  const witnessRoot=join(parent,'witness');
  const factory=await DurableFactoryWorkflow.create(ledgerRoot);
  const p=await factory.propose({
   contract:demoFactoryContract(),
   expectedSequence:0,expectedHead:FACTORY_LEDGER_GENESIS
  });
  const verified=await factory.verify({
   proposalId:p.proposalId,expectedSequence:p.sequence,expectedHead:p.head
  });
  const review=await factory.requestPromotion({
   proposalId:p.proposalId,expectedSequence:verified.sequence,
   expectedHead:verified.head
  });
  assert.equal(review.approvalGranted,false);
  const witness=await FactoryAuditWitness.create(witnessRoot,'node-factory-r06');
  const receipt=await witness.issue(ledgerRoot);
  assert.equal(receipt.sequence,3);
  assert.equal(receipt.approvalGranted,false);
  const reopened=await FactoryAuditWitness.open(witnessRoot,{
   expectedKeyFingerprint:(await witness.inspect()).keyFingerprint
  });
  const state=await reopened.inspect(ledgerRoot);
  assert.equal(state.checkpoints,1);
  assert.equal(state.currentLedgerSequence,3);
  assert.equal(state.proposals[p.proposalId].eligibleForIndependentReview,true);
  assert.equal(state.policyEnforced,false);
  assert.equal(state.approvalGranted,false);
  assert.equal(state.productionPublished,false);
  const factoryState=await factory.inspect();
  assert.equal(factoryState.proposals[p.proposalId].proof.actualNodeRedExecution,true);
  assert.equal(factoryState.proposals[p.proposalId].proof.sandboxDestroyed,true);
  assert.equal(factoryState.authorizationEffective,false);
 }finally{await rm(parent,{recursive:true,force:true,maxRetries:4,retryDelay:150});}
});
