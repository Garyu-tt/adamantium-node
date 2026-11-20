// SPDX-License-Identifier: Apache-2.0
// R08: a separately provisionable public-evidence audit anchor.
// An Ed25519 signature is NOT a MAS approval, network permission or site isolation.
// The private key never leaves the local anchor root.
import {generateKeyPairSync,createHash,createPrivateKey,createPublicKey,sign,verify as edVerify} from 'node:crypto';
import {mkdir,readFile,writeFile,open,rm,rename,lstat} from 'node:fs/promises';
import {join,resolve,parse,isAbsolute} from 'node:path';
import {verifyPublicFactoryWitness} from './public-witness-verifier-r07.mjs';

const err=code=>{throw Object.assign(new Error(code),{code});};
const dig=b=>'sha256:'+createHash('sha256').update(b).digest('hex');
const hex=/^sha256:[a-f0-9]{64}$/;
const token=/^[a-z][a-z0-9._-]{2,95}$/;
const zero='sha256:'+'0'.repeat(64);
const exact=(x,keys)=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
 Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
const copy=o=>JSON.parse(JSON.stringify(o));
const files={
 identity:'anchor-identity.json',private:'anchor-private.pem',
 public:'anchor-public.pem',events:'anchor.jsonl',
 view:'anchor-view.json',lock:'anchor-writer.lock'
};
const receiptFields=[
 'schema','anchorId','sequence','sourceSequence','sourceHead',
 'sourceWitnessReceiptHash','previousAnchorReceiptHash',
 'issuedAt','signature','receiptHash'
];
const unsignedReceipt=record=>{
 const {signature,receiptHash,...body}=record;
 return body;
};
const validateReceipt=(r,previous,identity,publicKey)=>{
 if(!exact(r,receiptFields)||r.schema!=='adamantium.factory.anchor-receipt/1'||
  r.anchorId!==identity.anchorId||!Number.isSafeInteger(r.sequence)||
  r.sequence!==(previous?.sequence||0)+1||
  !Number.isSafeInteger(r.sourceSequence)||r.sourceSequence<1||
  previous&&r.sourceSequence<=previous.sourceSequence||
  !hex.test(r.sourceHead)||!hex.test(r.sourceWitnessReceiptHash)||
  r.previousAnchorReceiptHash!==(previous?.receiptHash||zero)||
  typeof r.signature!=='string'||!/^[a-zA-Z0-9_-]{70,128}$/.test(r.signature)||
  !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(r.issuedAt||'')||
  !hex.test(r.receiptHash))
  err('invalid_anchor_receipt_schema');
 const unsigned=unsignedReceipt(r);
 if(!edVerify(null,Buffer.from(JSON.stringify(unsigned)),publicKey,
  Buffer.from(r.signature,'base64url')))
  err('anchor_signature_invalid');
 if(dig(JSON.stringify({...unsigned,signature:r.signature}))!==r.receiptHash)
  err('anchor_hash_invalid');
};
async function readIdentity(root){
 const identity=JSON.parse(await readFile(join(root,files.identity),'utf8'));
 if(!exact(identity,[
  'schema','anchorId','ledgerId','sourceWitnessId',
  'sourceWitnessKeyFingerprint','anchorKeyFingerprint'
 ])||identity.schema!=='adamantium.factory.anchor-identity/1'||
  !token.test(identity.ledgerId)||!token.test(identity.sourceWitnessId)||
  !token.test(identity.anchorId)||
  !hex.test(identity.sourceWitnessKeyFingerprint)||
  !hex.test(identity.anchorKeyFingerprint))
  err('anchor_identity_invalid');
 const pem=await readFile(join(root,files.public),'utf8');
 if(dig(pem)!==identity.anchorKeyFingerprint)err('anchor_public_key_fingerprint_invalid');
 const key=createPublicKey(pem);
 if(key.asymmetricKeyType!=='ed25519')err('wrong_anchor_public_key_type');
 return {identity,key};
}
async function readChain(root){
 const {identity,key}=await readIdentity(root);
 const file=join(root,files.events);
 if(!(await lstat(file)).isFile())err('anchor_receipts_not_a_file');
 const raw=await readFile(file,'utf8');
 if(Buffer.byteLength(raw)>2*1024*1024)err('anchor_chain_quota');
 if(raw&&!raw.endsWith('\n'))err('anchor_torn_tail');
 const records=[];
 for(const line of raw.split('\n').filter(Boolean)){
  let r;
  try{r=JSON.parse(line);}catch{err('anchor_invalid_json');}
  validateReceipt(r,records.at(-1),identity,key);
  records.push(r);
 }
 return {identity,records};
}
function status({identity,records}){
 const recent=records.at(-1)||null;
 return {
  schema:'adamantium.factory.anchor-view/1',
  anchorId:identity.anchorId,
  ledgerId:identity.ledgerId,
  sourceWitnessId:identity.sourceWitnessId,
  sourceWitnessKeyFingerprint:identity.sourceWitnessKeyFingerprint,
  anchorKeyFingerprint:identity.anchorKeyFingerprint,
  checkpoints:records.length,
  latest:recent,
  anchorCryptographicProof:!!recent,
  sourceEvidenceValidatedAtReceipt:!!recent,
  independentlyHosted:false, // never inferred from filesystem separation
  independentOperatorVerified:false,
  externalMASCapabilityConnected:false,
  actualRemoteTransport:false,
  grantsMASPermission:false,
  installationApproved:false,
  productionPublished:false
 };
}
async function atomicView(root,view){
 const dest=join(root,files.view);
 const name=join(root,'anchor-view-'+process.pid+'-'+Date.now()+'.tmp');
 try{
  await writeFile(name,JSON.stringify(view,null,2)+'\n',{flag:'wx',mode:0o600});
  await rename(name,dest);
 }finally{await rm(name,{force:true});}
}
export class FactoryEvidenceAnchor{
 constructor(root){this.root=resolve(root);}
 static async create(root,{ledgerId,sourceWitnessId,sourceWitnessKeyFingerprint}={}){
  if(typeof root!=='string'||!root||!isAbsolute(root)||!token.test(ledgerId||'')||
   !token.test(sourceWitnessId||'')||!hex.test(sourceWitnessKeyFingerprint||''))
   err('anchor_requires_pinned_policy_and_new_directory');
  const dir=resolve(root);
  if(dir===parse(dir).root)err('anchor_filesystem_root_forbidden');
  await mkdir(dir,{recursive:false,mode:0o700});
  const pair=generateKeyPairSync('ed25519');
  const privatePem=pair.privateKey.export({type:'pkcs8',format:'pem'});
  const publicPem=pair.publicKey.export({type:'spki',format:'pem'});
  const fingerprint=dig(publicPem);
  const identity={
   schema:'adamantium.factory.anchor-identity/1',
   anchorId:'anchor-'+fingerprint.slice(7,31),
   ledgerId,sourceWitnessId,sourceWitnessKeyFingerprint,
   anchorKeyFingerprint:fingerprint
  };
  await writeFile(join(dir,files.private),privatePem,{flag:'wx',mode:0o600});
  await writeFile(join(dir,files.public),publicPem,{flag:'wx',mode:0o644});
  await writeFile(join(dir,files.identity),JSON.stringify(identity,null,2)+'\n',
   {flag:'wx',mode:0o600});
  await writeFile(join(dir,files.events),'',{flag:'wx',mode:0o600});
  await atomicView(dir,status({identity,records:[]}));
  return new FactoryEvidenceAnchor(dir);
 }
 static async open(root,{expectedAnchorFingerprint,trustedSequence,trustedReceiptHash}={}){
  if(typeof root!=='string'||!root||!isAbsolute(root))err('absolute_anchor_root_required');
  const anchor=new FactoryEvidenceAnchor(root);
  const {identity,records}=await readChain(anchor.root);
  if(expectedAnchorFingerprint!==undefined&&
   identity.anchorKeyFingerprint!==expectedAnchorFingerprint)
   err('untrusted_anchor_public_key');
  if(trustedSequence!==undefined||trustedReceiptHash!==undefined){
   if(!Number.isSafeInteger(trustedSequence)||trustedSequence<1||
      !hex.test(trustedReceiptHash||'')||
      records.find(r=>r.sequence===trustedSequence)?.receiptHash!==trustedReceiptHash)
    err('anchor_external_head_mismatch');
  }
  return anchor;
 }
 async inspect(){
  return copy(status(await readChain(this.root)));
 }
 async attest(bundle){
  if(!bundle||typeof bundle!=='object')err('missing_anchor_bundle');
  const lock=join(this.root,files.lock);
  let held;
  try{held=await open(lock,'wx',0o600);}
  catch(e){if(e.code==='EEXIST')err('anchor_writer_busy');throw e;}
  try{
   const chain=await readChain(this.root);
   const {identity,records}=chain;
   if(bundle?.identity?.witnessId!==identity.sourceWitnessId)
    err('source_witness_identity_mismatch');
   const proof=verifyPublicFactoryWitness({
    ...bundle,ledgerId:identity.ledgerId,
    expectedKeyFingerprint:identity.sourceWitnessKeyFingerprint
   });
   if(proof.status!=='verified_current')err('stale_source_evidence_for_anchor');
   if(!proof.signedReceiptHash)err('missing_source_receipt_hash');
   const last=records.at(-1);
   // A new receipt must carry forward the previously signed witness chain.
   if(last){
    let history;
    try{history=bundle.witnessJSONL.split('\n').filter(Boolean).map(JSON.parse);}
    catch{err('invalid_source_witness_history');}
    if(!history.some(x=>
      x.receiptHash===last.sourceWitnessReceiptHash &&
      x.sequence===last.sourceSequence &&
      x.head===last.sourceHead))
     err('source_witness_checkpoint_disappeared');
   }
   if(last&&last.sourceSequence===proof.signedSequence){
    if(last.sourceHead!==proof.signedHead||
     last.sourceWitnessReceiptHash!==proof.signedReceiptHash)
     err('source_witness_fork_detected');
    return {...copy(last),replayed:true,installationApproved:false};
   }
   if(last&&proof.signedSequence<last.sourceSequence)
    err('source_witness_history_regression');
   const key=createPrivateKey(await readFile(join(this.root,files.private),'utf8'));
   if(dig(createPublicKey(key).export({type:'spki',format:'pem'}))!==
       identity.anchorKeyFingerprint)
    err('anchor_private_key_does_not_match');
   const unsigned={
    schema:'adamantium.factory.anchor-receipt/1',
    anchorId:identity.anchorId,sequence:records.length+1,
    sourceSequence:proof.signedSequence,
    sourceHead:proof.signedHead,
    sourceWitnessReceiptHash:proof.signedReceiptHash,
    previousAnchorReceiptHash:last?.receiptHash||zero,
    issuedAt:new Date().toISOString()
   };
   const signature=sign(null,Buffer.from(JSON.stringify(unsigned)),key)
    .toString('base64url');
   const receipt={...unsigned,signature,receiptHash:dig(JSON.stringify({
    ...unsigned,signature
   }))};
   validateReceipt(receipt,last,identity,createPublicKey(
    await readFile(join(this.root,files.public),'utf8')
   ));
   const out=await open(join(this.root,files.events),'a');
   try{await out.writeFile(JSON.stringify(receipt)+'\n','utf8');await out.sync();}
   finally{await out.close();}
   const after=await readChain(this.root);
   if(after.records.at(-1)?.receiptHash!==receipt.receiptHash)
    err('anchor_readback_mismatch');
   await atomicView(this.root,status(after));
   return {...copy(receipt),replayed:false,installationApproved:false};
  }finally{await held.close();await rm(lock,{force:true});}
 }
}
