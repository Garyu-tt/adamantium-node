// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DurableFactoryWorkflow} from '../../adamantium/node-factory/durable-workflow.mjs';
import {FACTORY_LEDGER_GENESIS} from '../../adamantium/node-factory/durable-ledger.mjs';
import {renderNodePackage} from '../../adamantium/node-factory/generate.mjs';
import {demoFactoryContract} from '../../adamantium/node-factory/contract.mjs';
import {FactoryAuditWitness} from '../../adamantium/node-factory/audit-witness-r06.mjs';

function proof(c){
 const p=renderNodePackage(c);
 return {nodeType:p.nodeType,packageName:p.packageName,artifactHashes:p.sha256,
  installedBytesVerified:true,actualNodeRedExecution:true,
  expectedOutputObserved:true,registeredInTestPalette:true,
  rollbackVerified:true,sandboxDestroyed:true,
  productionDeployment:false,productionPublication:false,
  authorizedForLifecycle:false};
}
async function setup(){
 const root=await mkdtemp(join(tmpdir(),'mechanicus-witness-r06-'));
 const ledgerDir=join(root,'factory'),witnessDir=join(root,'anchor');
 const ledger=await DurableFactoryWorkflow.create(ledgerDir,{runner:async c=>proof(c)});
 const witness=await FactoryAuditWitness.create(witnessDir,'factory-study-ledger');
 return {root,ledgerDir,witnessDir,ledger,witness};
}
test('Ed25519 receipt chain witnesses journal revisions without granting any permission',async()=>{
 const x=await setup();
 try{
  const proposal=await x.ledger.propose({
   contract:demoFactoryContract(),expectedSequence:0,expectedHead:FACTORY_LEDGER_GENESIS});
  const a=await x.witness.issue(x.ledgerDir);
  assert.equal(a.sequence,1);
  assert.match(a.signature,/^[A-Za-z0-9_-]{70,128}$/);
  assert.equal(a.approvalGranted,false);
  const repeated=await x.witness.issue(x.ledgerDir);
  assert.equal(repeated.receiptHash,a.receiptHash);
  assert.equal(repeated.replayed,true);
  const verified=await x.ledger.verify({
   proposalId:proposal.proposalId,expectedSequence:1,expectedHead:proposal.head});
  const b=await x.witness.issue(x.ledgerDir);
  assert.equal(b.previousReceipt,a.receiptHash);
  assert.equal(b.sequence,2);
  const promoted=await x.ledger.requestPromotion({
   proposalId:proposal.proposalId,expectedSequence:2,expectedHead:verified.head});
  assert.equal(promoted.approvalGranted,false);
  const c=await x.witness.issue(x.ledgerDir);
  assert.equal(c.sequence,3);
  assert.equal(c.previousReceipt,b.receiptHash);
  const publicFingerprint=(await x.witness.inspect()).keyFingerprint;
  await assert.rejects(FactoryAuditWitness.open(x.witnessDir,{
   expectedKeyFingerprint:'sha256:'+'f'.repeat(64)
  }),/trusted_witness_key_mismatch/);
  const reopened=await FactoryAuditWitness.open(x.witnessDir,{
   expectedKeyFingerprint:publicFingerprint
  });
  const state=await reopened.inspect(x.ledgerDir);
  assert.equal(state.checkpoints,3);
  assert.equal(state.latest.receiptHash,c.receiptHash);
  assert.equal(state.proposals[proposal.proposalId].eligibleForIndependentReview,true);
  assert.equal(state.proposals[proposal.proposalId].approvalGranted,false);
  assert.equal(state.signedByEd25519,true);
  assert.equal(state.independentlyHosted,false);
  assert.equal(state.separatelyPinnedExternalWitness,false);
  assert.equal(state.policyEnforced,false);
  assert.equal(state.productionPublished,false);
 }finally{await rm(x.root,{recursive:true,force:true});}
});
test('signature/hash tampering fails closed; trusted source history cannot be rewound',async()=>{
 const x=await setup();
 try{
  const proposal=await x.ledger.propose({
   contract:demoFactoryContract(),expectedSequence:0,expectedHead:FACTORY_LEDGER_GENESIS});
  const receipt=await x.witness.issue(x.ledgerDir);
  const file=join(x.witnessDir,'witness.jsonl');
  const original=await readFile(file,'utf8');
  await writeFile(file,original.replace(receipt.head,'sha256:'+'a'.repeat(64)));
  await assert.rejects(x.witness.inspect(x.ledgerDir),
   /witness_signature_invalid|witness_hash_invalid/);
  await writeFile(file,original);
  await writeFile(join(x.ledgerDir,'journal.jsonl'),'');
  await assert.rejects(x.witness.inspect(x.ledgerDir),
   /journal_independent_head_mismatch/);
  assert.equal(proposal.sequence,1);
 }finally{await rm(x.root,{recursive:true,force:true});}
});
test('writer lease rejects concurrent signature and does not remove foreign lock',async()=>{
 const x=await setup();
 try{
  await x.ledger.propose({
   contract:demoFactoryContract(),expectedSequence:0,expectedHead:FACTORY_LEDGER_GENESIS});
  const file=join(x.witnessDir,'witness-writer.lock');
  await writeFile(file,'foreign-writer');
  await assert.rejects(x.witness.issue(x.ledgerDir),/witness_writer_busy/);
  assert.equal(await readFile(file,'utf8'),'foreign-writer');
 }finally{await rm(x.root,{recursive:true,force:true});}
});
test('no receipt for empty journal, no nested or root witness/ledger paths',async()=>{
 const x=await setup();
 try{
  await assert.rejects(x.witness.issue(x.ledgerDir),/genesis_not_a_proof/);
  await assert.rejects(x.witness.issue(x.root),/witness_and_ledger_must_be_separate_directories/);
  await assert.rejects(x.witness.issue('relative'),/absolute_ledger_root_required/);
  await assert.rejects(FactoryAuditWitness.create(x.witnessDir,'another-id'),/EEXIST/);
  assert.equal((await x.witness.inspect()).checkpoints,0);
 }finally{await rm(x.root,{recursive:true,force:true});}
});
test('a signed checkpoint never grants install even if proposal is eligible',async()=>{
 const x=await setup();
 try{
  const p=await x.ledger.propose({
   contract:demoFactoryContract(),expectedSequence:0,expectedHead:FACTORY_LEDGER_GENESIS});
  const a=await x.witness.issue(x.ledgerDir);
  const b=await x.witness.inspect(x.ledgerDir);
  assert.equal(b.proposals[p.proposalId].eligibleForIndependentReview,false);
  assert.equal(b.latest.sequence,a.sequence);
  assert.equal(b.proposals[p.proposalId].productionPublished,false);
 }finally{await rm(x.root,{recursive:true,force:true});}
});
