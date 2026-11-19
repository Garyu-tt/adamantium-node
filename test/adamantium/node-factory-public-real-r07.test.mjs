// SPDX-License-Identifier: Apache-2.0
// Real disposable Node-RED R05 proof → signed R06 witness → PUBLIC R07 verifier.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {execFile} from 'node:child_process';
import {DurableFactoryWorkflow} from '../../adamantium/node-factory/durable-workflow.mjs';
import {FACTORY_LEDGER_GENESIS} from '../../adamantium/node-factory/durable-ledger.mjs';
import {FactoryAuditWitness} from '../../adamantium/node-factory/audit-witness-r06.mjs';
import {demoFactoryContract} from '../../adamantium/node-factory/contract.mjs';
const cli=fileURLToPath(new URL('../../adamantium/node-factory/cli-public-verifier-r07.mjs',import.meta.url));
const exec=promisify(execFile);
test('actual Node-RED test → R05 durable proof → R06 sign → R07 public verify',
 {timeout:170000},async()=>{
 const root=await mkdtemp(join(tmpdir(),'adamantium-factory-r07-real-'));
 try{
  const ledger=join(root,'ledger'),witness=join(root,'witness'),status=join(root,'ui');
  await mkdir(status);
  const workflow=await DurableFactoryWorkflow.create(ledger);
  const p=await workflow.propose({contract:demoFactoryContract(),
   expectedSequence:0,expectedHead:FACTORY_LEDGER_GENESIS});
  const proof=await workflow.verify({proposalId:p.proposalId,
   expectedSequence:1,expectedHead:p.head});
  const review=await workflow.requestPromotion({proposalId:p.proposalId,
   expectedSequence:2,expectedHead:proof.head});
  assert.equal(review.approvalGranted,false);
  const source=await workflow.inspect();
  assert.equal(source.proposals[p.proposalId].proof.actualNodeRedExecution,true);
  assert.equal(source.proposals[p.proposalId].proof.sandboxDestroyed,true);
  const signer=await FactoryAuditWitness.create(witness,'factory-real-r07');
  await signer.issue(ledger);
  const pin=(await signer.inspect()).keyFingerprint;
  const command=await exec(process.execPath,[cli,'verify',ledger,witness,pin,status]);
  const result=JSON.parse(command.stdout);
  const ui=JSON.parse(await readFile(join(status,'public-verifier-status.json'),'utf8'));
  assert.equal(result.status,'verified_current');
  assert.equal(ui.sourceSequence,3);
  assert.equal(ui.signedSequence,3);
  assert.equal(ui.signatureValid,true);
  assert.equal(ui.headMatchesCurrent,true);
  assert.equal(ui.policyEnforced,false);
  assert.equal(ui.authorizesModuleInstallation,false);
  assert.equal(source.authorizationEffective,false);
 }finally{await rm(root,{recursive:true,force:true,maxRetries:4,retryDelay:100});}
});
