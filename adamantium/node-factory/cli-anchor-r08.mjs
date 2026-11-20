#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Deliberately no network or MAS deployment capability. Operator-only offline CLI.
import {readFile,lstat} from 'node:fs/promises';
import {FactoryEvidenceAnchor} from './independent-anchor-r08.mjs';
const [action,root,argument]=process.argv.slice(2);
const fail=code=>{throw Object.assign(new Error(code),{code});};
async function fileJSON(path,maxSize=7*1024*1024){
 const st=await lstat(path);
 if(!st.isFile()||st.size>maxSize)fail('untrusted_input_file');
 return JSON.parse(await readFile(path,'utf8'));
}
try{
 if(!root||process.argv.length>5)fail('explicit_anchor_root_required');
 let output;
 if(action==='init'){
  if(!argument)fail('anchor_policy_file_required');
  const policy=await fileJSON(argument,8192);
  const anchor=await FactoryEvidenceAnchor.create(root,policy);
  output=await anchor.inspect();
 }else if(action==='attest'){
  if(!argument)fail('public_evidence_bundle_file_required');
  const anchor=await FactoryEvidenceAnchor.open(root);
  output=await anchor.attest(await fileJSON(argument));
 }else if(action==='inspect'){
  if(argument)fail('unexpected_argument');
  output=await (await FactoryEvidenceAnchor.open(root)).inspect();
 }else fail('unknown_anchor_action');
 process.stdout.write(JSON.stringify(output,null,2)+'\n');
}catch(e){
 process.stderr.write('R08 anchor denied: '+(e.code||'unknown_error')+'\n');
 process.exitCode=1;
}
