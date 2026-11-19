// SPDX-License-Identifier: Apache-2.0
// Actual Node-RED 5 verifies the candidate before a durable R05 proof is recorded.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DurableFactoryWorkflow} from '../../adamantium/node-factory/durable-workflow.mjs';
import {FACTORY_LEDGER_GENESIS} from '../../adamantium/node-factory/durable-ledger.mjs';
import {demoFactoryContract} from '../../adamantium/node-factory/contract.mjs';

test('genuine factory agent verification persists bounded Node-RED test proof, no production grant',
 {timeout:180000},async()=>{
 const parent=await mkdtemp(join(tmpdir(),'mechanicus-factory-r05-real-'));
 const root=join(parent,'ledger');
 try{
  const workflow=await DurableFactoryWorkflow.create(root);
  const candidate=await workflow.propose({
   contract:demoFactoryContract(),
   expectedSequence:0,expectedHead:FACTORY_LEDGER_GENESIS
  });
  assert.equal(candidate.sequence,1);
  const verified=await workflow.verify({
   proposalId:candidate.proposalId,
   expectedSequence:1,expectedHead:candidate.head
  });
  assert.equal(verified.sequence,2);
  const state=await workflow.inspect();
  const proof=state.proposals[candidate.proposalId].proof;
  assert.equal(state.proposals[candidate.proposalId].status,'verified');
  assert.equal(proof.actualNodeRedExecution,true);
  assert.equal(proof.sandboxDestroyed,true);
  assert.equal(proof.rollbackVerified,true);
  assert.equal(proof.productionDeployment,false);
  assert.equal(state.productionInstalled,false);
  const promotion=await workflow.requestPromotion({
   proposalId:candidate.proposalId,expectedSequence:2,expectedHead:verified.head
  });
  assert.equal(promotion.sequence,3);
  assert.equal(promotion.approvalGranted,false);
  const reopened=await DurableFactoryWorkflow.open(root,{
   trustedHead:verified.head,trustedSequence:2
  });
  const after=await reopened.inspect({trustedHead:verified.head,trustedSequence:2});
  assert.equal(after.proposals[candidate.proposalId].status,'verified');
  assert.equal(after.proposals[candidate.proposalId].promotionRequested,true);
  assert.equal(after.authorizationEffective,false);
  assert.equal(after.independentlyWitnessed,false);
 }finally{await rm(parent,{recursive:true,force:true,maxRetries:4,retryDelay:150});}
});
