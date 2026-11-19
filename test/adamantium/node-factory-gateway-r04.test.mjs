// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import {startGateway} from '../../adamantium/agent-gateway/http.mjs';
import {demoFactoryContract} from '../../adamantium/node-factory/contract.mjs';
const token='isolated-http-test-token-with-32-chars';
const auth={Authorization:'Bearer '+token};
async function post(url,operation,args){
 const response=await fetch(url+'/v1/agent',{method:'POST',
  headers:{...auth,'Content-Type':'application/json'},
  body:JSON.stringify({operation,arguments:args})});
 return {status:response.status,data:await response.json()};
}
test('agent factory HTTP is authenticated, default-deny, and never publishes',async()=>{
 const {server,url}=await startGateway({token,port:0});
 try{
  assert.equal(server.address().address,'127.0.0.1');
  assert.equal((await fetch(url+'/v1/factory')).status,401);
  const template=await post(url,'factory.template',{});
  assert.equal(template.status,200);
  assert.equal(template.data.response.arbitrarySourceAllowed,false);
  const proposed=await post(url,'factory.propose',{
   contract:demoFactoryContract(),base_revision:0,
   idempotency_key:'http-propose-000001'});
  assert.equal(proposed.status,200);
  const id=proposed.data.response.id;
  const catalog=await (await fetch(url+'/v1/factory',{headers:auth})).json();
  assert.equal(catalog.proposals[0].id,id);
  assert.equal(catalog.verifyEnabled,false);
  const verify=await post(url,'factory.verify',{proposal_id:id,base_revision:1,
   idempotency_key:'http-verify-000001'});
  assert.equal(verify.status,403);
  assert.equal(verify.data.error,'factory_verification_disabled');
  for(const op of ['factory.publish','factory.install','factory.deploy']){
   const response=await post(url,op,{});
   assert.equal(response.status,403);
  }
  const csrf=await fetch(url+'/v1/agent',{method:'POST',
   headers:{...auth,'Content-Type':'application/json',
    Origin:'https://unexpected.example'},
   body:JSON.stringify({operation:'factory.template',arguments:{}})});
  assert.equal(csrf.status,403);
  assert.equal((await (await fetch(url+'/v1/graph',{headers:auth})).json()).revision,0);
 }finally{await new Promise(resolve=>server.close(resolve));}
});
test('invalid contract, stale revision, arbitrary arguments and shell denied',async()=>{
 const {server,url}=await startGateway({token,port:0});
 try{
  const bad=await post(url,'factory.propose',{
   contract:{...demoFactoryContract(),source:'require("fs")'},
   base_revision:0,idempotency_key:'http-invalid-00001'});
  assert.equal(bad.status,422);
  const okay=await post(url,'factory.propose',{
   contract:demoFactoryContract(),base_revision:0,
   idempotency_key:'http-valid-00001'});
  assert.equal(okay.status,200);
  const old=await post(url,'factory.propose',{
   contract:{...demoFactoryContract(),id:'other-uppercase'},
   base_revision:0,idempotency_key:'http-stale-00001'});
  assert.equal(old.status,409);
  const arbitrary=await post(url,'factory.verify',{
   proposal_id:okay.data.response.id,base_revision:1,
   idempotency_key:'http-verify-noisy',sandboxRoot:'C:\\production'});
  assert.equal(arbitrary.status,422);
  const shell=await post(url,'factory.shell',{command:'whoami'});
  assert.equal(shell.status,422);
 }finally{await new Promise(resolve=>server.close(resolve));}
});
