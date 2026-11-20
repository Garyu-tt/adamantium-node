// SPDX-License-Identifier: Apache-2.0
// Full real Node-RED 5 sandbox → R05 → R06 → Python R08 → JS public verifier.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {execFile} from 'node:child_process';
import {DurableFactoryWorkflow} from '../../adamantium/node-factory/durable-workflow.mjs';
import {FACTORY_LEDGER_GENESIS} from '../../adamantium/node-factory/durable-ledger.mjs';
import {FactoryAuditWitness} from '../../adamantium/node-factory/audit-witness-r06.mjs';
import {demoFactoryContract} from '../../adamantium/node-factory/contract.mjs';
const root=new URL('../../adamantium/node-factory/',import.meta.url);
const cmd=(name)=>fileURLToPath(new URL(name,root));
const exec=promisify(execFile);
test('Node-RED 5 runtime → signed source → independent Python signer → JS public dual signature',
 {timeout:180000},async()=>{
 const parent=await mkdtemp(join(tmpdir(),'adamantium-factory-r08-real-'));
 try{
  const ledger=join(parent,'ledger');
  const sourceWitness=join(parent,'sourceWitness');
  const publicBundle=join(parent,'publicBundle');
  const offhost=join(parent,'offhost');
  const imported=join(parent,'imported');
  const output=join(parent,'publicStatus');
  await Promise.all([publicBundle,imported,output].map(x=>mkdir(x)));
  const factory=await DurableFactoryWorkflow.create(ledger);
  const proposal=await factory.propose({
   contract:demoFactoryContract(),expectedSequence:0,expectedHead:FACTORY_LEDGER_GENESIS
  });
  const verified=await factory.verify({
   proposalId:proposal.proposalId,expectedSequence:1,expectedHead:proposal.head
  });
  const promotion=await factory.requestPromotion({
   proposalId:proposal.proposalId,expectedSequence:2,expectedHead:verified.head
  });
  assert.equal(promotion.approvalGranted,false);
  const signer=await FactoryAuditWitness.create(sourceWitness,'factory-crosslang-r08');
  const sourceReceipt=await signer.issue(ledger);
  assert.equal(sourceReceipt.sequence,3);
  const sourcePin=(await signer.inspect()).keyFingerprint;
  await exec(process.execPath,[
   cmd('export-public-bundle-r08.mjs'),'export',
   ledger,sourceWitness,sourcePin,publicBundle
  ]);
  await exec('python',[cmd('offhost-anchor-r08.py'),'init','--root',offhost,
   '--ledger-id','factory-crosslang-r08',
   '--source-public-key-pin',sourcePin]);
  const receipt=await exec('python',[cmd('offhost-anchor-r08.py'),'attest',
   '--root',offhost,'--bundle',join(publicBundle,'public-bundle-r08.json')]);
  assert.equal(JSON.parse(receipt.stdout).sequence,3);
  const anchor=JSON.parse(await readFile(join(offhost,'anchor-identity.json'),'utf8'));
  await exec(process.execPath,[
   cmd('cli-offhost-verifier-r08.mjs'),'verify',ledger,sourceWitness,
   offhost,sourcePin,anchor.keyFingerprint,output
  ]);
  const status=JSON.parse(await readFile(
   join(output,'offhost-verification-status-r08.json'),'utf8'));
  assert.equal(status.status,'verified_current');
  assert.equal(status.anchorSequence,3);
  assert.equal(status.sourceSequence,3);
  assert.equal(status.sourceSignatureValid,true);
  assert.equal(status.anchorSignatureValid,true);
  assert.equal(status.anchorHistoryVerified,true);
  assert.equal(status.grantsMASCapabilities,false);
  assert.equal(status.productionPublished,false);
  const state=await factory.inspect();
  assert.equal(state.proposals[proposal.proposalId].proof.actualNodeRedExecution,true);
  assert.equal(state.proposals[proposal.proposalId].proof.sandboxDestroyed,true);
 }finally{await rm(parent,{recursive:true,force:true,maxRetries:4,retryDelay:150});}
});
