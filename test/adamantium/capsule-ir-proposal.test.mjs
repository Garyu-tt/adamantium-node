import test from "node:test";
import assert from "node:assert/strict";
import {CapsuleStudio} from "../../adamantium/capsule-studio.mjs";
import {extractSelection} from "../../adamantium/capsule-extract.mjs";
import {createCapsuleIRProposal,inspectCapsuleIRProposal} from "../../adamantium/capsule-ir-proposal.mjs";
import {createReadOnlyProjection} from "../../adamantium/editor-projection.mjs";

const port=(tag,direction,semantics="data",dataType="core.json@1")=>
  ({tag,direction,semantics,dataType});
const base=()=>{
 const studio=new CapsuleStudio(),root=studio.createGraph("Root");
 const type=studio.createDefinition({
  name:"JSON Processor",language:"python",source:"secret_internal_sample = 'NOT-FOR-IR'\ndef run(x): return x",
  ports:[port("data","input"),port("result","output"),port("error","output","event","core.error@1")]
 });
 return {studio,root,type};
};
const example=()=>{
 const {studio,root,type}=base();
 const a=studio.place(root,type.id),b=studio.place(root,type.id),c=studio.place(root,type.id);
 studio.connect(root,{fromId:a,fromTag:"result",toId:b,toTag:"data"});
 studio.connect(root,{fromId:b,fromTag:"result",toId:c,toTag:"data"});
 const capsule=extractSelection(studio,root,[b],"Engine");
 return {studio,root,type,capsule};
};

test("projects independent canonical Graph IR documents and keeps sidecar bindings separate",()=>{
 const {studio,root,capsule}=example();
 const exported=createCapsuleIRProposal(studio,{revision:7,domain:"program"});
 assert.equal(exported.format,"adamantium.capsule-ir-proposal/1");
 assert.equal(exported.mode,"proposal-only");
 assert.equal(exported.authority,"none");
 assert.equal(exported.executable,false);
 assert.equal(exported.approved,false);
 assert.equal(exported.rootGraphId,root);
 assert.equal(exported.graphs.length,2);
 assert.equal(exported.boundaryBindings.length,2);
 assert.ok(exported.boundaryBindings.some(b=>b.side==="west"));
 assert.ok(exported.boundaryBindings.some(b=>b.side==="east"));
 for(const graph of exported.graphs){
  assert.equal(graph.schema,"mechanicus.universal-graph/1");
  assert.equal(graph.schemaVersion,1);
  assert.equal(graph.revision,7);
  assert.equal(createReadOnlyProjection(graph).mode,"read-only");
  for(const node of graph.nodes)if(node.kind==="composite"){
    assert.equal(node.graphRef,capsule.graphId);
    assert.equal(node.graphRefRevision,7);
    assert.equal(node.typeRef,"");
  }
 }
 const text=JSON.stringify(exported);
 assert.ok(!text.includes("NOT-FOR-IR"));
 assert.ok(!text.includes("def run"));
 assert.deepEqual(inspectCapsuleIRProposal(exported),{
  valid:true,rootGraphId:root,graphCount:2,boundaryCount:2,definitionCount:1,revision:7,
  authority:"none",executable:false
 });
});
test("keeps multiple independently tagged ports and nested composite graph references",()=>{
 const {studio,root,type}=base();
 const outer=studio.createCapsule(root,"Outer");
 const inner=studio.createCapsule(outer.graphId,"Inner");
 const worker=studio.place(inner.graphId,type.id);
 studio.expose(inner.graphId,{side:"north",instanceId:worker,tag:"data",externalTag:"north_input"});
 studio.expose(inner.graphId,{side:"south",instanceId:worker,tag:"result",externalTag:"south_output"});
 studio.expose(outer.graphId,{side:"west",instanceId:inner.instanceId,tag:"north_input",externalTag:"in"});
 studio.expose(outer.graphId,{side:"east",instanceId:inner.instanceId,tag:"south_output",externalTag:"out"});
 const exported=createCapsuleIRProposal(studio,{revision:2,domain:"neural"});
 assert.equal(exported.graphs.length,3);
 assert.equal(exported.boundaryBindings.length,4);
 assert.equal(inspectCapsuleIRProposal(exported).graphCount,3);
 assert.equal(exported.graphs.find(g=>g.id===inner.graphId).interfacePorts.length,2);
});
test("typed mismatches, unbound boundary interfaces and incorrect graphRef revision fail",()=>{
 const {studio,capsule}=example();
 const good=createCapsuleIRProposal(studio);
 const bad=structuredClone(good);
 bad.boundaryBindings[0].dataType="core.unrelated@1";
 assert.throws(()=>inspectCapsuleIRProposal(bad),/boundary interface mismatch/);
 const missing=structuredClone(good);missing.boundaryBindings.pop();
 assert.throws(()=>inspectCapsuleIRProposal(missing),/unbound/);
 const invalid=structuredClone(good);
 const comp=invalid.graphs.flatMap(g=>g.nodes).find(n=>n.kind==="composite");
 comp.graphRefRevision=3;
 assert.throws(()=>inspectCapsuleIRProposal(invalid),/unresolved graph revision|invalid composite/);
});
test("rejects imported permission routes posing as executable wires",()=>{
 const {studio}=example();
 const proposal=createCapsuleIRProposal(studio);
 const invalid=structuredClone(proposal);
 invalid.graphs[0].edges[0].semantics="permission";
 assert.throws(()=>inspectCapsuleIRProposal(invalid),/typed port|forbidden|Invalid Graph IR|semantic-only/);
});
test("zero-delay cycles are rejected, and source Graph Studio does not mutate",()=>{
 const {studio,root,type}=base();
 const a=studio.place(root,type.id),b=studio.place(root,type.id);
 studio.connect(root,{fromId:a,fromTag:"result",toId:b,toTag:"data"});
 studio.connect(root,{fromId:b,fromTag:"result",toId:a,toTag:"data"});
 const before=studio.snapshot();
 assert.throws(()=>createCapsuleIRProposal(studio),/zero-delay cycle/);
 assert.deepEqual(studio.snapshot(),before);
});
test("rejects orphan and multiply-owned graph proposals",()=>{
 const {studio}=example();
 const good=createCapsuleIRProposal(studio);
 const orphan=structuredClone(good);
 orphan.graphs[1].id="graph_orphan";
 assert.throws(()=>inspectCapsuleIRProposal(orphan),/graph|composite/i);
 const duplicate=structuredClone(good);
 duplicate.graphs.push(structuredClone(duplicate.graphs[0]));
 assert.throws(()=>inspectCapsuleIRProposal(duplicate),/duplicate/);
});
test("strictly prevents unauthorized authority claims and bad revisions",()=>{
 const {studio}=example();
 assert.throws(()=>createCapsuleIRProposal(studio,{revision:0}),/revision/);
 assert.throws(()=>createCapsuleIRProposal(studio,{domain:"execute"}),/domain/);
 const good=createCapsuleIRProposal(studio);
 const claims=structuredClone(good);claims.approved=true;
 assert.throws(()=>inspectCapsuleIRProposal(claims),/forbidden authority/);
});

