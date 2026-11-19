// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {promisify} from 'node:util';
import {execFile} from 'node:child_process';
import {DurableFactoryWorkflow} from '../../adamantium/node-factory/durable-workflow.mjs';
import {FACTORY_LEDGER_GENESIS} from '../../adamantium/node-factory/durable-ledger.mjs';
import {FactoryAuditWitness} from '../../adamantium/node-factory/audit-witness-r06.mjs';
import {demoFactoryContract} from '../../adamantium/node-factory/contract.mjs';
import {makePublicWitnessObserver} from '../../adamantium/node-factory/public-witness-studio-r07.mjs';
const exec=promisify(execFile);
const cli=new URL('../../adamantium/node-factory/cli-public-verifier-r07.mjs',import.meta.url).pathname;
test('public witness status CLI creates read-only UI status and detects stale signed head',async()=>{
 const root=await mkdtemp(join(tmpdir(),'adamantium-r07-cli-'));
 try{
  const ledger=join(root,'ledger'),witness=join(root,'witness');
  const status=join(root,'status');
  await mkdir(status);
  const factory=await DurableFactoryWorkflow.create(ledger);
  const p=await factory.propose({contract:demoFactoryContract(),
   expectedSequence:0,expectedHead:FACTORY_LEDGER_GENESIS});
  const signer=await FactoryAuditWitness.create(witness,'factory-r07-cli');
  const key=(await signer.inspect()).keyFingerprint;
  await signer.issue(ledger);
  const run=async()=>{
   const out=await exec(process.execPath,[
    new URL('../../adamantium/node-factory/cli-public-verifier-r07.mjs',import.meta.url).pathname,
    'verify',ledger,witness,key,status
   ]);
   return {receipt:JSON.parse(out.stdout),
    status:JSON.parse(await readFile(join(status,'public-verifier-status.json'),'utf8'))};
  };
  const first=await run();
  assert.equal(first.status.status,'verified_current');
  assert.equal(first.receipt.status,'verified_current');
  assert.equal(first.status.authorizesModuleInstallation,false);
  const change=await factory.requestPromotion({proposalId:p.proposalId,
   expectedSequence:1,expectedHead:p.head}).catch(()=>null);
  // R05 does not accept an unverified promotion. Move forward via rejection instead.
  assert.equal(change,null);
  await factory.ledger.append({
   kind:'factory.rejected',payload:{proposalId:p.proposalId,reason:'unit_test_rejection'},
   expectedSequence:1,expectedHead:p.head
  });
  const stale=await run();
  assert.equal(stale.status.status,'verified_stale');
  assert.equal(stale.status.headMatchesCurrent,false);
  assert.equal(stale.status.signatureValid,true);
  await signer.issue(ledger);
  assert.equal((await run()).status.status,'verified_current');
  const flow=makePublicWitnessObserver(status);
  assert.equal(flow.flows.length,12);
  assert.equal(flow.signerPrivateKeyExposed,false);
  assert.equal(flow.mutatesLedger,false);
  const allowed=new Set(['tab','comment','inject','watch','file in','json','switch','debug']);
  assert.ok(flow.flows.every(x=>allowed.has(x.type)));
  assert.ok(flow.flows.every(x=>!JSON.stringify(x).includes('signer-private.pem')));
  assert.deepEqual(flow.flows.filter(x=>x.type==='switch')[0].rules.map(x=>x.v),
   ['verified_current','verified_stale','invalid']);
  const ids=new Set(flow.flows.map(x=>x.id));
  assert.equal(ids.size,flow.flows.length);
  for(const n of flow.flows)for(const wires of n.wires||[])
   for(const target of wires)assert.ok(ids.has(target),'wire target not in flow');
 }finally{await rm(root,{recursive:true,force:true,maxRetries:3,retryDelay:60});}
});
test('public verifier observer refuses relative or drive-root status paths',()=>{
 for(const bad of [null,'','untrusted',resolve('/')])
  assert.throws(()=>makePublicWitnessObserver(bad),
   /owner_absolute_public_status_root_required|status_root_is_filesystem_root/);
});
