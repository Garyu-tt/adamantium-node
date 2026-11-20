#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Check an externally witnessed R05/R06 ledger using only public evidence.
import {readFile,lstat,stat,writeFile,rename,rm} from 'node:fs/promises';
import {join,resolve,isAbsolute,parse,relative} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {verifyOffhostFactoryAnchor,offhostVerificationFailure} from './offhost-anchor-verifier-r08.mjs';
const [operation,ledgerArg,sourceWitnessArg,anchorArg,sourcePin,anchorPin,outputArg]=process.argv.slice(2);
const fail=c=>{throw Object.assign(new Error(c),{code:c});};
const sha=v=>createHash('sha256').update(v).digest('hex');
const nested=(a,b)=>{
 const r=relative(a,b);
 return r===''||(!r.startsWith('..')&&!isAbsolute(r));
};
async function regular(p,max){
 const s=await lstat(p);
 if(!s.isFile()||s.size>max)fail('unsafe_public_evidence');
 return readFile(p,'utf8');
}
async function run(){
 if(operation!=='verify'||process.argv.length!==9||
  ![ledgerArg,sourceWitnessArg,anchorArg,outputArg].every(x=>
     typeof x==='string'&&isAbsolute(x))||
  !/^sha256:[a-f0-9]{64}$/.test(sourcePin||'')||
  !/^sha256:[a-f0-9]{64}$/.test(anchorPin||''))
  fail('explicit_pinned_verifier_arguments_required');
 const ledger=resolve(ledgerArg),witness=resolve(sourceWitnessArg),
  anchor=resolve(anchorArg),out=resolve(outputArg);
 if([ledger,witness,anchor,out].some(x=>x===parse(x).root)||
    [ledger,witness,anchor].some(x=>nested(x,out)||nested(out,x)))
  fail('offhost_status_must_use_separate_directory');
 if(!(await stat(out)).isDirectory())fail('offhost_status_directory_missing');
 const paths=[
  join(witness,'witness-identity.json'),join(witness,'signer-public.pem'),
  join(ledger,'journal.jsonl'),join(witness,'witness.jsonl'),
  join(anchor,'anchor-identity.json'),join(anchor,'anchor-public.pem'),
  join(anchor,'anchor.jsonl')
 ];
 const max=[4096,4096,4*1024*1024,3*1024*1024,4096,4096,3*1024*1024];
 const data=await Promise.all(paths.map((p,i)=>regular(p,max[i])));
 let status;
 try{
  status=verifyOffhostFactoryAnchor({
   sourceEvidence:{
    ledgerId:JSON.parse(data[0]).ledgerId,
    expectedKeyFingerprint:sourcePin,
    identity:JSON.parse(data[0]),publicKeyPem:data[1],
    journalJSONL:data[2],witnessJSONL:data[3]
   },
   anchorIdentity:JSON.parse(data[4]),anchorPublicPem:data[5],
   expectedAnchorPublicKeyFingerprint:anchorPin,anchorJSONL:data[6]
  });
  const replay=await Promise.all(paths.map((p,i)=>regular(p,max[i])));
  if(data.some((v,i)=>sha(v)!==sha(replay[i])))
   fail('public_evidence_changed_during_offhost_verification');
 }catch(e){status=offhostVerificationFailure(e);}
 const target=join(out,'offhost-verification-status-r08.json');
 try{
  const prev=await lstat(target);
  if(!prev.isFile())fail('refuse_nonfile_status');
  const contents=JSON.parse(await readFile(target,'utf8'));
  if(contents.schema!=='adamantium.factory.offhost-verification/1')
   fail('refuse_overwrite_unowned_status');
 }catch(e){if(e.code!=='ENOENT')throw e;}
 const tmp=join(out,'offhost-status-'+randomUUID()+'.tmp');
 try{
  await writeFile(tmp,JSON.stringify(status,null,2)+'\n',{flag:'wx',mode:0o600});
  await rename(tmp,target);
 }finally{await rm(tmp,{force:true});}
 process.stdout.write(JSON.stringify({
  state:status.status,anchorSequence:status.anchorSequence??null,
  sourceSequence:status.sourceSequence??null,
  anchorReceiptHash:status.anchorReceiptHash??null,
  output:target,reason:status.reason??null,
  productionAccessGranted:false
 })+'\n');
 if(status.status==='invalid')process.exitCode=2;
}
try{await run();}catch(e){
 process.stderr.write('R08 public anchor verification denied: '+(e.code||'operation_failed')+'\n');
 process.exitCode=1;
}
