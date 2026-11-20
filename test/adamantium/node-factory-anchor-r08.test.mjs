// SPDX-License-Identifier: Apache-2.0
// R08 anchor must work with public evidence only; no source signer imported.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {FactoryEvidenceAnchor} from '../../adamantium/node-factory/independent-anchor-r08.mjs';
import {DurableFactoryWorkflow} from '../../adamantium/node-factory/durable-workflow.mjs';
import {FACTORY_LEDGER_GENESIS} from '../../adamantium/node-factory/durable-ledger.mjs';
import {FactoryAuditWitness} from '../../adamantium/node-factory/audit-witness-r06.mjs';
import {renderNodePackage} from '../../adamantium/node-factory/generate.mjs';
import {demoFactoryContract} from '../../adamantium/node-factory/contract.mjs';
function trustedProof(contract){
 const p=renderNodePackage(contract);
 return {
  nodeType:p.nodeType,packageName:p.packageName,artifactHashes:p.sha256,
  actualNodeRedExecution:true,registeredInTestPalette:true,
  installedBytesVerified:true,expectedOutputObserved:true,
  rollbackVerified:true,sandboxDestroyed:true,
  productionDeployment:false,productionPublication:false,
  authorizedForLifecycle:false
 };
}
async function setup(){
 const parent=await mkdtemp(join(tmpdir(),'mechanicus-r08-independent-anchor-'));
 const ledger=join(parent,'ledger'),witness=join(parent,'source-witness');
 const anchorRoot=join(parent,'anchor');
 const workflow=await DurableFactoryWorkflow.create(ledger,{runner:async c=>trustedProof(c)});
 const signer=await FactoryAuditWitness.create(witness,'factory-r08');
 const anchor=await FactoryEvidenceAnchor.create(anchorRoot,{
  ledgerId:'factory-r08',
  sourceWitnessId:(await signer.inspect()).witnessId,
  sourceWitnessKeyFingerprint:(await signer.inspect()).keyFingerprint
 });
 const proposal=await workflow.propose({contract:demoFactoryContract(),
  expectedSequence:0,expectedHead:FACTORY_LEDGER_GENESIS});
 return {parent,ledger,witness,anchorRoot,workflow,signer,anchor,proposal};
}
async function bundle(x){
 return {
  identity:JSON.parse(await readFile(join(x.witness,'witness-identity.json'),'utf8')),
  publicKeyPem:await readFile(join(x.witness,'signer-public.pem'),'utf8'),
  journalJSONL:await readFile(join(x.ledger,'journal.jsonl'),'utf8'),
  witnessJSONL:await readFile(join(x.witness,'witness.jsonl'),'utf8')
 };
}
test('R08 pins R06 witness, Ed25519-signs journal history, replays idempotently',async()=>{
 const x=await setup();
 try{
  const a=await x.signer.issue(x.ledger);
  const first=await x.anchor.attest(await bundle(x));
  assert.equal(first.sourceSequence,1);
  assert.equal(first.sourceHead,a.head);
  assert.equal(first.installationApproved,false);
  assert.match(first.signature,/^[a-zA-Z0-9_-]{70,128}$/);
  const again=await x.anchor.attest(await bundle(x));
  assert.equal(again.replayed,true);
  assert.equal(again.receiptHash,first.receiptHash);
  const verified=await x.workflow.verify({
   proposalId:x.proposal.proposalId,expectedSequence:1,expectedHead:x.proposal.head});
  await x.signer.issue(x.ledger);
  const second=await x.anchor.attest(await bundle(x));
  assert.equal(second.sequence,2);
  assert.equal(second.sourceSequence,2);
  assert.equal(second.previousAnchorReceiptHash,first.receiptHash);
  assert.equal(second.replayed,false);
  const state=await x.anchor.inspect();
  assert.equal(state.checkpoints,2);
  assert.equal(state.anchorCryptographicProof,true);
  assert.equal(state.sourceEvidenceValidatedAtReceipt,true);
  assert.equal(state.independentlyHosted,false);
  assert.equal(state.independentOperatorVerified,false);
  assert.equal(state.actualRemoteTransport,false);
  assert.equal(state.grantsMASPermission,false);
  assert.equal(state.productionPublished,false);
  const open=await FactoryEvidenceAnchor.open(x.anchorRoot,{
   expectedAnchorFingerprint:state.anchorKeyFingerprint,
   trustedSequence:first.sequence,trustedReceiptHash:first.receiptHash
  });
  assert.equal((await open.inspect()).latest.receiptHash,second.receiptHash);
  await assert.rejects(FactoryEvidenceAnchor.open(x.anchorRoot,{
   expectedAnchorFingerprint:state.anchorKeyFingerprint,
   trustedSequence:first.sequence,
   trustedReceiptHash:'sha256:'+'f'.repeat(64)
  }),/anchor_external_head_mismatch/);
  assert.equal(verified.sequence,2);
 }finally{await rm(x.parent,{recursive:true,force:true});}
});
test('R08 blocks wrong witness pin, stale journal, source fork and missing historical witness',async()=>{
 const x=await setup();
 try{
  await x.signer.issue(x.ledger);
  const b=await bundle(x);
  await assert.rejects(x.anchor.attest({...b,
   identity:{...b.identity,witnessId:'witness-bogus'}}),
   /source_witness_identity_mismatch/);
  await assert.rejects(x.anchor.attest({...b,
   publicKeyPem:b.publicKeyPem.replace('A','B')}),
   /witness_public_key_fingerprint_mismatch/);
  const first=await x.anchor.attest(b);
  await x.workflow.verify({
   proposalId:x.proposal.proposalId,
   expectedSequence:1,expectedHead:x.proposal.head
  });
  await assert.rejects(x.anchor.attest(await bundle(x)),
   /stale_source_evidence_for_anchor/);
  await x.signer.issue(x.ledger);
  const full=await bundle(x);
  const missing=full.witnessJSONL.split('\n').filter(Boolean).slice(-1).join('\n')+'\n';
  await assert.rejects(x.anchor.attest({...full,witnessJSONL:missing}),
   /witness_|source_witness_checkpoint_disappeared/);
  const good=await x.anchor.attest(full);
  assert.equal(good.previousAnchorReceiptHash,first.receiptHash);
 }finally{await rm(x.parent,{recursive:true,force:true});}
});
test('R08 fails closed on tampered anchor history, wrong anchor key and foreign lock',async()=>{
 const x=await setup();
 try{
  await x.signer.issue(x.ledger);
  await x.anchor.attest(await bundle(x));
  await assert.rejects(FactoryEvidenceAnchor.open(x.anchorRoot,{
   expectedAnchorFingerprint:'sha256:'+'f'.repeat(64)
  }),/untrusted_anchor_public_key/);
  const lock=join(x.anchorRoot,'anchor-writer.lock');
  await writeFile(lock,'another-writer');
  await assert.rejects(x.anchor.attest(await bundle(x)),/anchor_writer_busy/);
  assert.equal(await readFile(lock,'utf8'),'another-writer');
  await rm(lock);
  const file=join(x.anchorRoot,'anchor.jsonl');
  const old=await readFile(file,'utf8');
  await writeFile(file,old.replace('"sourceSequence":1','"sourceSequence":5'));
  await assert.rejects(x.anchor.inspect(),/anchor_signature_invalid/);
 }finally{await rm(x.parent,{recursive:true,force:true});}
});
test('R08 validates policy, refuses existing anchor root and unknown ledger',async()=>{
 const x=await setup();
 try{
  await assert.rejects(FactoryEvidenceAnchor.create(x.anchorRoot,{
   ledgerId:'other-factory',
   sourceWitnessId:(await x.signer.inspect()).witnessId,
   sourceWitnessKeyFingerprint:(await x.signer.inspect()).keyFingerprint
  }),/EEXIST/);
  assert.equal((await x.anchor.inspect()).checkpoints,0);
  await assert.rejects(x.anchor.attest({}),/source_witness_identity_mismatch/);
 }finally{await rm(x.parent,{recursive:true,force:true});}
});
