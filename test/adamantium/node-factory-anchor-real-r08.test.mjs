// SPDX-License-Identifier: Apache-2.0
// Test R02–R08 end-to-end with real Node-RED 5, no privileged release.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DurableFactoryWorkflow} from '../../adamantium/node-factory/durable-workflow.mjs';
import {FACTORY_LEDGER_GENESIS} from '../../adamantium/node-factory/durable-ledger.mjs';
import {FactoryAuditWitness} from '../../adamantium/node-factory/audit-witness-r06.mjs';
import {FactoryEvidenceAnchor} from '../../adamantium/node-factory/independent-anchor-r08.mjs';
import {demoFactoryContract} from '../../adamantium/node-factory/contract.mjs';

test('R08 anchors genuine executed/rolled-back Node-RED 5 package with third Ed25519 signer',
 {timeout:180000},async()=>{
 const parent=await mkdtemp(join(tmpdir(),'mechanicus-r08-real-'));
 try{
  const ledger=join(parent,'ledger');
  const witness=join(parent,'witness');
  const anchorRoot=join(parent,'anchor');
  const workflow=await DurableFactoryWorkflow.create(ledger);
  const proposal=await workflow.propose({
   contract:demoFactoryContract(),expectedSequence:0,expectedHead:FACTORY_LEDGER_GENESIS});
  const verified=await workflow.verify({
   proposalId:proposal.proposalId,expectedSequence:1,expectedHead:proposal.head});
  const requested=await workflow.requestPromotion({
   proposalId:proposal.proposalId,expectedSequence:2,expectedHead:verified.head});
  assert.equal(requested.approvalGranted,false);
  const state=await workflow.inspect();
  const receipt=state.proposals[proposal.proposalId].proof;
  assert.equal(receipt.actualNodeRedExecution,true);
  assert.equal(receipt.sandboxDestroyed,true);
  assert.equal(receipt.rollbackVerified,true);
  assert.equal(state.authorizationEffective,false);
  const sourceSigner=await FactoryAuditWitness.create(witness,'factory-r08-real');
  const source=await sourceSigner.issue(ledger);
  assert.equal(source.sequence,3);
  const sourceView=await sourceSigner.inspect(ledger);
  const anchor=await FactoryEvidenceAnchor.create(anchorRoot,{
   ledgerId:sourceView.ledgerId,
   sourceWitnessId:sourceView.witnessId,
   sourceWitnessKeyFingerprint:sourceView.keyFingerprint
  });
  const anchored=await anchor.attest({
   identity:JSON.parse(await readFile(join(witness,'witness-identity.json'),'utf8')),
   publicKeyPem:await readFile(join(witness,'signer-public.pem'),'utf8'),
   journalJSONL:await readFile(join(ledger,'journal.jsonl'),'utf8'),
   witnessJSONL:await readFile(join(witness,'witness.jsonl'),'utf8')
  });
  assert.equal(anchored.sourceSequence,3);
  assert.equal(anchored.sourceWitnessReceiptHash,source.receiptHash);
  assert.equal(anchored.installationApproved,false);
  const reopened=await FactoryEvidenceAnchor.open(anchorRoot,{
   expectedAnchorFingerprint:(await anchor.inspect()).anchorKeyFingerprint
  });
  const result=await reopened.inspect();
  assert.equal(result.checkpoints,1);
  assert.equal(result.anchorCryptographicProof,true);
  assert.equal(result.independentlyHosted,false);
  assert.equal(result.actualRemoteTransport,false);
  assert.equal(result.productionPublished,false);
  assert.equal(result.grantsMASPermission,false);
 }finally{await rm(parent,{recursive:true,force:true,maxRetries:4,retryDelay:100});}
});