test("rejects extra fields in IR nodes or proposal envelope that could smuggle source code or permissions",()=>{
 const {studio}=example();
 const safe=createCapsuleIRProposal(studio);
 const extra=structuredClone(safe);
 extra.graphs[0].nodes[0].source="secret_must_not_be_here";
 assert.throws(()=>inspectCapsuleIRProposal(extra),/unknown\/missing fields/);
 const fakeGrant=structuredClone(safe);
 fakeGrant.masGrant="execute-all";
 assert.throws(()=>inspectCapsuleIRProposal(fakeGrant),/unknown\/missing fields/);
 const badEdge=structuredClone(safe);
 badEdge.graphs[0].edges[0].secretToken="hidden";
 assert.throws(()=>inspectCapsuleIRProposal(badEdge),/unknown\/missing fields/);
});
test("unverified definition handles cannot hide mismatched port counts",()=>{
 const {studio}=example();
 const safe=createCapsuleIRProposal(studio);
 safe.definitionHandles[0].portCount=0;
 assert.throws(()=>inspectCapsuleIRProposal(safe),/definition port count mismatch/);
});

test("rejects semantic-only graph wires and policy nodes even when typed consistently",()=>{
 const {studio}=example();
 const proposal=createCapsuleIRProposal(studio);
 const semantic=structuredClone(proposal);
 const g=semantic.graphs.find(x=>x.edges.length);
 const e=g.edges[0];
 e.semantics="permission";
 const from=g.nodes.find(n=>n.id===e.fromNode);
 const to=g.nodes.find(n=>n.id===e.toNode);
 from.ports.find(p=>p.id===e.fromPort).semantics="permission";
 to.ports.find(p=>p.id===e.toPort).semantics="permission";
 assert.throws(()=>inspectCapsuleIRProposal(semantic),/semantic-only (port|edges)/);
 const policy=structuredClone(proposal);
 policy.graphs.flatMap(g=>g.nodes).find(n=>n.kind==="service").kind="policy";
 assert.throws(()=>inspectCapsuleIRProposal(policy),/unsupported node kind/);
});
