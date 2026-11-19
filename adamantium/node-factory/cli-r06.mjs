#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Operator-only. Refuses arbitrary install, privileged apply or network access.
import {FactoryAuditWitness} from './audit-witness-r06.mjs';
const [action,witnessRoot,parameter]=process.argv.slice(2);
try{
 if(!witnessRoot||process.argv.length>5)
  throw new Error('explicit_witness_root_required');
 let result;
 if(action==='init'){
  if(!parameter)throw new Error('ledger_id_required');
  const witness=await FactoryAuditWitness.create(witnessRoot,parameter);
  result=await witness.inspect();
 }else if(action==='inspect'){
  const witness=await FactoryAuditWitness.open(witnessRoot);
  result=await witness.inspect(parameter);
 }else if(action==='issue'){
  if(!parameter)throw new Error('ledger_root_required');
  const witness=await FactoryAuditWitness.open(witnessRoot);
  result=await witness.issue(parameter);
 }else throw new Error('unknown_witness_action');
 process.stdout.write(JSON.stringify(result,null,2)+'\n');
}catch(error){
 process.stderr.write('R06 audit witness denied: '+(error.code||error.message)+'\n');
 process.exitCode=1;
}
