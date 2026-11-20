import test from "node:test";
import assert from "node:assert/strict";
import {CapsuleStudio,SIDES,FORMAT} from "../../adamantium/capsule-studio.mjs";

const p=(tag,direction,dataType="core.json@1",semantics="data")=>({tag,direction,dataType,semantics});
function fixture() {
  const s=new CapsuleStudio();
  const root=s.createGraph("Root");
  const processor=s.createDefinition({name:"Processor",language:"python",source:"def run(data): return data",ports:[p("data","input"),p("result","output"),p("error","output","core.error@1","event")]});
  return {s,root,processor};
}
test("create a reusable definition and place independent instances without code duplication",()=>{
  const {s,root,processor}=fixture();
  assert.equal(processor.reused,false);
  const again=s.createDefinition({name:"Renamed",language:"python",source:"def run(data): return data",ports:[p("result","output"),p("data","input"),p("error","output","core.error@1","event")]});
  assert.deepEqual(again,{id:processor.id,version:1,reused:true});
  const a=s.place(root,processor.id), b=s.place(root,processor.id);
  assert.notEqual(a,b);
  assert.equal(Object.keys(s.definitions).length,1);
  assert.equal(s.palette("Processor")[0].used,2);
  assert.equal(s.instance(root,a).config!==s.instance(root,b).config,true);
});
test("tagged edges enforce direction, semantics and exact data contract",()=>{
  const {s,root,processor}=fixture();
  const a=s.place(root,processor.id),b=s.place(root,processor.id);
  assert.ok(s.connect(root,{fromId:a,fromTag:"result",toId:b,toTag:"data"}));
  assert.throws(()=>s.connect(root,{fromId:a,fromTag:"result",toId:b,toTag:"data"}),/duplicate/);
  assert.throws(()=>s.connect(root,{fromId:a,fromTag:"data",toId:b,toTag:"result"}),/direction/);
  assert.throws(()=>s.connect(root,{fromId:a,fromTag:"error",toId:b,toTag:"data"}),/typed/);
  assert.throws(()=>s.connect(root,{fromId:a,fromTag:"missing",toId:b,toTag:"data"}),/endpoint/);
});
test("four boundary cards, independently exposed channels and overflow grouping",()=>{
  const {s,root,processor}=fixture();
  const c=s.createCapsule(root,"Nested");
  const node=s.place(c.graphId,processor.id);
  for(let i=0;i<6;i++) {
    const side=SIDES[i%4];
    const tag=s.expose(c.graphId,{side,instanceId:node,tag:i%2?"result":"data",externalTag:"channel"+i});
    assert.equal(tag,"channel"+i);
  }
  assert.equal(s.boundaryCard(c.graphId,"north").visible.length,2);
  assert.equal(s.boundaryCard(c.graphId,"east").visible.length,2);
  assert.equal(s.boundaryCard(c.graphId,"south").visible.length,1);
  assert.equal(s.boundaryCard(c.graphId,"west").visible.length,1);
  assert.equal(s.enter(root,c.instanceId),c.graphId);
  assert.equal(s.exit(c.graphId),root);
  assert.equal(s.path(c.graphId).length,2);
  // Extra channels on the same side collapse, never merge into one data channel.
  const s2=new CapsuleStudio(), r=s2.createGraph("Root"), d=s2.createDefinition({name:"T",language:"rust",source:"",ports:[p("o","output")]});
  const c2=s2.createCapsule(r,"Nested");
  for(let i=0;i<7;i++) {
    const n=s2.place(c2.graphId,d.id);
    s2.expose(c2.graphId,{side:"east",instanceId:n,tag:"o"});
  }
  const view=s2.boundaryCard(c2.graphId,"east");
  assert.equal(view.visible.length,4);
  assert.equal(view.hiddenCount,3);
  assert.equal(s2.resolvePorts(r,c2.instanceId).length,7);
});
test("identical port exposure is idempotent but names remain unique",()=>{
  const {s,root,processor}=fixture();
  const c=s.createCapsule(root,"C"), n=s.place(c.graphId,processor.id);
  assert.equal(s.expose(c.graphId,{side:"west",instanceId:n,tag:"data",externalTag:"incoming"}),"incoming");
  assert.equal(s.expose(c.graphId,{side:"west",instanceId:n,tag:"data",externalTag:"different"}),"incoming");
  assert.throws(()=>s.expose(c.graphId,{side:"east",instanceId:n,tag:"result",externalTag:"incoming"}),/duplicate/);
});
test("boundary ports participate in parent typed edges; connected ports cannot silently disappear",()=>{
  const {s,root,processor}=fixture();
  const c=s.createCapsule(root,"C"), n=s.place(c.graphId,processor.id);
  const outward=s.expose(c.graphId,{side:"east",instanceId:n,tag:"result",externalTag:"outgoing"});
  const target=s.place(root,processor.id);
  assert.ok(s.connect(root,{fromId:c.instanceId,fromTag:outward,toId:target,toTag:"data"}));
  assert.throws(()=>s.unexpose(c.graphId,outward),/still wired/);
  assert.equal(s.resolvePorts(root,c.instanceId)[0].tag,"outgoing");
});
test("palette supports used/favorites/search; deleting instance reduces use counter",()=>{
  const {s,root,processor}=fixture(), n=s.place(root,processor.id);
  s.favorite(processor.id,true);
  assert.equal(s.palette("python").length,1);
  assert.equal(s.palette("","favorites")[0].id,processor.id);
  assert.equal(s.palette("","used")[0].used,1);
  s.removeInstance(root,n);
  assert.equal(s.palette("","used").length,0);
  assert.equal(s.palette("","favorites").length,1);
});
test("pinned versions isolate changes; explicit opt-in migration is required",()=>{
  const {s,root,processor}=fixture();
  const n=s.place(root,processor.id,1);
  const v2=s.reviseDefinition(processor.id,{source:"def run(data): return data*2",ports:[p("data","input"),p("result","output")]});
  assert.equal(v2,2);
  assert.equal(s.instance(root,n).version,1);
  assert.equal(s.resolvePorts(root,n).length,3);
  const other=s.place(root,processor.id,2);
  assert.equal(s.resolvePorts(root,other).length,2);
});
test("snapshot restores definitions, references, edges and four-sided boundary data",()=>{
  const {s,root,processor}=fixture();
  const c=s.createCapsule(root,"C");
  const a=s.place(c.graphId,processor.id),b=s.place(root,processor.id);
  s.expose(c.graphId,{side:"west",instanceId:a,tag:"data",externalTag:"in"});
  s.expose(c.graphId,{side:"east",instanceId:a,tag:"result",externalTag:"out"});
  s.connect(root,{fromId:c.instanceId,fromTag:"out",toId:b,toTag:"data"});
  s.favorite(processor.id);
  const snap=s.snapshot();
  assert.equal(snap.format,FORMAT);
  const recovered=CapsuleStudio.restore(JSON.parse(JSON.stringify(snap)));
  assert.deepEqual(recovered.snapshot(),snap);
  assert.equal(recovered.boundaryCard(c.graphId,"west").visible[0].tag,"in");
});
test("nested capsule save/restore maintains external port bindings at every level",()=>{
  const {s,root,processor}=fixture();
  const outer=s.createCapsule(root,"Outer");
  const inner=s.createCapsule(outer.graphId,"Inner");
  const n=s.place(inner.graphId,processor.id);
  s.expose(inner.graphId,{side:"east",instanceId:n,tag:"result",externalTag:"inner_output"});
  s.expose(outer.graphId,{side:"north",instanceId:inner.instanceId,tag:"inner_output",externalTag:"outer_output"});
  const loaded=CapsuleStudio.restore(s.snapshot());
  assert.equal(loaded.resolvePorts(root,outer.instanceId)[0].tag,"outer_output");
});
test("invalid snapshots, capabilities and structural corruption fail closed",()=>{
  const {s,root,processor}=fixture();
  assert.throws(()=>s.createDefinition({name:"Bad",language:"python",source:"",ports:[p("a","input"),p("a","output")]}),/duplicate port/);
  assert.throws(()=>s.createDefinition({name:"Bad",language:"python",source:"",ports:[{tag:"shell",direction:"output",dataType:"core.json@1",semantics:"permission"}]}),/semantics/);
  const c=s.createCapsule(root,"C");
  assert.throws(()=>s.expose(root,{side:"north",instanceId:"x",tag:"x"}),/no parent/);
  assert.throws(()=>s.expose(c.graphId,{side:"diagonal",instanceId:"x",tag:"x"}),/side/);
  const bad=s.snapshot(); bad.format="other";
  assert.throws(()=>CapsuleStudio.restore(bad),/format/);
  const broken=s.snapshot();broken.graphs[c.graphId].parent.graphId="missing";
  assert.throws(()=>CapsuleStudio.restore(broken),/parent|graph not found|cyclic/);
});
