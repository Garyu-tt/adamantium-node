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
import {verifyPublicFactoryWitness,publicFactoryWitnessFailure} from '../../adamantium/node-factory/public-witness-verifier-r07.mjs';
const fixtureProof=contract=>{
 const p=renderNodePackage(contract);
 return {nodeType:p.nodeType,packageName:p.packageName,artifactHashes:p.sha256,
  actualNodeRedExecution:true,registeredInTestPalette:true,
  installedBytesVerified:true,expectedOutputObserved:true,
  rollbackVerified:true,sandboxDestroyed:true,
  authorizedForLifecycle:false,productionDeployment:false,
  productionPublication:false};
};
async function setup(){
 const parent=await mkdtemp(join(tmpdir(),'mechanicus-public-verify-r07-'));
 const ledger=join(parent,'ledger'),witness=join(parent,'witness');
 const factory=await DurableFactoryWorkflow.create(ledger,{runner:async c=>fixtureProof(c)});
 const signer=await FactoryAuditWitness.create(witness,'factory-public-r07');
 const sample=await factory.propose({contract:demoFactoryContract(),
  expectedSequence:0,expectedHead:FACTORY_LEDGER_GENESIS});
 return {parent,ledger,witness,factory,signer,sample};
}
async function inputs(x){
 const root=x.witness;
 const identity=JSON.parse(await readFile(join(root,'witness-identity.json'),'utf8'));
 return {ledgerId:identity.ledgerId,expectedKeyFingerprint:identity.keyFingerprint,
  identity,publicKeyPem:await readFile(join(root,'signer-public.pem'),'utf8'),
  journalJSONL:await readFile(join(x.ledger,'journal.jsonl'),'utf8'),
  witnessJSONL:await readFile(join(root,'witness.jsonl'),'utf8')};
}
test('R07 independently verifies signatures without loading signer private key',async()=>{
 const x=await setup();
 try{
  await x.signer.issue(x.ledger);
  const verified=verifyPublicFactoryWitness(await inputs(x));
  assert.equal(verified.status,'verified_current');
  assert.equal(verified.signatureValid,true);
  assert.equal(verified.headMatchesCurrent,true);
  assert.equal(verified.sourceSequence,1);
  assert.equal(verified.checkpoints,1);
  assert.equal(verified.approvalGranted,false);
  assert.equal(verified.policyEnforced,false);
  assert.equal(verified.authorizesModuleInstallation,false);
  assert.equal(verified.independentlyHosted,false);
  // Recovery after journal moves forward must not falsely claim freshness.
  const promotion=await x.factory.verify({proposalId:x.sample.proposalId,
   expectedSequence:1,expectedHead:x.sample.head});
  assert.equal(promotion.sequence,2);
  const stale=verifyPublicFactoryWitness(await inputs(x));
  assert.equal(stale.status,'verified_stale');
  assert.equal(stale.signatureValid,true);
  assert.equal(stale.headMatchesCurrent,false);
  await x.signer.issue(x.ledger);
  const now=verifyPublicFactoryWitness(await inputs(x));
  assert.equal(now.status,'verified_current');
  assert.equal(now.checkpoints,2);
  assert.equal(now.signedSequence,2);
 }finally{await rm(x.parent,{recursive:true,force:true});}
});
test('R07 rejects malicious public key, invalid signed receipt and tampered journal',async()=>{
 const x=await setup();
 try{
  await x.signer.issue(x.ledger);
  const original=await inputs(x);
  assert.throws(()=>verifyPublicFactoryWitness({
   ...original,expectedKeyFingerprint:'sha256:'+'f'.repeat(64)
  }),/untrusted_public_witness_identity/);
  assert.throws(()=>verifyPublicFactoryWitness({
   ...original,publicKeyPem:original.publicKeyPem.replace('A','B')
  }),/witness_public_key_fingerprint_mismatch/);
  assert.throws(()=>verifyPublicFactoryWitness({
   ...original,witnessJSONL:original.witnessJSONL.replace(
    /"signature":"[A-Za-z0-9_-]+"/,'"signature":"'+'A'.repeat(86)+'"')
  }),/witness_signature_invalid/);
  assert.throws(()=>verifyPublicFactoryWitness({
   ...original,journalJSONL:original.journalJSONL.replace(
    'factory.proposed','factory.verified')
  }),/journal_integrity_failed/);
  assert.throws(()=>verifyPublicFactoryWitness({
   ...original,journalJSONL:''
  }),/invalid_factory_witness_receipt/);
  assert.equal(publicFactoryWitnessFailure(new Error('no secret')).status,'invalid');
 }finally{await rm(x.parent,{recursive:true,force:true});}
});
test('R07 refuses torn tails, unsigned state and mismatched ledgerId',async()=>{
 const x=await setup();
 try{
  const a=await inputs(x);
  assert.throws(()=>verifyPublicFactoryWitness(a),/no_signed_checkpoint/);
  await x.signer.issue(x.ledger);
  const b=await inputs(x);
  assert.throws(()=>verifyPublicFactoryWitness({...b,journalJSONL:'{}'}),
   /journal_torn_tail/);
  assert.throws(()=>verifyPublicFactoryWitness({...b,witnessJSONL:'{}'}),
   /witness_torn_tail/);
  assert.throws(()=>verifyPublicFactoryWitness({...b,ledgerId:'other-factory'}),
   /untrusted_public_witness_identity/);
  // Untrusted caller cannot convert witness evidence into an approval.
  const result=verifyPublicFactoryWitness(b);
  assert.equal(result.productionPublished,false);
 }finally{await rm(x.parent,{recursive:true,force:true});}
});
