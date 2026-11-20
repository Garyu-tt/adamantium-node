// SPDX-License-Identifier: Apache-2.0
// Public-only verification of a second independent signer (R08).
import {createPublicKey,createHash,verify as verifySignature} from 'node:crypto';
import {verifyPublicFactoryWitness} from './public-witness-verifier-r07.mjs';
const sha=b=>'sha256:'+createHash('sha256').update(b).digest('hex');
const hex=/^sha256:[a-f0-9]{64}$/;
const id=/^[a-z][a-z0-9_.-]{2,95}$/;
const sigPattern=/^[A-Za-z0-9_-]{70,128}$/;
const date=/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
const genesis='sha256:'+'0'.repeat(64);
const fail=c=>{throw Object.assign(new Error(c),{code:c});};
const strict=(o,keys)=>o&&typeof o==='object'&&!Array.isArray(o)&&
 Object.keys(o).length===keys.length&&keys.every(k=>Object.hasOwn(o,k));
const parse=(s,max)=>{
 if(typeof s!=='string'||Buffer.byteLength(s)>max||!s.endsWith('\n'))
  fail('invalid_r08_anchor_data');
 const values=s.split('\n').filter(Boolean).map(line=>{
  if(Buffer.byteLength(line)>16384)fail('anchor_line_too_large');
  try{return JSON.parse(line);}catch{fail('anchor_line_invalid_json');}
 });
 if(values.length>8192)fail('anchor_chain_too_large');
 return values;
};
export function verifyOffhostFactoryAnchor({
 sourceEvidence,anchorIdentity,anchorPublicPem,
 expectedAnchorPublicKeyFingerprint,anchorJSONL
}={}){
 if(!sourceEvidence||typeof sourceEvidence!=='object')fail('missing_source_public_evidence');
 const source=verifyPublicFactoryWitness(sourceEvidence);
 if(!anchorIdentity||!strict(anchorIdentity,[
  'schema','anchorId','keyFingerprint','sourceKeyPin','sourceLedgerId'
 ])||anchorIdentity.schema!=='adamantium.factory.offhost-anchor/1'||
  !id.test(anchorIdentity.anchorId||'')||
  !id.test(anchorIdentity.sourceLedgerId||'')||
  !hex.test(expectedAnchorPublicKeyFingerprint||'')||
  anchorIdentity.keyFingerprint!==expectedAnchorPublicKeyFingerprint||
  anchorIdentity.sourceLedgerId!==source.ledgerId||
  anchorIdentity.sourceKeyPin!==source.publicKeyFingerprint)
  fail('offhost_anchor_not_pinned');
 if(typeof anchorPublicPem!=='string'||anchorPublicPem.length>4096||
  sha(anchorPublicPem)!==expectedAnchorPublicKeyFingerprint)
  fail('offhost_public_key_fingerprint_mismatch');
 let key;
 try{key=createPublicKey(anchorPublicPem);}
 catch{fail('invalid_anchor_public_key');}
 if(key.asymmetricKeyType!=='ed25519')fail('unsupported_anchor_public_key');
 const sourceHistory=new Map();
 const r05=parse(sourceEvidence.journalJSONL,4*1024*1024);
 for(const event of r05)sourceHistory.set(event.sequence,event.hash);
 const r06=parse(sourceEvidence.witnessJSONL,3*1024*1024);
 const receiptsBySequence=new Map();
 for(const receipt of r06)receiptsBySequence.set(receipt.sequence,receipt.receiptHash);
 const anchor=parse(anchorJSONL,3*1024*1024);
 if(!anchor.length)fail('no_offhost_anchor_checkpoint');
 let last=null;
 for(const rec of anchor){
  const fields=[
   'schema','anchorId','ledgerId','sourceWitnessId',
   'sourceKeyFingerprint','sourceSequence','sourceHead',
   'sourceReceiptHash','previousReceipt','issuedAt','signature','receiptHash'
  ];
  if(!strict(rec,fields)||
    rec.schema!=='adamantium.factory.offhost-receipt/1'||
    rec.anchorId!==anchorIdentity.anchorId||
    rec.ledgerId!==source.ledgerId||
    rec.sourceWitnessId!==source.witnessId||
    rec.sourceKeyFingerprint!==source.publicKeyFingerprint||
    !Number.isSafeInteger(rec.sourceSequence)||rec.sourceSequence<=0||
    rec.sourceSequence<=(last?.sourceSequence||0)||
    !hex.test(rec.sourceHead||'')||
    !hex.test(rec.sourceReceiptHash||'')||
    sourceHistory.get(rec.sourceSequence)!==rec.sourceHead||
    receiptsBySequence.get(rec.sourceSequence)!==rec.sourceReceiptHash||
    rec.previousReceipt!==(last?.receiptHash||genesis)||
    !date.test(rec.issuedAt||'')||
    !sigPattern.test(rec.signature||'')||
    !hex.test(rec.receiptHash||''))
   fail('invalid_offhost_anchor_receipt');
  const {signature,receiptHash,...unsigned}=rec;
  let verified=false;
  try{verified=verifySignature(null,Buffer.from(JSON.stringify(unsigned)),key,
    Buffer.from(signature,'base64url'));}
  catch{fail('offhost_signature_invalid');}
  if(!verified)fail('offhost_signature_invalid');
  if(sha(JSON.stringify({...unsigned,signature}))!==receiptHash)
   fail('offhost_receipt_integrity_invalid');
  last=rec;
 }
 const current=last.sourceSequence===source.sourceSequence&&
   last.sourceHead===source.sourceHead&&
   last.sourceReceiptHash===source.signedReceiptHash&&
   source.status==='verified_current';
 return {
  schema:'adamantium.factory.offhost-verification/1',
  status:current?'verified_current':'verified_stale',
  sourceSequence:source.sourceSequence,
  signedSourceSequence:source.signedSequence,
  anchorSequence:last.sourceSequence,
  sourceHead:source.sourceHead,anchorSourceHead:last.sourceHead,
  sourceWitnessPublicKeyFingerprint:source.publicKeyFingerprint,
  anchorPublicKeyFingerprint:expectedAnchorPublicKeyFingerprint,
  anchorId:anchorIdentity.anchorId,
  anchorReceiptHash:last.receiptHash,
  sourceSignatureValid:true,anchorSignatureValid:true,
  sourceHistoryVerified:true,anchorHistoryVerified:true,
  sourceCheckpointCount:source.checkpoints,anchorCheckpointCount:anchor.length,
  offHostExecutionAttested:false,
  signerHostIndependenceVerified:false,
  explicitlyApprovedForProduction:false,productionPublished:false,
  grantsMASCapabilities:false
 };
}
export function offhostVerificationFailure(error){
 return {
  schema:'adamantium.factory.offhost-verification/1',status:'invalid',
  reason:error?.code||'anchor_evidence_unavailable',
  sourceSignatureValid:false,anchorSignatureValid:false,
  signerHostIndependenceVerified:false,
  explicitlyApprovedForProduction:false,productionPublished:false,
  grantsMASCapabilities:false
 };
}
