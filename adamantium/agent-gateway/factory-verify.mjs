// SPDX-License-Identifier: Apache-2.0
// R04: real Node-RED execution only inside a disposable, pinned sandbox.
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {rm} from 'node:fs/promises';
import {startFactorySandbox} from '../node-red-adapter/sandbox-runtime.mjs';
import {fail} from './factory-catalog.mjs';

export async function verifyIsolatedFactory(contract){
 const root=join(tmpdir(),'adamantium-agent-factory-r04-'+randomUUID());
 let running,deployed,restored=false;
 try{
  running=await startFactorySandbox({root,contract});
  const {admin,receipt}=running;
  if(receipt.verifiedInstalledFiles!==true||receipt.registeredInProduction!==false)
   fail('untrusted_factory_install');
  const previous=await admin.inspect();
  if(previous.flows.length!==0)fail('unexpected_nonempty_sandbox');
  const deployment=await admin.deployFactory({
   nodeType:receipt.nodeType,baseRevision:previous.rev,
   idempotencyKey:'r04.deploy.'+randomUUID()
  });
  deployed=deployment;
  if(!deployment.verifiedReadback||deployment.productionDeployment!==false)
   fail('unverified_sandbox_deployment');
  const input='node factory r03 verified';
  const expected=contract.transform==='uppercase'?
   input.toUpperCase():input+contract.suffix;
  await running.waitForLog(expected,20000);
  const rollback=await admin.rollbackFactory({
   ticket:deployment,baseRevision:deployment.revisionAfter,
   idempotencyKey:'r04.rollback.'+randomUUID()
  });
  if(!rollback.verifiedReadback||rollback.productionRollback!==false)
   fail('unverified_sandbox_rollback');
  const state=await admin.inspect();
  if(state.rev!==rollback.to||state.flows.length!==0)
   fail('rollback_readback_mismatch');
  restored=true;
  return {
   schema:'adamantium.factory.verification/1',
   packageName:receipt.packageName,nodeType:receipt.nodeType,
   artifactHashes:receipt.artifactHashes,
   registeredInTestPalette:true,installedBytesVerified:true,
   actualNodeRedExecution:true,expectedOutputObserved:true,
   revisionBefore:deployment.revisionBefore,
   revisionAfter:deployment.revisionAfter,
   rollbackRevision:rollback.to,rollbackVerified:true,
   productionDeployment:false,productionPublication:false,
   durableAcrossRestart:false,sandboxDestroyed:false,
   signed:false,authorizedForLifecycle:false
  };
 }finally{
  if(running){
   // Any unresolved state is abandoned with the disposable process only.
   // Never retry a network mutation blindly or redirect to the operator profile.
   await running.close();
  }
  await rm(root,{recursive:true,force:true,maxRetries:4,retryDelay:100});
  if(deployed&&!restored){
   // No success receipt can escape a failed or ambiguous rollback.
  }
 }
}
