import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {
 VAULT_FORMAT,emptyVault,sealPackage,verifyPackage,validateVault,putPackage,
 importVault,planConstruction,compileConstruction,exportVault,ConstructionQueue
} from "../../adamantium/construct-native/vault.mjs";
import {BUILTINS} from "../../adamantium/construct-native/core.mjs";
const pack=(id="pair",version=1,more={})=>({
 id,version,title:id.toUpperCase(),sourceAccess:"closed",distribution:"free",
 publicListing:false,dependencies:[],blueprint:BUILTINS[0].blueprint,...more
});
const add=async(v,entry)=>putPackage(v,entry,{expectedRevision:v.revision});
test("content addressed SHA-256 and normalized versioned vault",async()=>{
 let vault=emptyVault();
 assert.equal(vault.format,VAULT_FORMAT);
 const entry=await sealPackage(pack());
 assert.match(entry.digest,/^sha256:[0-9a-f]{64}$/);
 assert.deepEqual(await verifyPackage(entry),entry);
 await assert.rejects(()=>verifyPackage({...entry,title:"MUTATED"}),/integrity failure/);
 vault=await add(vault,pack());
 assert.equal(vault.revision,1);
 assert.deepEqual(await validateVault(JSON.parse(JSON.stringify(vault))),vault);
});
test("immutable versions, monotonically increasing versions, and CAS",async()=>{
 let v=await add(emptyVault(),pack("shared",1));
 await assert.rejects(()=>add(v,pack("shared",1)),/already immutable/);
 await assert.rejects(()=>add(v,pack("shared",3,{sourceAccess:"secret"})),/visibility/);
 await assert.rejects(()=>putPackage(v,pack("shared",2),{expectedRevision:0}),/stale vault/);
 v=await add(v,pack("shared",2,{distribution:"paid"}));
 assert.equal(v.entries.length,2);
 await assert.rejects(()=>add(v,pack("shared",1)),/already immutable/);
 assert.equal(v.entries[1].distribution,"paid");
});
test("dependency resolution deduplicates shared dependencies and plans deterministic topological order",async()=>{
 let v=emptyVault();
 v=await add(v,pack("base"));
 v=await add(v,pack("a",1,{dependencies:[{id:"base",version:1}]}));
 v=await add(v,pack("b",1,{dependencies:[{id:"base",version:1}]}));
 const plan=await planConstruction(v,[{id:"a",version:1},{id:"b",version:1}]);
 assert.deepEqual(plan.steps.map(x=>x.id),["base","a","b"]);
 assert.equal(plan.totals.nodes,6);
 assert.equal(plan.totals.packages,3);
 assert.match(plan.planId,/^sha256:[0-9a-f]{64}$/);
 const plan2=await planConstruction(v,[{id:"a",version:1},{id:"b",version:1}]);
 assert.deepEqual(plan2,plan);
 const built=await compileConstruction(v,plan,"20a17e4b296fa1f5");
 assert.equal(built.length,6);
 assert.equal(new Set(built.map(n=>n.id)).size,6);
 assert.ok(built.every(n=>n.z==="20a17e4b296fa1f5"));
 assert.deepEqual(built.slice(0,2).map(n=>n.type),["inject","debug"]);
 const allIds=new Set(built.map(n=>n.id));
 for(const n of built)for(const output of n.wires)for(const id of output)assert.ok(allIds.has(id));
 assert.equal(built.filter(n=>n.type==="inject").length,3);
});
test("fail closed on missing, cyclic dependencies, oversized request or stale plan",async()=>{
 let v=await add(emptyVault(),pack("missing_parent",1,{dependencies:[{id:"absent",version:1}]}));
 await assert.rejects(()=>planConstruction(v,[{id:"missing_parent",version:1}]),/unresolved dependency/);
 v=emptyVault();
 v=await add(v,pack("cycle_a",1,{dependencies:[{id:"cycle_b",version:1}]}));
 v=await add(v,pack("cycle_b",1,{dependencies:[{id:"cycle_a",version:1}]}));
 await assert.rejects(()=>planConstruction(v,[{id:"cycle_a",version:1}]),/dependency cycle/);
 let small=await add(emptyVault(),pack("base"));
 await assert.rejects(()=>planConstruction(small,[{id:"base",version:1}],{maxNodes:1}),/node quota/);
 await assert.rejects(()=>planConstruction(small,[{id:"base",version:1}],{maxUnits:1}),/unit quota/);
 const plan=await planConstruction(small,[{id:"base",version:1}]);
 small=await add(small,pack("other"));
 await assert.rejects(()=>compileConstruction(small,plan,"f1"),/stale construction plan/);
});
test("public export cannot reveal closed projects or transitive private dependencies",async()=>{
 let v=emptyVault();
 v=await add(v,pack("private",1,{sourceAccess:"closed",distribution:"paid",publicListing:false}));
 v=await add(v,pack("bridge",1,{sourceAccess:"open",distribution:"free",publicListing:true,
   dependencies:[{id:"private",version:1}]}));
 v=await add(v,pack("public",1,{sourceAccess:"open",distribution:"paid",publicListing:true,
   dependencies:[{id:"bridge",version:1}]}));
 v=await add(v,pack("hello",1,{sourceAccess:"open",distribution:"paid",publicListing:true}));
 await assert.rejects(()=>add(v,pack("closed_pub",1,{sourceAccess:"closed",publicListing:true})),/closed source/);
 const e=await exportVault(v);
 assert.deepEqual(e.entries.map(x=>x.id),["hello"]);
 assert.equal(e.entries[0].distribution,"paid","paid/open software may be public only when explicitly approved");
 assert.equal((await exportVault(v,{publicOnly:false})).entries.length,4);
});
test("import verifies SHA-256 and rejects conflicting immutable package versions",async()=>{
 let one=await add(emptyVault(),pack("alpha"));
 let two=await add(emptyVault(),pack("beta"));
 const merged=await importVault(one,two,{expectedRevision:one.revision});
 assert.deepEqual(merged.entries.map(x=>x.id),["alpha","beta"]);
 const duplicate=await importVault(merged,two,{expectedRevision:merged.revision});
 assert.deepEqual(duplicate,merged);
 const changed=await sealPackage(pack("alpha",1,{title:"OTHER"}));
 await assert.rejects(()=>importVault(one,{format:VAULT_FORMAT,revision:1,entries:[changed]},{expectedRevision:1}),/conflicting immutable version/);
 const invalid=JSON.parse(JSON.stringify(two));invalid.entries[0].blueprint.nodes[0].name="tampered";
 await assert.rejects(()=>validateVault(invalid),/SHA-256 integrity/);
});
test("queue is local, ticket idempotent, per-flow exclusive, CAS conflict preserves pending order",()=>{
 const q=new ConstructionQueue();
 const request=(ticket,flowId="f1",stamp="v1")=>({ticket,flowId,planId:"sha256:"+"a".repeat(64),expectedStamp:stamp});
 q.enqueue(request("one"));
 q.enqueue(request("two"));
 q.enqueue(request("three","f2"));
 assert.equal(q.status().queued,3);
 assert.throws(()=>q.enqueue(request("one")),/duplicate work ticket/);
 assert.throws(()=>q.acquire("f1","bad"),/stale flow snapshot/);
 assert.equal(q.status().queued,3,"stale CAS must not discard a plan");
 const active=q.acquire("f1","v1");
 assert.equal(active.ticket,"one");
 assert.throws(()=>q.acquire("f1","v1"),/already has construction lease/);
 assert.equal(q.acquire("f2","v1").ticket,"three");
 assert.equal(q.status().active,2);
 assert.throws(()=>q.settle("f1","wrong",{ok:true}),/ownership mismatch/);
 assert.deepEqual(q.settle("f1","one",{ok:true,createdIds:["n1","n2"]}),
   {ticket:"one",flowId:"f1",ok:true,created:2});
 assert.equal(q.acquire("f1","v1").ticket,"two");
 assert.equal(q.cancel("untracked"),false);
 q.settle("f1","two",{ok:false});
 q.settle("f2","three",{ok:true});
 assert.equal(q.status().active,0);
 assert.equal(q.status().receipts,3);
});
test("R04 package resources match canonical modules, editor registration remains nonexecuting",async()=>{
 const root=new URL("../../adamantium/plugins/node-red-contrib-adamantium-construct/",import.meta.url);
 for(const name of ["vault.mjs","vault-editor.mjs"]){
  const canonical=await readFile(new URL("../../adamantium/construct-native/"+name,import.meta.url),"utf8");
  const embedded=await readFile(new URL("resources/"+name,root),"utf8");
  assert.equal(embedded,canonical);
 }
 const pkg=JSON.parse(await readFile(new URL("package.json",root),"utf8"));
 assert.equal(pkg["node-red"].nodes,undefined);
 assert.ok(pkg["node-red"].plugins["adamantium-native"]);
 assert.equal(pkg.scripts?.postinstall,undefined);
});
