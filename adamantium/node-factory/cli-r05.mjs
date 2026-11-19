#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Explicit, local-only R05 demonstration. No implicit global paths or approvals.
import {readFile,stat} from 'node:fs/promises';
import {DurableFactoryWorkflow} from './durable-workflow.mjs';
import {FACTORY_LEDGER_GENESIS} from './durable-ledger.mjs';
const [command,root,argument]=process.argv.slice(2);
const usage='Usage: node adamantium/node-factory/cli-r05.mjs '+
 '(init|inspect|propose|verify|promotion-request|graph) <explicit-ledger-root> [contract-file|proposal-id]';
const fail=code=>{throw Object.assign(new Error(code),{code});};
try{
 if(!root||typeof root!=='string'||process.argv.length>5)
  fail('explicit_ledger_root_required');
 let result;
 if(command==='init'){
  if(argument)fail('extra_argument_not_allowed');
  const workflow=await DurableFactoryWorkflow.create(root);
  result=await workflow.inspect();
 }else{
  const workflow=await DurableFactoryWorkflow.open(root);
  const before=await workflow.inspect();
  if(command==='inspect'){
   if(argument)fail('extra_argument_not_allowed');
   result=before;
  }else if(command==='propose'){
   if(!argument)fail('contract_file_required');
   const info=await stat(argument);
   if(!info.isFile()||info.size>16384)fail('invalid_contract_file');
   const raw=await readFile(argument,'utf8');
   if(Buffer.byteLength(raw)>16384)fail('invalid_contract_file');
   result=await workflow.propose({contract:JSON.parse(raw),
    expectedSequence:before.sequence,expectedHead:before.head});
  }else if(command==='verify'){
   if(!argument)fail('proposal_id_required');
   result=await workflow.verify({
    proposalId:argument,expectedSequence:before.sequence,expectedHead:before.head
   });
  }else if(command==='promotion-request'){
   if(!argument)fail('proposal_id_required');
   result=await workflow.requestPromotion({
    proposalId:argument,expectedSequence:before.sequence,expectedHead:before.head
   });
  }else if(command==='graph'){
   if(!argument)fail('proposal_id_required');
   result=await workflow.preview(argument);
  }else fail('unknown_factory_command');
 }
 process.stdout.write(JSON.stringify(result,null,2)+'\n');
}catch(e){
 process.stderr.write('R05 factory denied: '+(e.code||e.message)+'\n'+usage+'\n');
 process.exitCode=1;
}
