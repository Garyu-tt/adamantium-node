// SPDX-License-Identifier: Apache-2.0
// Real isolated Node-RED Admin API v2: palette, CAS, execution, verified rollback.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {startFactorySandbox} from '../../adamantium/node-red-adapter/sandbox-runtime.mjs';
import {FactorySandboxAdmin} from '../../adamantium/node-red-adapter/sandbox-admin.mjs';
import {demoFactoryContract} from '../../adamantium/node-factory/contract.mjs';

const nodeRedEntrypoint=fileURLToPath(new URL(
 '../../packages/node_modules/node-red/red.js',import.meta.url));
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
test('real Node-RED 5 palette → Admin API v2 CAS → one-shot node → rollback → restart',
 {timeout:155000},async()=>{
 const root=join(tmpdir(),'adamantium-factory-admin-'+randomUUID());
 let running,second;
 try{
  running=await startFactorySandbox({root,contract:demoFactoryContract()});
  const {admin,receipt}=running;
  assert.equal(receipt.verifiedInstalledFiles,true);
  assert.equal(receipt.registeredInProduction,false);
  assert.equal(running.child.exitCode,null);
  const first=await admin.inspect();
  assert.equal(first.flows.length,0);
  const nodes=await admin.availableTypes();
  assert.match(JSON.stringify(nodes),/adamantium-demo-uppercase/);
  const missing=await fetch(admin.baseUrl+'/flows',{
   headers:{'Node-RED-API-Version':'v2'}});
  assert.equal(missing.status,401);
  const forged=new FactorySandboxAdmin({baseUrl:admin.baseUrl,
   token:admin.token,sandboxId:'foreign-'+running.sandboxId});
  await assert.rejects(forged.inspect(),/foreign_node_red_instance/);
  const deployed=await admin.deployFactory({
   nodeType:receipt.nodeType,baseRevision:first.rev,
   idempotencyKey:'factory-r03-verified-run'});
  assert.equal(deployed.verifiedReadback,true);
  assert.equal(deployed.productionDeployment,false);
  assert.equal(deployed.proposedFlows.length,4);
  assert.equal((await admin.inspect()).rev,deployed.revisionAfter);
  const replay=await admin.deployFactory({
   nodeType:receipt.nodeType,baseRevision:first.rev,
   idempotencyKey:'factory-r03-verified-run'});
  assert.deepEqual(replay,deployed);
  await running.waitForLog('NODE FACTORY R03 VERIFIED',18000);
  await assert.rejects(admin.request('POST','/flows',{
   rev:first.rev,flows:deployed.proposedFlows
  }),e=>e.status===409);
  const restored=await admin.rollbackFactory({ticket:deployed,
   baseRevision:deployed.revisionAfter,idempotencyKey:'factory-r03-rollback'});
  assert.equal(restored.verifiedReadback,true);
  assert.equal(restored.productionRollback,false);
  assert.equal((await admin.inspect()).flows.length,0);
  await assert.rejects(admin.rollbackFactory({ticket:deployed,
   baseRevision:deployed.revisionAfter,idempotencyKey:'factory-r03-other'}),
   /revision_conflict/);
  await running.close();
  // Reopen the very same disposable userDir to prove rollback survived a restart.
  second=spawn(process.execPath,[nodeRedEntrypoint,'--settings',
   join(running.userDir,'settings.js'),'--userDir',running.userDir,
   '--port',String(running.port),'--no-telemetry'],{
   cwd:root,windowsHide:true,stdio:'ignore',
   env:{...process.env,ADAMANTIUM_NODE_SANDBOX_ID:running.sandboxId,
    ADAMANTIUM_NODE_SANDBOX_TOKEN:admin.token}
  });
  let recovered=false;
  for(let i=0;i<200;i++){
   if(second.exitCode!==null)throw new Error('restart_failed');
   try{const after=await admin.inspect();if(after.flows.length===0){
    recovered=true;break;
   }}catch{}
   await delay(150);
  }
  assert.equal(recovered,true,'rollback_not_durable_across_restart');
 }finally{
  if(second&&second.exitCode===null){second.kill('SIGTERM');await delay(400);
   if(second.exitCode===null)second.kill('SIGKILL');}
  if(running)await running.close();
  await rm(root,{recursive:true,force:true,maxRetries:4,retryDelay:100});
 }
});
