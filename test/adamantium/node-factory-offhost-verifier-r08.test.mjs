// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {generateKeyPairSync,createHash,sign} from 'node:crypto';
import {DurableFactoryWorkflow} from '../../adamantium/node-factory/durable-workflow.mjs';
import {FACTORY_LEDGER_GENESIS} from '../../adamantium/node-factory/durable-ledger.mjs';
import {FactoryAuditWitness} from '../../adamantium/node-factory/audit-witness-r06.mjs';
import {demoFactoryContract} from '../../adamantium/node-factory/contract.mjs';
import {verifyOffhostFactoryAnchor,offhostVerificationFailure} from '../../adamantium/node-factory/offhost-anchor-verifier-r08.mjs';
const hash=b=>'sha256:'+createHash('sha256').update(b).digest('hex');
async function setup(){
 const parent=await mkdtemp(join(tmpdir(),'factory-offhost-anchor-r08-js-'));
 const ledger=join(parent,'ledger'),witness=join(parent,'witness');
 const factory=await DurableFactoryWorkflow.create(ledger);
 const proposal=await factory.propose({contract:demoFactoryContract(),expectedSequence:0,
  expectedHead:FACTORY_LEDGER_GENESIS});
 const signer=await FactoryAuditWitness.create(witness,'factory-offhost');
 const receipt=await signer.issue(ledger);
 const identity=JSON.parse(await readFile(join(witness,'witness-identity.json'),'utf8'));
 const sourceEvidence={
  ledgerId:identity.ledgerId,expectedKeyFingerprint:identity.keyFingerprint,
  identity,
  publicKeyPem:await readFile(join(witness,'signer-public.pem'),'utf8'),
  journalJSONL:await readFile(join(ledger,'journal.jsonl'),'utf8'),
  witnessJSONL:await readFile(join(witness,'witness.jsonl'),'utf8')
 };
 const pair=generateKeyPairSync('ed25519');
 const pem=pair.publicKey.export({format:'pem',type:'spki'});
 const anchorPin=hash(pem);
 const anchorIdentity={
  schema:'adamantium.factory.offhost-anchor/1',
  anchorId:'anchor-'+anchorPin.slice(7,31),
  keyFingerprint:anchorPin,
  sourceKeyPin:identity.keyFingerprint,
  sourceLedgerId:identity.ledgerId
 };
 const unsigned={
  schema:'adamantium.factory.offhost-receipt/1',
  anchorId:anchorIdentity.anchorId,
  ledgerId:identity.ledgerId,
  sourceWitnessId:identity.witnessId,
  sourceKeyFingerprint:identity.keyFingerprint,
  sourceSequence:1,sourceHead:receipt.head,
  sourceReceiptHash:receipt.receiptHash,
  previousReceipt:FACTORY_LEDGER_GENESIS,
  issuedAt:'2026-11-20T00:00:00.000Z'
 };
 const signature=sign(null,Buffer.from(JSON.stringify(unsigned)),pair.privateKey).toString('base64url');
 const signed={...unsigned,signature};
 signed.receiptHash=hash(JSON.stringify(signed));
 return {parent,ledger,witness,factory,proposal,signer,receipt,
  sourceEvidence,anchorIdentity,anchorPublicPem:pem,expectedAnchorPublicKeyFingerprint:anchorPin,
  anchorJSONL:JSON.stringify(signed)+'\n'};
}
test('R08 detached anchor verification validates source and independently signed receipt',async()=>{
 const x=await setup();
 try{
  const result=verifyOffhostFactoryAnchor(x);
  assert.equal(result.status,'verified_current');
  assert.equal(result.anchorSignatureValid,true);
  assert.equal(result.sourceHistoryVerified,true);
  assert.equal(result.anchorSourceHead,x.receipt.head);
  assert.equal(result.sourceSequence,1);
  assert.equal(result.grantsMASCapabilities,false);
  assert.equal(result.productionPublished,false);
  assert.equal(result.signerHostIndependenceVerified,false);
  assert.equal(offhostVerificationFailure({code:'test'}).status,'invalid');
 }finally{await rm(x.parent,{recursive:true,force:true});}
});
test('R08 rejects forged second signature, swapped public key and altered source history',async()=>{
 const x=await setup();
 try{
  assert.throws(()=>verifyOffhostFactoryAnchor({...x,
   expectedAnchorPublicKeyFingerprint:'sha256:'+'f'.repeat(64)
  }),/offhost_anchor_not_pinned/);
  const signed=JSON.parse(x.anchorJSONL);
  signed.signature='A'.repeat(86);
  assert.throws(()=>verifyOffhostFactoryAnchor({...x,
   anchorJSONL:JSON.stringify(signed)+'\n'
  }),/offhost_signature_invalid/);
  const sourceEvidence={...x.sourceEvidence,
   journalJSONL:x.sourceEvidence.journalJSONL.replace('factory.proposed','factory.rejected')
  };
  assert.throws(()=>verifyOffhostFactoryAnchor({...x,sourceEvidence}),
   /journal_integrity_failed/);
  assert.throws(()=>verifyOffhostFactoryAnchor({...x,anchorJSONL:'{}'}),
   /invalid_r08_anchor_data/);
 }finally{await rm(x.parent,{recursive:true,force:true});}
});
test('R08 anchor remains valid but stale after another duly signed source revision',async()=>{
 const x=await setup();
 try{
  const advanced=await x.factory.ledger.append({
   kind:'factory.rejected',
   payload:{proposalId:x.proposal.proposalId,reason:'operator_demo_stop'},
   expectedSequence:1,expectedHead:x.proposal.head
  });
  assert.equal(advanced.sequence,2);
  await x.signer.issue(x.ledger);
  const sourceEvidence={
   ...x.sourceEvidence,
   journalJSONL:await readFile(join(x.ledger,'journal.jsonl'),'utf8'),
   witnessJSONL:await readFile(join(x.witness,'witness.jsonl'),'utf8')
  };
  const verdict=verifyOffhostFactoryAnchor({...x,sourceEvidence});
  assert.equal(verdict.status,'verified_stale');
  assert.equal(verdict.anchorSignatureValid,true);
  assert.equal(verdict.sourceSignatureValid,true);
  assert.equal(verdict.grantsMASCapabilities,false);
 }finally{await rm(x.parent,{recursive:true,force:true});}
});
