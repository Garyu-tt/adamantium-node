// SPDX-License-Identifier: Apache-2.0
// Detached Ed25519 audit witness: signature != production/MAS authorization.
// Signer root is separate from the source ledger and must be independently hosted
// to gain independent-failure-domain protection; same-host testing is not that.
import {generateKeyPairSync,createHash,createPrivateKey,createPublicKey,sign,verify} from 'node:crypto';
import {mkdir,writeFile,readFile,open,rm,rename,lstat} from 'node:fs/promises';
import {join,resolve,relative,isAbsolute,parse} from 'node:path';
import {DurableFactoryLedger} from './durable-ledger.mjs';

const files={
 key:'signer-private.pem',public:'signer-public.pem',
 identity:'witness-identity.json',chain:'witness.jsonl',
 view:'witness-view.json',lock:'witness-writer.lock'
};
const sha=b=>'sha256:'+createHash('sha256').update(b).digest('hex');
const err=code=>Object.assign(new Error(code),{code});
const token=/^[a-z][a-z0-9_.-]{2,95}$/;
const digest=/^sha256:[a-f0-9]{64}$/;
const own=(value,props)=>value&&typeof value==='object'&&!Array.isArray(value)&&
 Object.keys(value).length===props.length&&props.every(k=>Object.hasOwn(value,k));
