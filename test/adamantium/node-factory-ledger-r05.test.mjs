// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {DurableFactoryLedger,FACTORY_LEDGER_GENESIS,factoryDigest} from '../../adamantium/node-factory/durable-ledger.mjs';
import {DurableFactoryWorkflow} from '../../adamantium/node-factory/durable-workflow.mjs';
import {renderNodePackage} from '../../adamantium/node-factory/generate.mjs';
import {demoFactoryContract} from '../../adamantium/node-factory/contract.mjs';

const setup=async options=>{
 const parent=await mkdtemp(join(tmpdir(),'mechanicus-r05-ledger-'));
 const root=join(parent,'ledger');
 const workflow=await DurableFactoryWorkflow.create(root,options);
 return {parent,root,workflow};
};
function mockProof(contract){
 const rendered=renderNodePackage(contract);
 return {schema:'adamantium.factory.verification/1',
  nodeType:rendered.nodeType,packageName:rendered.packageName,
  artifactHashes:rendered.sha256,installedBytesVerified:true,
  actualNodeRedExecution:true,registeredInTestPalette:true,
  expectedOutputObserved:true,rollbackVerified:true,
  sandboxDestroyed:true,productionDeployment:false,
  productionPublication:false,authorizedForLifecycle:false,signed:false};
}
test('real fsync journal proposals survive reopen; verify and promotion are advisory',async()=>{
 const x=await setup({runner:async c=>mockProof(c)});
 try{
  const beginning=await x.workflow.inspect();
  assert.equal(beginning.sequence,0);
  assert.equal(beginning.head,FACTORY_LEDGER_GENESIS);
  const first=await x.workflow.propose({
   contract:demoFactoryContract(),
   expectedSequence:0,expectedHead:FACTORY_LEDGER_GENESIS
  });
  assert.equal(first.sequence,1);
  assert.match(first.proposalId,/^candidate-/);
  assert.equal(first.graphPreview.schema,'mechanicus.universal-graph/1');
  assert.equal(first.graphPreview.nodes.length,4);
  const opened=await DurableFactoryWorkflow.open(x.root,{runner:async c=>mockProof(c)});
  assert.equal((await opened.inspect()).sequence,1);
  assert.equal((await opened.inspect()).proposals[first.proposalId].status,'proposed');
  const proof=await opened.verify({
   proposalId:first.proposalId,expectedSequence:1,expectedHead:first.head
  });
  assert.equal(proof.sequence,2);
  const afterProof=await opened.inspect();
  assert.equal(afterProof.proposals[first.proposalId].status,'verified');
  assert.equal(afterProof.proposals[first.proposalId].authorized,false);
  assert.equal(afterProof.authorizationEffective,false);
  assert.equal(afterProof.proposals[first.proposalId].proof.sandboxDestroyed,true);
  const approval=await opened.requestPromotion({
   proposalId:first.proposalId,expectedSequence:2,expectedHead:proof.head
  });
  assert.equal(approval.sequence,3);
  assert.equal(approval.approvalGranted,false);
  const reopened=await DurableFactoryWorkflow.open(x.root,{
   trustedSequence:2,trustedHead:proof.head
  });
  const final=await reopened.inspect({trustedSequence:2,trustedHead:proof.head});
  assert.equal(final.sequence,3);
  assert.equal(final.proposals[first.proposalId].promotionRequested,true);
  assert.equal(final.productionInstalled,false);
  assert.equal(final.authorizationEffective,false);
  assert.equal(final.independentlyWitnessed,false);
  assert.equal((await readFile(join(x.root,'view.json'),'utf8')).includes(final.head),true);
  const repeated=await reopened.propose({
   contract:demoFactoryContract(),expectedSequence:0,expectedHead:FACTORY_LEDGER_GENESIS
  });
  assert.equal(repeated.replayed,true);
  assert.equal((await reopened.inspect()).sequence,3);
 }finally{await rm(x.parent,{recursive:true,force:true});}
});
test('stale revisions and nonempty roots rejected without overwrite',async()=>{
 const x=await setup();
 try{
  await assert.rejects(DurableFactoryLedger.create(x.root),/EEXIST/);
  await assert.rejects(x.workflow.propose({
   contract:demoFactoryContract(),expectedSequence:1,expectedHead:FACTORY_LEDGER_GENESIS
  }),/revision_conflict/);
  assert.equal((await x.workflow.inspect()).sequence,0);
 }finally{await rm(x.parent,{recursive:true,force:true});}
});
test('journal detects a mutated line and a fully truncated history when external head pinned',async()=>{
 const x=await setup();
 try{
  const a=await x.workflow.propose({
   contract:demoFactoryContract(),expectedSequence:0,expectedHead:FACTORY_LEDGER_GENESIS
  });
  const file=join(x.root,'journal.jsonl');
  const original=await readFile(file,'utf8');
  await writeFile(file,original.replace('factory.proposed','factory.rejected'));
  await assert.rejects(DurableFactoryLedger.open(x.root),/journal_integrity_failed|invalid_factory_rejection_event/);
  await writeFile(file,'');
  await assert.rejects(DurableFactoryLedger.open(x.root,{
   trustedSequence:a.sequence,trustedHead:a.head
  }),/journal_independent_head_mismatch/);
  const unpinned=await DurableFactoryLedger.open(x.root);
  assert.equal((await unpinned.inspect()).sequence,0);
  // Not claimed resistant to complete-history rollback without external pin.
 }finally{await rm(x.parent,{recursive:true,force:true});}
});
test('torn tail never silently repaired or accepted',async()=>{
 const x=await setup();
 try{
  await writeFile(join(x.root,'journal.jsonl'),'{');
  await assert.rejects(x.workflow.inspect(),/torn_journal_tail/);
 }finally{await rm(x.parent,{recursive:true,force:true});}
});
test('writer lock rejects overlapping mutation and never autodeletes unowned lock',async()=>{
 const x=await setup();
 try{
  await writeFile(join(x.root,'writer.lock'),'other-worker');
  await assert.rejects(x.workflow.propose({
   contract:demoFactoryContract(),expectedSequence:0,expectedHead:FACTORY_LEDGER_GENESIS
  }),/factory_writer_busy/);
  assert.equal(await readFile(join(x.root,'writer.lock'),'utf8'),'other-worker');
 }finally{await rm(x.parent,{recursive:true,force:true});}
});
test('forged fake proof does not create a verification event',async()=>{
 const x=await setup({runner:async c=>({...mockProof(c),sandboxDestroyed:false})});
 try{
  const a=await x.workflow.propose({
   contract:demoFactoryContract(),expectedSequence:0,expectedHead:FACTORY_LEDGER_GENESIS
  });
  await assert.rejects(x.workflow.verify({
   proposalId:a.proposalId,expectedSequence:1,expectedHead:a.head
  }),/factory_verification_proof_invalid/);
  const after=await x.workflow.inspect();
  assert.equal(after.sequence,1);
  assert.equal(after.proposals[a.proposalId].status,'proposed');
  await assert.rejects(x.workflow.requestPromotion({
   proposalId:a.proposalId,expectedSequence:1,expectedHead:a.head
  }),/promotion_requires_verified_proof/);
 }finally{await rm(x.parent,{recursive:true,force:true});}
});
test('G0 preview is structural only, no publish, no execution grant',async()=>{
 const x=await setup();
 try{
  const a=await x.workflow.propose({
   contract:demoFactoryContract(),expectedSequence:0,expectedHead:FACTORY_LEDGER_GENESIS
  });
  const p=await x.workflow.preview(a.proposalId);
  assert.equal(p.graph.domain,'program');
  assert.equal(p.graph.schemaVersion,1);
  assert.equal(p.graph.edges.length,3);
  for(const n of p.graph.nodes){
   assert.equal(n.graphRef,'');assert.equal(n.graphRefRevision,0);
   assert.equal(n.kind,'capability');
   assert.match(n.typeRef,/@1$/);
  }
  assert.equal(p.executionAuthorized,false);
  assert.equal(p.validatedWithNativeG0Compiler,false);
  assert.equal(p.productionInstalled,false);
  assert.equal(factoryDigest(JSON.stringify(p.graph)).startsWith('sha256:'),true);
 }finally{await rm(x.parent,{recursive:true,force:true});}
});
