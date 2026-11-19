#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Explicit operator-run, public-material-only status export to a separate UI dir.
import {readFile,writeFile,rename,stat,lstat,rm} from 'node:fs/promises';
import {join,resolve,isAbsolute,relative,parse} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {verifyPublicFactoryWitness,publicFactoryWitnessFailure} from './public-witness-verifier-r07.mjs';
const [command,ledgerRoot,witnessRoot,expectedFingerprint,outputRoot]=process.argv.slice(2);
const sha=b=>createHash('sha256').update(b).digest('hex');
const fail=code=>{throw Object.assign(new Error(code),{code});};
const nested=(a,b)=>{
 const rel=relative(a,b);
 return rel===''||(!rel.startsWith('..')&&!isAbsolute(rel));
};
async function onlyFile(p,max){
 const s=await lstat(p);
 if(!s.isFile()||s.size>max)fail('untrusted_public_file');
 return readFile(p,'utf8');
}
async function main(){
 if(command!=='verify'||process.argv.length!==7||
    ![ledgerRoot,witnessRoot,outputRoot].every(x=>
      typeof x==='string'&&isAbsolute(x))||
    !/^sha256:[a-f0-9]{64}$/.test(expectedFingerprint||''))
  fail('usage_verify_absolute_roots_fingerprint');
 const ledger=resolve(ledgerRoot),witness=resolve(witnessRoot),output=resolve(outputRoot);
 if([ledger,witness,output].some(x=>x===parse(x).root)||
    nested(ledger,output)||nested(witness,output)||
    nested(output,ledger)||nested(output,witness))
  fail('public_status_destination_must_be_independent');
 if(!(await stat(output)).isDirectory())fail('public_status_output_directory_missing');
 const [identityJSON,publicKeyPem,journalJSONL,witnessJSONL]=await Promise.all([
  onlyFile(join(witness,'witness-identity.json'),4096),
  onlyFile(join(witness,'signer-public.pem'),4096),
  onlyFile(join(ledger,'journal.jsonl'),4*1024*1024),
  onlyFile(join(witness,'witness.jsonl'),3*1024*1024)
 ]);
 let status;
 try{
  const identity=JSON.parse(identityJSON);
  status=verifyPublicFactoryWitness({
   identity,publicKeyPem,journalJSONL,witnessJSONL,
   ledgerId:identity.ledgerId,expectedKeyFingerprint:expectedFingerprint
  });
  // Do not display "verified current" if public evidence changed during check.
  const [againJournal,againReceipts]=await Promise.all([
   onlyFile(join(ledger,'journal.jsonl'),4*1024*1024),
   onlyFile(join(witness,'witness.jsonl'),3*1024*1024)
  ]);
  if(sha(journalJSONL)!==sha(againJournal)||
     sha(witnessJSONL)!==sha(againReceipts))
   fail('public_evidence_changed_during_verification');
 }catch(e){status=publicFactoryWitnessFailure(e);}
 const target=join(output,'public-verifier-status.json');
 try{
  const old=await lstat(target);
  if(!old.isFile())fail('status_output_not_regular_file');
  const known=JSON.parse(await readFile(target,'utf8'));
  if(known.schema!=='adamantium.factory.public-verification/1')
   fail('refuse_overwrite_unowned_status');
 }catch(e){if(e.code!=='ENOENT')throw e;}
 const temp=join(output,'public-verifier-'+randomUUID()+'.tmp');
 try{
  await writeFile(temp,JSON.stringify(status,null,2)+'\n',{flag:'wx',mode:0o600});
  await rename(temp,target);
 }finally{await rm(temp,{force:true});}
 // Never print raw signatures or secrets. Do not claim permission granted.
 process.stdout.write(JSON.stringify({
  status:status.status,sourceSequence:status.sourceSequence||null,
  signedSequence:status.signedSequence||null,reason:status.reason||null,
  approvalGranted:false,outputFile:target
 })+'\n');
 if(status.status==='invalid')process.exitCode=2;
}
try{await main();}
catch(e){
 process.stderr.write('R07 verifier denied: '+(e.code||'operation_failed')+'\n');
 process.exitCode=1;
}
