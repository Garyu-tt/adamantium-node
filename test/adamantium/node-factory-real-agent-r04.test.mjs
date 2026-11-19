// SPDX-License-Identifier: Apache-2.0
// Real on-host agent HTTP -> generated package -> disposable Node-RED 5 -> rollback.
import test from 'node:test';
import assert from 'node:assert/strict';
import {startGateway} from '../../adamantium/agent-gateway/http.mjs';
import {demoFactoryContract} from '../../adamantium/node-factory/contract.mjs';
const token='r04-test-ephemeral-local-only-token';
async function post(url,operation,args){
 const r=await fetch(url+'/v1/agent',{
  method:'POST',headers:{Authorization:'Bearer '+token,
   'Content-Type':'application/json'},
  body:JSON.stringify({operation,arguments:args}),
  signal:AbortSignal.timeout(110000)
 });
 return {status:r.status,body:await r.json()};
}
test('R04 genuine agent-issued contract builds, executes, rolls back, cleans sandbox',
 {timeout:160000},async()=>{
 const {server,url}=await startGateway({token,port:0,factoryVerify:true});
 try{
  const catalog=await post(url,'factory.template',{});
  assert.equal(catalog.status,200);
  assert.deepEqual(catalog.body.response.transforms,['uppercase','suffix']);
  const proposal=await post(url,'factory.propose',{
   contract:demoFactoryContract(),base_revision:0,
   idempotency_key:'r04-real-propose-001'
  });
  assert.equal(proposal.status,200);
  assert.equal(proposal.body.response.status,'proposed');
  const proposal_id=proposal.body.response.id;
  const verification=await post(url,'factory.verify',{
   proposal_id,base_revision:1,idempotency_key:'r04-real-verify-001'
  });
  assert.equal(verification.status,200,JSON.stringify(verification.body));
  const report=verification.body.response.receipt.verifiedReport;
  assert.equal(report.actualNodeRedExecution,true);
  assert.equal(report.installedBytesVerified,true);
  assert.equal(report.registeredInTestPalette,true);
  assert.equal(report.rollbackVerified,true);
  assert.equal(report.sandboxDestroyed,true);
  assert.equal(report.productionDeployment,false);
  assert.equal(report.productionPublication,false);
  assert.equal(report.signed,false);
  assert.equal(verification.body.response.receipt.needsIndependentMASApproval,true);
  const checked=await (await fetch(url+'/v1/factory',{headers:{
   Authorization:'Bearer '+token
  }})).json();
  assert.equal(checked.proposals[0].status,'verified');
  assert.equal(checked.revision,2);
  assert.equal(checked.busy,false);
  const repeated=await post(url,'factory.verify',{
   proposal_id,base_revision:1,idempotency_key:'r04-real-verify-001'
  });
  assert.equal(repeated.status,200);
  assert.deepEqual(repeated.body.response,verification.body.response);
  assert.equal(checked.attemptsRemaining,2);
 }finally{await new Promise(resolve=>server.close(resolve));}
});
