#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Export only public and fully verified R05/R06 evidence, never a signer key.
// Deliberately no remote host, tunnel or transport dependencies.
import {readFile,writeFile,rename,lstat,stat,rm} from 'node:fs/promises';
import {join,resolve,isAbsolute,relative,parse} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {verifyPublicFactoryWitness} from './public-witness-verifier-r07.mjs';
const fail=code=>{throw Object.assign(new Error(code),{code});};
const digest=data=>createHash('sha256').update(data).digest('hex');
const [operation,ledgerArg,witnessArg,expectedPin,outputArg]=process.argv.slice(2);
const nested=(a,b)=>{
 const r=relative(a,b);
 return r===''||(!r.startsWith('..')&&!isAbsolute(r));
};
async function file(path,max){
 const s=await lstat(path);
 if(!s.isFile()||s.size>max)fail('unsafe_evidence_source');
 return readFile(path,'utf8');
}
async function main(){
 if(operation!=='export'||process.argv.length!==7||
    ![ledgerArg,witnessArg,outputArg].every(x=>
      typeof x==='string'&&isAbsolute(x))||
    !/^sha256:[a-f0-9]{64}$/.test(expectedPin||''))
  fail('explicit_absolute_source_and_pin_required');
 const ledger=resolve(ledgerArg),witness=resolve(witnessArg),output=resolve(outputArg);
 if([ledger,witness,output].some(p=>p===parse(p).root)||
   nested(ledger,output)||nested(output,ledger)||
   nested(witness,output)||nested(output,witness))
  fail('public_bundle_output_must_be_independent');
 if(!(await stat(output)).isDirectory())fail('missing_public_bundle_destination');
 const paths=[
  join(witness,'witness-identity.json'),join(witness,'signer-public.pem'),
  join(ledger,'journal.jsonl'),join(witness,'witness.jsonl')
 ];
 const limit=[4096,4096,4*1024*1024,3*1024*1024];
 const data=await Promise.all(paths.map((p,i)=>file(p,limit[i])));
 const identity=JSON.parse(data[0]);
 const input={
  ledgerId:identity.ledgerId,expectedKeyFingerprint:expectedPin,
  identity,publicKeyPem:data[1],journalJSONL:data[2],witnessJSONL:data[3]
 };
 const proof=verifyPublicFactoryWitness(input);
 if(proof.status!=='verified_current')fail('only_current_signed_proof_can_be_exported');
 const recheck=await Promise.all(paths.map((p,i)=>file(p,limit[i])));
 if(data.some((v,i)=>digest(v)!==digest(recheck[i])))
  fail('public_source_changed_during_export');
 const payload={
  schema:'adamantium.factory.public-bundle/1',
  ledgerId:identity.ledgerId,
  identity,publicKeyPem:data[1],journalJSONL:data[2],witnessJSONL:data[3]
 };
 const body=JSON.stringify(payload,null,2)+'\n';
 if(Buffer.byteLength(body)>8*1024*1024)fail('public_bundle_budget_exceeded');
 const dest=join(output,'public-bundle-r08.json');
 try{await lstat(dest);fail('refuse_overwrite_prior_export');}
 catch(e){if(e.code!=='ENOENT')throw e;}
 const temp=join(output,'bundle-'+randomUUID()+'.tmp');
 try{
  await writeFile(temp,body,{flag:'wx',mode:0o600});
  await rename(temp,dest);
 }finally{await rm(temp,{force:true});}
 process.stdout.write(JSON.stringify({
  schema:payload.schema,
  sourceSequence:proof.sourceSequence,
  witnessKeyFingerprint:expectedPin,
  bundleBytes:Buffer.byteLength(body),
  bundleDigest:'sha256:'+digest(body),
  output:dest,
  sourcePrivateKeyIncluded:false,
  authorizedForProduction:false
 })+'\n');
}
try{await main();}catch(e){
 process.stderr.write('R08 public bundle export denied: '+(e.code||'unavailable')+'\n');
 process.exitCode=1;
}