const copy=value=>JSON.parse(JSON.stringify(value));
const ZERO='sha256:'+'0'.repeat(64);
const verifyPaths=(ledgerRoot,witnessRoot)=>{
 if(typeof ledgerRoot!=='string'||!ledgerRoot||!isAbsolute(ledgerRoot))
  throw err('absolute_ledger_root_required');
 const ledger=resolve(ledgerRoot),witness=resolve(witnessRoot);
 if(ledger===parse(ledger).root)throw err('root_directory_cannot_be_ledger');
 const nested=(a,b)=>{const rel=relative(a,b);return rel===''||(!rel.startsWith('..')&&!isAbsolute(rel));};
 if(nested(ledger,witness)||nested(witness,ledger))
  throw err('witness_and_ledger_must_be_separate_directories');
 return ledger;
};
async function readIdentity(root){
 const identity=JSON.parse(await readFile(join(root,files.identity),'utf8'));
 if(!own(identity,['schema','ledgerId','witnessId','keyFingerprint'])||
  identity.schema!=='adamantium.factory.witness-identity/1'||
  !token.test(identity.ledgerId)||!token.test(identity.witnessId)||
  !digest.test(identity.keyFingerprint))
  throw err('invalid_witness_identity');
 const publicPem=await readFile(join(root,files.public),'utf8');
 if(sha(publicPem)!==identity.keyFingerprint)throw err('witness_public_key_pin_mismatch');
 return {identity,publicKey:createPublicKey(publicPem)};
}
function validateReceipt(item,previous,identity,publicKey){
 const fields=['schema','ledgerId','witnessId','sequence','head',
  'previousReceipt','issuedAt','signature','receiptHash'];
 if(!own(item,fields)||item.schema!=='adamantium.factory.witness-receipt/1'||
  item.ledgerId!==identity.ledgerId||item.witnessId!==identity.witnessId||
  !Number.isSafeInteger(item.sequence)||item.sequence<1||
  !digest.test(item.head)||item.previousReceipt!==(previous?.receiptHash||ZERO)||
  !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(item.issuedAt)||
  typeof item.signature!=='string'||!/^[A-Za-z0-9_-]{70,128}$/.test(item.signature)||
  !digest.test(item.receiptHash))
  throw err('witness_receipt_schema_invalid');
 if(previous&&item.sequence<=previous.sequence)throw err('witness_sequence_regression');
 const {signature,receiptHash,...unsigned}=item;
 if(!verify(null,Buffer.from(JSON.stringify(unsigned)),publicKey,
   Buffer.from(signature,'base64url')))
  throw err('witness_signature_invalid');
 if(sha(JSON.stringify({...unsigned,signature}))!==receiptHash)
  throw err('witness_hash_invalid');
 return item;
}
async function readChain(root){
 const {identity,publicKey}=await readIdentity(root);
 const source=join(root,files.chain);
 if(!(await lstat(source)).isFile())throw err('witness_chain_not_file');
 const value=await readFile(source,'utf8');
 if(Buffer.byteLength(value)>3*1024*1024)throw err('witness_size_limit');
 if(value&&!value.endsWith('\n'))throw err('witness_torn_tail');
 const receipts=[];
 for(const line of value.split('\n')){
  if(!line)continue;
  let parsed;
  try{parsed=JSON.parse(line);}catch{throw err('witness_invalid_json');}
  receipts.push(validateReceipt(parsed,receipts.at(-1),identity,publicKey));
 }
 return {identity,receipts};
}
async function writeView(root,state){
 const target=join(root,files.view);
 const temp=join(root,'witness-view.'+process.pid+'.'+Date.now()+'.tmp');
 try{
  await writeFile(temp,JSON.stringify(state,null,2)+'\n',{flag:'wx',mode:0o600});
  await rename(temp,target);
 }finally{await rm(temp,{force:true});}
}
function buildView({identity,receipts},ledgerState=null){
 const latest=receipts.at(-1)||null;
 const proposals={};
 if(ledgerState)for(const [candidate,p] of Object.entries(ledgerState.proposals)){
  proposals[candidate]={
   status:p.status,
   promotionRequested:p.promotionRequested===true,
   witnessCoversCurrentJournal:!!latest&&
     latest.sequence===ledgerState.sequence&&latest.head===ledgerState.head,
   eligibleForIndependentReview:p.status==='verified'&&
     p.promotionRequested===true&&!!latest&&
     latest.sequence===ledgerState.sequence&&latest.head===ledgerState.head,
   approvalGranted:false,productionPublished:false
  };
 }
 return {
  schema:'adamantium.factory.witness-view/1',
  ledgerId:identity.ledgerId,witnessId:identity.witnessId,
  keyFingerprint:identity.keyFingerprint,
  checkpoints:receipts.length,latest,
  currentLedgerSequence:ledgerState?.sequence??null,
  currentLedgerHead:ledgerState?.head??null,
  proposals,
  signedByEd25519:true,
  independentlyHosted:false,
  separatelyPinnedExternalWitness:false,
  policyEnforced:false,approvalGranted:false,productionPublished:false
 };
}
export class FactoryAuditWitness{
 constructor(root){this.root=resolve(root);}
 static async create(root,ledgerId){
  if(typeof root!=='string'||!root||!isAbsolute(root)||!token.test(ledgerId||''))
   throw err('explicit_witness_root_and_ledger_id_required');
  const folder=resolve(root);
  if(folder===parse(folder).root)throw err('filesystem_root_refused');
  await mkdir(folder,{recursive:false,mode:0o700});
  const {privateKey,publicKey}=generateKeyPairSync('ed25519');
  const privatePem=privateKey.export({type:'pkcs8',format:'pem'});
  const publicPem=publicKey.export({type:'spki',format:'pem'});
  const fingerprint=sha(publicPem);
  const identity={
   schema:'adamantium.factory.witness-identity/1',
   ledgerId,witnessId:'witness-'+fingerprint.slice(7,31),
   keyFingerprint:fingerprint
  };
  await writeFile(join(folder,files.key),privatePem,{flag:'wx',mode:0o600});
  await writeFile(join(folder,files.public),publicPem,{flag:'wx',mode:0o644});
  await writeFile(join(folder,files.identity),JSON.stringify(identity,null,2)+'\n',
   {flag:'wx',mode:0o600});
  await writeFile(join(folder,files.chain),'',{flag:'wx',mode:0o600});
  await writeView(folder,buildView({identity,receipts:[]}));
  return new FactoryAuditWitness(folder);
 }
 static async open(root,{expectedKeyFingerprint}={}){
  if(typeof root!=='string'||!root||!isAbsolute(root))
   throw err('absolute_witness_root_required');
  const witness=new FactoryAuditWitness(root);
  const state=await readChain(witness.root);
  if(expectedKeyFingerprint!==undefined&&
   state.identity.keyFingerprint!==expectedKeyFingerprint)
   throw err('trusted_witness_key_mismatch');
  return witness;
 }
 async inspect(ledgerRoot){
  const chain=await readChain(this.root);
  if(ledgerRoot===undefined)return copy(buildView(chain));
  const ledger=verifyPaths(ledgerRoot,this.root);
  const state=await (await DurableFactoryLedger.open(ledger)).inspect();
  for(const receipt of chain.receipts){
   await (await DurableFactoryLedger.open(ledger)).inspect({
    trustedSequence:receipt.sequence,trustedHead:receipt.head
   });
  }
  return copy(buildView(chain,state));
 }
 async issue(ledgerRoot){
  const root=verifyPaths(ledgerRoot,this.root);
  const lock=join(this.root,files.lock);
  let locked;
  try{locked=await open(lock,'wx',0o600);}
  catch(e){if(e.code==='EEXIST')throw err('witness_writer_busy');throw e;}
  try{
   const chain=await readChain(this.root);
   const last=chain.receipts.at(-1);
   const ledger=await DurableFactoryLedger.open(root);
   const state=await ledger.inspect(last?{
    trustedSequence:last.sequence,trustedHead:last.head
   }:{});
   if(state.sequence<1)throw err('genesis_not_a_proof');
   if(last&&state.sequence===last.sequence){
    if(state.head!==last.head)throw err('witness_history_conflict');
    return {...copy(last),replayed:true,approvalGranted:false};
   }
   const privateKey=createPrivateKey(await readFile(join(this.root,files.key)));
   const publicFromPrivate=createPublicKey(privateKey).export({type:'spki',format:'pem'});
   if(sha(publicFromPrivate)!==chain.identity.keyFingerprint)
    throw err('witness_private_key_mismatch');
   const unsigned={
    schema:'adamantium.factory.witness-receipt/1',
    ledgerId:chain.identity.ledgerId,witnessId:chain.identity.witnessId,
    sequence:state.sequence,head:state.head,
    previousReceipt:last?.receiptHash||ZERO,issuedAt:new Date().toISOString()
   };
   const signature=sign(null,Buffer.from(JSON.stringify(unsigned)),privateKey).toString('base64url');
   const receipt={...unsigned,signature,receiptHash:sha(JSON.stringify({...unsigned,signature}))};
   validateReceipt(receipt,last,chain.identity,createPublicKey(publicFromPrivate));
   // Never sign a stale graph when source revision has changed meanwhile.
   const latestState=await ledger.inspect();
   if(latestState.sequence!==state.sequence||latestState.head!==state.head)
    throw err('ledger_changed_while_signing');
   const output=await open(join(this.root,files.chain),'a');
   try{await output.writeFile(JSON.stringify(receipt)+'\n','utf8');await output.sync();}
   finally{await output.close();}
   const check=await readChain(this.root);
   if(check.receipts.at(-1)?.receiptHash!==receipt.receiptHash)
    throw err('witness_append_readback_failed');
   await writeView(this.root,buildView(check,state));
   return {...copy(receipt),replayed:false,approvalGranted:false};
  }finally{await locked.close();await rm(lock,{force:true});}
 }
}
