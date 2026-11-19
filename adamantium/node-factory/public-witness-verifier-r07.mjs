// SPDX-License-Identifier: Apache-2.0
// R07 public verification. No signer key, install rights, shell, or MAS token.
// Verifies exact R05 hash-chain history + R06 detached Ed25519 checkpoints.
import {createHash,createPublicKey,verify as verifyEd25519} from 'node:crypto';

const fail=code=>{throw Object.assign(new Error(code),{code});};
const hex=/^sha256:[a-f0-9]{64}$/;
const b64=/^[A-Za-z0-9_-]{70,128}$/;
const token=/^[a-z][a-z0-9_.-]{2,95}$/;
const date=/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
const allowedEvents=new Set([
 'factory.proposed','factory.verified','factory.rejected','factory.promotion.requested'
]);
const zero='sha256:'+'0'.repeat(64);
const hash=b=>'sha256:'+createHash('sha256').update(b).digest('hex');
const exact=(value,keys)=>value!==null&&typeof value==='object'&&
 !Array.isArray(value)&&Object.keys(value).length===keys.length&&
 keys.every(k=>Object.hasOwn(value,k));
const safeText=(s,max,name)=>{
 if(typeof s!=='string'||Buffer.byteLength(s,'utf8')>max)
  fail('invalid_'+name+'_size');
 if(s.length&&!s.endsWith('\n'))fail(name+'_torn_tail');
 return s;
};
const lines=(s,max,name)=>{
 safeText(s,max,name);
 const rows=s.split('\n').filter(Boolean);
 if(rows.length>8192)fail(name+'_record_limit');
 return rows.map(x=>{
  if(Buffer.byteLength(x)>16384)fail(name+'_record_size_exceeded');
  try{return JSON.parse(x);}catch{fail(name+'_invalid_json');}
 });
};
export function verifyPublicFactoryWitness({
 ledgerId,expectedKeyFingerprint,publicKeyPem,identity,
 journalJSONL,witnessJSONL
}={}){
 if(typeof ledgerId!=='string'||!token.test(ledgerId)||
    !hex.test(expectedKeyFingerprint||'')||
    typeof publicKeyPem!=='string'||publicKeyPem.length>4096||
    !exact(identity,['schema','ledgerId','witnessId','keyFingerprint'])||
    identity.schema!=='adamantium.factory.witness-identity/1'||
    identity.ledgerId!==ledgerId||!token.test(identity.witnessId)||
    identity.keyFingerprint!==expectedKeyFingerprint)
  fail('untrusted_public_witness_identity');
 if(hash(publicKeyPem)!==expectedKeyFingerprint)
  fail('witness_public_key_fingerprint_mismatch');
 let publicKey;
 try{
  publicKey=createPublicKey(publicKeyPem);
  if(publicKey.asymmetricKeyType!=='ed25519')
   fail('wrong_witness_key_algorithm');
 }catch(e){
  if(e.code==='wrong_witness_key_algorithm')throw e;
  fail('invalid_public_witness_key');
 }
 const events=lines(journalJSONL,4*1024*1024,'journal');
 const signed=lines(witnessJSONL,3*1024*1024,'witness');
 let rev=0,head=zero;
 const historical=new Map([[0,zero]]);
 for(const rec of events){
  const keys=['schema','sequence','previous','kind','recordedAt','payload','hash'];
  if(!exact(rec,keys)||rec.schema!=='adamantium.factory.event/1'||
     rec.sequence!==rev+1||rec.previous!==head||
     !allowedEvents.has(rec.kind)||!date.test(rec.recordedAt||'')||
     !hex.test(rec.hash||'')||
     !rec.payload||typeof rec.payload!=='object'||Array.isArray(rec.payload))
   fail('invalid_factory_journal_event');
  const {hash:reported,...unsigned}=rec;
  if(hash(JSON.stringify(unsigned))!==reported)fail('journal_integrity_failed');
  rev=rec.sequence;head=reported;historical.set(rev,head);
 }
 let last=null;
 for(const receipt of signed){
  const keys=['schema','ledgerId','witnessId','sequence','head',
   'previousReceipt','issuedAt','signature','receiptHash'];
  if(!exact(receipt,keys)||receipt.schema!=='adamantium.factory.witness-receipt/1'||
     receipt.ledgerId!==ledgerId||receipt.witnessId!==identity.witnessId||
     !Number.isSafeInteger(receipt.sequence)||receipt.sequence<1||
     receipt.sequence<=(last?.sequence||0)||
     receipt.sequence>rev||
     !hex.test(receipt.head||'')||
     receipt.previousReceipt!==(last?.receiptHash||zero)||
     !date.test(receipt.issuedAt||'')||
     !b64.test(receipt.signature||'')||
     !hex.test(receipt.receiptHash||''))
   fail('invalid_factory_witness_receipt');
  const {signature,receiptHash,...unsigned}=receipt;
  let good=false;
  try{
   good=verifyEd25519(null,Buffer.from(JSON.stringify(unsigned)),publicKey,
    Buffer.from(signature,'base64url'));
  }catch{fail('witness_signature_invalid');}
  if(!good)fail('witness_signature_invalid');
  if(hash(JSON.stringify({...unsigned,signature}))!==receiptHash)
   fail('witness_receipt_hash_invalid');
  if(historical.get(receipt.sequence)!==receipt.head)
   fail('witness_journal_revision_mismatch');
  last=receipt;
 }
 if(!last)fail('no_signed_checkpoint');
 const fresh=last.sequence===rev&&last.head===head;
 return {
  schema:'adamantium.factory.public-verification/1',
  status:fresh?'verified_current':'verified_stale',
  signatureValid:true,allWitnessReceiptsVerified:true,
  sourceJournalChainVerified:true,headMatchesCurrent:!!fresh,
  ledgerId,witnessId:identity.witnessId,
  publicKeyFingerprint:expectedKeyFingerprint,
  sourceSequence:rev,sourceHead:head,
  signedSequence:last.sequence,signedHead:last.head,
  signedReceiptHash:last.receiptHash,
  checkpoints:signed.length,
  independentlyHosted:false, // cannot infer host separation from signed bytes
  externalPinRequired:true,
  approvalGranted:false,productionPublished:false,policyEnforced:false,
  authorizesModuleInstallation:false
 };
}
export function publicFactoryWitnessFailure(error){
 return {
  schema:'adamantium.factory.public-verification/1',
  status:'invalid',reason:error?.code||'verification_failed',
  signatureValid:false,sourceJournalChainVerified:false,
  headMatchesCurrent:false,approvalGranted:false,
  policyEnforced:false,productionPublished:false,
  authorizesModuleInstallation:false
 };
}
