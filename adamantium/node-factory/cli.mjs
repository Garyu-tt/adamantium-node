#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// One explicit build target, no shell access to generated nodes or npm publication.
import {stat,readFile} from 'node:fs/promises';
import {manufactureIsolated} from './manufacture.mjs';
const [contractPath,isolationRoot]=process.argv.slice(2);
if(!contractPath||!isolationRoot||process.argv.length!==4){
  process.stderr.write('Usage: node adamantium/node-factory/cli.mjs <contract.json> <new-isolated-root>\n');
  process.exitCode=2;
}else{
  try{
    const info=await stat(contractPath);
    if(!info.isFile()||info.size>16384)throw new Error('invalid_contract_file_budget');
    const source=await readFile(contractPath,'utf8');
    if(Buffer.byteLength(source)>16384)throw new Error('invalid_contract_file_budget');
    const result=await manufactureIsolated(JSON.parse(source),isolationRoot);
    process.stdout.write(JSON.stringify(result,null,2)+'\n');
  }catch(error){
    process.stderr.write('Node factory denied: '+(error.code||error.message)+'\n');
    process.exitCode=1;
  }
}
