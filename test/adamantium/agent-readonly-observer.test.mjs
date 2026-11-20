import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,readFile,stat,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {parseObserverCredentials,requestReadToken,observe,persistObservation,OBSERVER_SNAPSHOT} from "../../adamantium/agent-readonly-observer.mjs";

const credentials="username=ai-observer\npassword="+"x".repeat(54)+"\n";
const graph1={rev:"rev-1",flows:[
 {id:"tabA",type:"tab",label:"Demo"},
 {id:"nodeA",type:"inject",z:"tabA",name:"Source",wires:[["nodeB"]],payload:"NEVERSTORE",credentials:{password:"NEVERSTORE"}},
 {id:"nodeB",type:"debug",z:"tabA",wires:[],secret:"NEVERSTORE"}
]};
function fakeFetch(graph=graph1){
 const calls=[];
 async function impl(url,options){
  calls.push({url,method:options?.method||"GET",headers:options.headers,
   body:options.body});
  if(url.endsWith("/auth/token"))
   return {status:200,json:async()=>({access_token:"t".repeat(64),token_type:"Bearer"})};
  if(url.endsWith("/flows"))
   return {ok:true,status:200,json:async()=>graph};
  throw Error("unexpected URL");
 }
 return {calls,impl};
}
test("strict dedicated credentials reject owner escalation",()=>{
 assert.deepEqual(parseObserverCredentials(credentials),{username:"ai-observer",password:"x".repeat(54)});
 for(const bad of [
  "username=owner\npassword="+"x".repeat(54)+"\n",
  "username=ai-observer\npassword=short\n",
  "username=ai-observer\npassword="+"x".repeat(54)+"\nadmin=true\n",
  "username=ai-observer\r\npassword="+"x".repeat(54)+"\n"
 ])assert.throws(()=>parseObserverCredentials(bad),/malformed/);
});
test("scoped token exchange requests read permission only",async()=>{
 const {calls,impl}=fakeFetch();
 const token=await requestReadToken("http://127.0.0.1:1885/",credentials,{fetchImpl:impl});
 assert.equal(token.length,64);
 assert.equal(calls.length,1);
 assert.equal(calls[0].method,"POST");
 assert.equal(calls[0].url,"http://127.0.0.1:1885/auth/token");
 assert.equal(calls[0].body.get("scope"),"read");
 assert.equal(calls[0].body.get("username"),"ai-observer");
 assert.equal(calls[0].headers["Content-Type"],"application/x-www-form-urlencoded");
});
test("observer uses only auth token POST and graph GET, redacts all flow source",async()=>{
 const {calls,impl}=fakeFetch();
 const snap=await observe("http://127.0.0.1:1885/",credentials,{fetchImpl:impl,now:()=>new Date("2026-11-20T15:00:00.000Z")});
 assert.equal(snap.format,OBSERVER_SNAPSHOT);
 assert.equal(snap.graph.summary.nodes,2);
 assert.equal(snap.graph.summary.outboundEdges,1);
 assert.equal(snap.readonly,true);
 assert.equal(snap.masGranted,false);
 assert.equal(snap.runtimeActivated,false);
 assert.equal(snap.observedAt,"2026-11-20T15:00:00.000Z");
 assert.deepEqual(calls.map(c=>c.method),["POST","GET"]);
 assert.equal(calls[1].headers.Authorization,"Bearer "+"t".repeat(64));
 assert.ok(!JSON.stringify(snap).includes("NEVERSTORE"));
 assert.ok(!JSON.stringify(snap).includes("t".repeat(64)));
 assert.ok(!JSON.stringify(snap).includes("x".repeat(54)));
});
test("observer only compares redacted metadata and does not authorize changed graph",async()=>{
 const initial=await observe("http://127.0.0.1:1885/",credentials,{fetchImpl:fakeFetch().impl});
 const altered={rev:"rev-2",flows:[
  {id:"tabA",type:"tab",label:"Demo"},
  {id:"nodeA",type:"inject",z:"tabA",name:"Source changed",wires:[["nodeB"]],payload:"NEVERSTORE"},
  {id:"nodeB",type:"debug",z:"tabA",wires:[]}
 ]};
 const newer=await observe("http://127.0.0.1:1885/",credentials,{fetchImpl:fakeFetch(altered).impl,previous:initial});
 assert.deepEqual(newer.change.changed,["nodeA"]);
 assert.equal(newer.change.from,"rev-1");
 assert.equal(newer.change.to,"rev-2");
 assert.equal(newer.runtimeActivated,false);
});
test("remote endpoints, denied auth, and stale untrusted previous snapshot fail closed",async()=>{
 const {impl}=fakeFetch();
 await assert.rejects(observe("https://elsewhere.net/",credentials,{fetchImpl:impl}),/loopback/);
 await assert.rejects(observe("http://127.0.0.1:1885/",credentials,{fetchImpl:async()=>({status:403})}),/HTTP 403/);
 await assert.rejects(observe("http://127.0.0.1:1885/",credentials,{fetchImpl:impl,previous:{format:"unknown"}}),/invalid previous/);
});
test("writes atomic private 0600 snapshot without token or source leakage",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"adamantium-ro-observer-"));
 try{
  const snap=await observe("http://127.0.0.1:1885/",credentials,{fetchImpl:fakeFetch().impl});
  const path=join(dir,"snapshot.json");
  await persistObservation(path,snap);
  const mode=(await stat(path)).mode&0o777;
  assert.equal(mode,0o600);
  const body=await readFile(path,"utf8");
  assert.ok(!body.includes("NEVERSTORE"));
  assert.deepEqual(JSON.parse(body).graph.summary,{tabs:1,nodes:2,outboundEdges:1,danglingEdges:0,types:{tab:1,inject:1,debug:1}});
  await assert.rejects(persistObservation("snapshot.json",snap),/absolute/);
  assert.deepEqual((await (await import("node:fs/promises")).readdir(dir)),["snapshot.json"]);
 }finally {await rm(dir,{recursive:true,force:true});}
});
