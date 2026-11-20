import test from "node:test";
import assert from "node:assert/strict";
import {BUILTINS} from "../../adamantium/construct-native/core.mjs";
import {RevisionedGraphKernel,TX_FORMAT} from "../../adamantium/construct-native/graph-tx.mjs";
const start=()=>structuredClone(BUILTINS[0].blueprint);
const changed=()=>{
 const bp=start();
 bp.nodes[1].name="Inspect v2";
 return bp;
};
const kernel=async(authorize=async()=>true)=>RevisionedGraphKernel.create({
 flowId:"20a17e4b296fa1f5",blueprint:start(),authorize});
const proposal=async(k,id="r05_a",author="coder")=>{
 const p=await k.submit({proposalId:id,author,expectedRevision:k.activeRevision,
   blueprint:changed(),reason:"Switch diagnostic name"});
 return p;
};
const qa=(k,id="r05_a")=>{
 k.review(id,{reviewer:"peer_qa",decision:"approve"});
 return k.review(id,{reviewer:"peer_safety",decision:"approve"});
};
test("R05 is a revisioned, CPU-only in-process graph kernel",async()=>{
 const k=await kernel();
 assert.equal(k.status().format,TX_FORMAT);
 assert.equal(k.status().activeRevision,1);
 assert.equal(k.snapshot().blueprint.nodes.length,2);
 const p=await proposal(k);assert.equal(p.status,"proposed");
 assert.equal(p.diff.modified.length,1);
 assert.deepEqual(p.diff.added,[]);
 assert.equal(k.handoff("r05_a").requestedAction,"review_only");
});
test("default deny does not permit commit even after two independent approvals",async()=>{
 const k=await kernel(undefined);
 // undefined argument gets default authorizer in this helper; test real default directly.
 const deny=await RevisionedGraphKernel.create({flowId:"f1",blueprint:start()});
 const p=await proposal(deny);
 qa(deny);
 await assert.rejects(()=>deny.commit({proposalId:p.id,expectedRevision:1,expectedDigest:p.digest}),/capability denied/);
 assert.equal(deny.status().activeRevision,1);
 assert.equal(deny.status().locked,false);
});
test("author cannot review; duplicate reviewers rejected; reject veto is terminal",async()=>{
 const k=await kernel();
 await proposal(k);
 assert.throws(()=>k.review("r05_a",{reviewer:"coder",decision:"approve"}),/author cannot/);
 k.review("r05_a",{reviewer:"peer_qa",decision:"approve"});
 assert.throws(()=>k.review("r05_a",{reviewer:"peer_qa",decision:"approve"}),/duplicate reviewer/);
 k.review("r05_a",{reviewer:"peer_safety",decision:"reject"});
 assert.equal(k.describe("r05_a").status,"rejected");
 await assert.rejects(()=>k.commit({proposalId:"r05_a",expectedRevision:1,expectedDigest:k.describe("r05_a").digest}),/quorum/);
});
test("2 QA approvals plus authorization flips atomically and writes receipt",async()=>{
 const authCalls=[];
 const k=await kernel(async x=>{authCalls.push(x);return x.op==="commit";});
 const p=await proposal(k);qa(k);
 const receipt=await k.commit({proposalId:p.id,expectedRevision:1,expectedDigest:p.digest});
 assert.equal(k.status().activeRevision,2);
 assert.equal(receipt.operation,"commit");
 assert.equal(receipt.from,1);
 assert.equal(receipt.to,2);
 assert.equal(k.snapshot(1).blueprint.nodes[1].name,"Inspect");
 assert.equal(k.snapshot(2).blueprint.nodes[1].name,"Inspect v2");
 assert.equal(authCalls.length,1);
 assert.equal(authCalls[0].flowId,"20a17e4b296fa1f5");
});
test("event started on old revision completes there while new tickets use new revision",async()=>{
 const k=await kernel();
 const a=k.beginEvent({entryId:"builtin_src",value:{request:42}});
 let step=k.advance(a.ticket,1);
 assert.equal(step.done,false);
 assert.equal(step.revision,1);
 const p=await proposal(k);qa(k);
 await k.commit({proposalId:p.id,expectedRevision:1,expectedDigest:p.digest});
 const b=k.beginEvent({entryId:"builtin_src",value:{request:43}});
 const old=k.advance(a.ticket,10),recent=k.advance(b.ticket,10);
 assert.equal(old.done,true);
 assert.equal(recent.done,true);
 assert.equal(old.revision,1);
 assert.equal(recent.revision,2);
 assert.deepEqual(old.debug,[{nodeId:"builtin_sink",value:{request:42}}]);
 assert.deepEqual(recent.debug,[{nodeId:"builtin_sink",value:{request:43}}]);
 assert.equal(k.status().inFlight,0);
});
test("rollback changes only active pointer and maintains in-flight graph snapshots",async()=>{
 const k=await kernel();
 const p=await proposal(k);qa(k);
 await k.commit({proposalId:p.id,expectedRevision:1,expectedDigest:p.digest});
 const flight=k.beginEvent({entryId:"builtin_src",value:"during revision 2"});
 const receipt=await k.rollback({expectedRevision:2,targetRevision:1,reason:"Canary unexpected behavior"});
 assert.equal(receipt.operation,"rollback");
 assert.equal(k.status().activeRevision,1);
 const newer=k.beginEvent({entryId:"builtin_src",value:"after rollback"});
 assert.equal(k.advance(flight.ticket,10).revision,2);
 assert.equal(k.advance(newer.ticket,10).revision,1);
});
test("commits after rollback use monotonically new revision numbers, preserving history",async()=>{
 const k=await kernel();
 let p=await proposal(k);qa(k);
 await k.commit({proposalId:p.id,expectedRevision:1,expectedDigest:p.digest});
 await k.rollback({expectedRevision:2,targetRevision:1,reason:"Test rollback"});
 p=await k.submit({proposalId:"r05_b",author:"newcoder",expectedRevision:1,
   blueprint:changed(),reason:"Second attempt"});
 qa(k,"r05_b");
 const applied=await k.commit({proposalId:p.id,expectedRevision:1,expectedDigest:p.digest});
 assert.equal(applied.to,3);
 assert.equal(k.status().activeRevision,3);
 assert.equal(k.snapshot(2).revision,2);
 assert.equal(k.snapshot(3).revision,3);
});
test("CAS conflicts, digest mismatch and stale peer proposals never apply",async()=>{
 const k=await kernel();
 const p1=await proposal(k,"p1");
 const p2=await proposal(k,"p2","coder2");
 qa(k,"p1");
 qa(k,"p2");
 await assert.rejects(()=>k.commit({proposalId:"p1",expectedRevision:1,expectedDigest:"wrong"}),/digest mismatch/);
 await k.commit({proposalId:"p1",expectedRevision:1,expectedDigest:p1.digest});
 await assert.rejects(()=>k.commit({proposalId:"p2",expectedRevision:1,expectedDigest:p2.digest}),/CAS conflict/);
 await assert.rejects(()=>k.rollback({expectedRevision:1,targetRevision:1,reason:"Rollback now"}),/CAS conflict/);
});
test("parallel commits serialize via an exclusive in-process transaction lock",async()=>{
 let release;
 const barrier=new Promise(resolve=>release=resolve);
 const k=await kernel(async()=>{await barrier;return true;});
 const p=await proposal(k);qa(k);
 const ongoing=k.commit({proposalId:p.id,expectedRevision:1,expectedDigest:p.digest});
 await Promise.resolve();
 await assert.rejects(()=>k.commit({proposalId:p.id,expectedRevision:1,expectedDigest:p.digest}),/in progress/);
 assert.equal(k.status().activeRevision,1);
 release();await ongoing;
 assert.equal(k.status().activeRevision,2);
 assert.equal(k.status().locked,false);
});
test("if capability denies or authorization throws, lock is released and no graph changes",async()=>{
 let calls=0;
 const k=await kernel(async()=>{calls++;if(calls===1)throw Error("provider offline");return false;});
 const p=await proposal(k);qa(k);
 await assert.rejects(()=>k.commit({proposalId:p.id,expectedRevision:1,expectedDigest:p.digest}),/provider offline/);
 assert.equal(k.status().locked,false);
 await assert.rejects(()=>k.commit({proposalId:p.id,expectedRevision:1,expectedDigest:p.digest}),/capability denied/);
 assert.equal(k.status().activeRevision,1);
});
test("Graph Manager 0.1 read-only capability projection can never authorize mutation",async()=>{
 const k=await kernel();
 const readonly=k.inspectGraphManagerSnapshot({
  app:"graph_manager",version:1,nodes:[{
   id:"graph_manager.view",type:"view",requires:["graph_manager.read"]
  }],edges:[]});
 assert.equal(readonly.readable,true);
 assert.equal(readonly.canCommit,false);
 assert.equal(readonly.canRollback,false);
 assert.equal(readonly.mode,"read_only");
 assert.throws(()=>k.inspectGraphManagerSnapshot({nodes:new Array(251).fill({}),edges:[]}),/budget/);
});
test("unknown graph code is rejected before staging or running",async()=>{
 const k=await kernel();
 const dangerous=start();
 dangerous.nodes[0].type="exec";
 await assert.rejects(()=>k.submit({proposalId:"unsafe",author:"coder",expectedRevision:1,
   blueprint:dangerous,reason:"unsafe"}),/unsupported native node type/);
 const invalid=start();invalid.nodes[0].wires=[["missing_sink"]];
 await assert.rejects(()=>k.submit({proposalId:"escaped",author:"coder",expectedRevision:1,
   blueprint:invalid,reason:"unsafe"}),/wire escapes/);
 assert.equal(k.status().proposals,0);
});
test("too many in-flight events are bounded and debug never triggers side-effects",async()=>{
 const k=await kernel();
 const tickets=[];
 for(let i=0;i<32;i++)tickets.push(k.beginEvent({entryId:"builtin_src",value:{i}}).ticket);
 assert.throws(()=>k.beginEvent({entryId:"builtin_src",value:{x:1}}),/in-flight event budget/);
 for(const ticket of tickets){
  const out=k.advance(ticket,32);
  assert.equal(out.done,true);assert.equal(out.debug.length,1);
 }
 assert.equal(k.status().inFlight,0);
});
test("read-only handoff has no credentials, source code or ambient authorization",async()=>{
 const k=await kernel();const p=await proposal(k);
 const data=k.handoff(p.id);
 assert.equal(data.noExecution,true);
 assert.equal(data.baseRevision,1);
 assert.equal(data.digest,p.digest);
 assert.equal(JSON.stringify(data).includes("operatorToken"),false);
 assert.equal(JSON.stringify(data).includes("blueprint"),false);
});
