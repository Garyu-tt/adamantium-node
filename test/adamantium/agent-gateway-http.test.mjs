// SPDX-License-Identifier: Apache-2.0
import test from "node:test";
import assert from "node:assert/strict";
import {startGateway} from "../../adamantium/agent-gateway/http.mjs";

const token="local-test-token-not-for-production-123456789";
async function request(url,body,headers={}){
  const res=await fetch(url+"/v1/agent",{method:"POST",
    headers:{"Authorization":"Bearer "+token,"Content-Type":"application/json",...headers},
    body:JSON.stringify(body)});
  return {status:res.status,json:await res.json()};
}
test("isolated HTTP gateway executes full safe graph API with token and 409 CAS",async()=>{
  const {server,url}=await startGateway({token,port:0,sandbox:true});
  try{
    assert.equal(server.address().address,"127.0.0.1");
    const ready=await (await fetch(url+"/health")).json();
    assert.equal(ready.nodeRedConnected,false);
    assert.equal((await fetch(url+"/v1/graph")).status,401);
    const payload={operation:"graph.bootstrap",arguments:{
      text:"Собери тестовый граф",base_revision:0,idempotency_key:"http-graph-00001"}};
    let response=await request(url,payload);
    assert.equal(response.status,200);
    assert.equal(response.json.response.test.passed,true);
    response=await request(url,payload);
    assert.equal(response.json.response.patch.revision,1);
    assert.equal((await (await fetch(url+"/v1/graph",{
      headers:{"Authorization":"Bearer "+token}})).json()).revision,1);
    const importResponse=await fetch(url+"/v1/node-red/import",{
      headers:{"Authorization":"Bearer "+token}});
    assert.equal(importResponse.status,200);
    const imported=await importResponse.json();
    assert.equal(imported.nodes[0].disabled,true);
    const deployed=await request(url,{operation:"graph.deploy",arguments:{
      base_revision:1,idempotency_key:"http-deploy-0001"}});
    assert.equal(deployed.status,200);
    assert.equal(deployed.json.response.nodeRedRuntimeStarted,false);
    const conflict=await request(url,{operation:"graph.patch",arguments:{
      graph:payload.arguments.graph,base_revision:0,idempotency_key:"http-stale-0001"}});
    assert.equal(conflict.status,409);
  }finally{await new Promise(resolve=>server.close(resolve));}
});
test("cross-origin browser mutation and missing token are rejected",async()=>{
  const {server,url}=await startGateway({token,port:0});
  try{
    const payload={operation:"graph.inspect",arguments:{}};
    const csrf=await request(url,payload,{"Origin":"https://evil.example"});
    assert.equal(csrf.status,403);
    const noToken=await fetch(url+"/v1/agent",{method:"POST",
      headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
    assert.equal(noToken.status,401);
    const arbitrary=await request(url,{operation:"shell.run",
      arguments:{command:"whoami"}});
    assert.equal(arbitrary.status,422);
    const active=await request(url,{operation:"graph.deploy",
      arguments:{base_revision:0,idempotency_key:"unauth-deploy-001"}});
    assert.equal(active.status,403);
  }finally{await new Promise(resolve=>server.close(resolve));}
});
test("server requires a real token before exposing any mutation endpoint",async()=>{
  await assert.rejects(startGateway({token:"short",port:0}),
    /explicit_server_token_required/);
});
