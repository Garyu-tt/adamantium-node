import test from "node:test";
import assert from "node:assert/strict";
import {validateEndpoint,projection,difference,inspect} from "../../adamantium/ai-graph-inspect.mjs";

const fixture={
  rev:"rev-1",
  flows:[
    {id:"tab_1",type:"tab",label:"Test graph",disabled:false,info:"secret-background"},
    {id:"inject_1",type:"inject",z:"tab_1",name:"input",wires:[["debug_1"]],
      payload:"DO-NOT-EXPOSE",credentials:{password:"SUPERSECRET"}},
    {id:"debug_1",type:"debug",z:"tab_1",name:"output",wires:[],
      complete:"msg.password",source:"private-source-code"}
  ]
};
test("validates strict local-only origin",()=>{
  assert.equal(validateEndpoint("http://127.0.0.1:1885/"),"http://127.0.0.1:1885");
  for(const u of ["https://example.com/","http://10.0.0.1/","file:///etc/passwd",
    "http://user:password@127.0.0.1:1885/","http://127.0.0.1:1885/flows",
    "http://127.0.0.1:1885/?x=1","http://127.0.0.1:1885/#anything"]) {
    assert.throws(()=>validateEndpoint(u),/Only explicit loopback/);
  }
});
test("returns redacted typed read-only projection",()=>{
  const result=projection(fixture),text=JSON.stringify(result);
  assert.equal(result.revision,"rev-1");
  assert.deepEqual({...result.summary,types:{...result.summary.types}},{tabs:1,nodes:2,outboundEdges:1,danglingEdges:0,types:{tab:1,inject:1,debug:1}});
  assert.deepEqual(result.edges,[{from:"inject_1",output:0,to:"debug_1"}]);
  assert.equal(result.nodes[0].name,"input");
  assert.ok(!text.includes("SUPERSECRET"));
  assert.ok(!text.includes("DO-NOT-EXPOSE"));
  assert.ok(!text.includes("private-source-code"));
  assert.equal(result.authorizationGranted,false);
  assert.equal(result.liveExecutionConfirmed,false);
  assert.equal(result.trustedGraphIR,false);
});
test("reports dangling wires and detects rewiring without exposing payloads",()=>{
  const before=projection(fixture);
  const moved=projection({rev:"rev-rewired",flows:fixture.flows.map(n=>
    n.id==="inject_1"?{...n,wires:[["extra_missing"]]}:n
  )});
  assert.equal(moved.summary.danglingEdges,1);
  const delta=difference(before,moved);
  assert.deepEqual(delta.removedEdges,["inject_1:0->debug_1"]);
  assert.deepEqual(delta.addedEdges,["inject_1:0->extra_missing"]);
  assert.ok(!JSON.stringify(delta).includes("SUPERSECRET"));
});
test("rejects ambiguous node identities and unexpected v2 shape",()=>{
  assert.throws(()=>projection({flows:[]}),/Invalid/);
  assert.throws(()=>projection({rev:"1",flows:[{id:"same",type:"tab"},{id:"same",type:"debug"}]}),/duplicate/);
  assert.throws(()=>projection({rev:"1",flows:[{id:"bad/id",type:"tab"}]}),/Malformed/);
});
test("metadata-only changes do not claim config diff coverage",()=>{
  const before=projection(fixture);
  const after=projection({rev:"rev-2",flows:[
    fixture.flows[0],
    {...fixture.flows[1],name:"new input",payload:"different-secret"},
    {id:"extra",type:"debug",z:"tab_1",wires:[]}
  ]});
  assert.deepEqual(difference(before,after).added,["extra"]);
  assert.deepEqual(difference(before,after).removed,["debug_1"]);
  assert.deepEqual(difference(before,after).changed,["inject_1"]);
  const configOnly=projection({rev:"rev-3",flows:fixture.flows.map(x=>({...x,payload:"CHANGED"}))});
  assert.deepEqual(difference(before,configOnly).changed,[]);
});
test("rejects unauthenticated access unless lab flag is explicit",async()=>{
  let called=false;
  await assert.rejects(inspect("http://127.0.0.1:1885","",{fetchImpl:()=>{called=true;}}),/Missing token/);
  assert.equal(called,false);
});
test("uses GET only, explicit v2, denies redirects, accepts authorized responses",async()=>{
  const observed=[];
  const fetchImpl=async(url,opts)=>{
    observed.push({url,opts});
    return {ok:true,status:200,json:async()=>fixture};
  };
  const r=await inspect("http://127.0.0.1:1885/","operator-token",{fetchImpl});
  assert.equal(r.summary.nodes,2);
  assert.equal(observed.length,1);
  assert.equal(observed[0].url,"http://127.0.0.1:1885/flows");
  assert.equal(observed[0].opts.method,"GET");
  assert.equal(observed[0].opts.redirect,"error");
  assert.equal(observed[0].opts.headers.Authorization,"Bearer operator-token");
  assert.equal(observed[0].opts.headers["Node-RED-API-Version"],"v2");
});
test("explicit unauthenticated lab mode still forbids remote endpoints",async()=>{
  const fetchImpl=async()=>({ok:true,status:200,json:async()=>fixture});
  await assert.rejects(inspect("http://192.168.1.10:1885/","",{fetchImpl,allowUnauthenticatedLab:true}),/loopback/);
  const r=await inspect("http://127.0.0.1:1885/","",{fetchImpl,allowUnauthenticatedLab:true});
  assert.equal(r.summary.tabs,1);
});
test("HTTP refusal includes status and does not expose response body",async()=>{
  await assert.rejects(inspect("http://127.0.0.1:1885/","token",{fetchImpl:async()=>({ok:false,status:401,body:"private"})}),/HTTP 401/);
});
