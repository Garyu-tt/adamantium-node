import test from "node:test";
import assert from "node:assert/strict";
import {CapsuleStudio} from "../../adamantium/capsule-studio.mjs";
import {CapsuleTemplateLibrary} from "../../adamantium/capsule-extract.mjs";
import {ConstructEngine,CONSTRUCT_FORMAT} from "../../adamantium/construct-engine.mjs";

const p=(tag,direction)=>({tag,direction,dataType:"core.json@1",semantics:"data"});
function setup(){
  const studio=new CapsuleStudio(),root=studio.createGraph("Root");
  const source=studio.createDefinition({name:"Source",language:"python",source:"return 1",ports:[p("out","output")]});
  const sink=studio.createDefinition({name:"Sink",language:"python",source:"return 2",ports:[p("in","input")]});
  const lib=new CapsuleTemplateLibrary();
  return {studio,root,source,sink,lib,engine:new ConstructEngine(studio,lib)};
}
test("Construct metadata has versioned, round-trippable source-only format",()=>{
  const {studio,lib,engine}=setup();
  assert.equal(engine.snapshot().format,CONSTRUCT_FORMAT);
  assert.deepEqual(ConstructEngine.restore(studio,lib,engine.snapshot()).snapshot(),engine.snapshot());
});
test("batch builds two typed nodes, auto-connects by result reference, and validates saved graph",()=>{
  const {studio,root,source,sink,engine}=setup();
  const r=engine.apply([
    {type:"place",graphId:root,definitionId:source.id},
    {type:"place",graphId:root,definitionId:sink.id},
    {type:"auto_connect",graphId:root,fromId:"@0",toId:"@1"}
  ]);
  assert.equal(r.results.length,3);
  assert.equal(studio.graph(root).edges.length,1);
  assert.equal(studio.graph(root).edges[0].fromId,r.results[0].instanceId);
  assert.equal(studio.graph(root).edges[0].toId,r.results[1].instanceId);
  assert.deepEqual(CapsuleStudio.restore(studio.snapshot()).snapshot(),studio.snapshot());
});
test("dry run makes no changes in studio, library or metadata",()=>{
  const {studio,root,source,lib,engine}=setup();
  const s=studio.snapshot(),l=lib.snapshot(),m=engine.snapshot();
  const preview=engine.preview([{type:"place",graphId:root,definitionId:source.id,mode:"fork"}]);
  assert.equal(preview.after.definitions,preview.before.definitions+1);
  assert.deepEqual(studio.snapshot(),s);
  assert.deepEqual(lib.snapshot(),l);
  assert.deepEqual(engine.snapshot(),m);
});
test("instance reuses pinned implementation and fork makes an independent definition lineage",()=>{
  const {studio,root,source,engine}=setup();
  const origin=engine.apply([{type:"place",graphId:root,definitionId:source.id}]).results[0].instanceId;
  const results=engine.apply([
    {type:"duplicate",graphId:root,instanceId:origin,mode:"instance"},
    {type:"duplicate",graphId:root,instanceId:origin,mode:"fork"}
  ]).results;
  assert.equal(studio.instance(root,results[0].instanceId).definitionId,source.id);
  const fork=studio.instance(root,results[1].instanceId);
  assert.notEqual(fork.definitionId,source.id);
  assert.equal(studio.definitions[fork.definitionId].versions[1].source,
    studio.definitions[source.id].versions[1].source);
  assert.deepEqual(engine.forks[fork.definitionId],{definitionId:source.id,version:1});
  studio.reviseDefinition(fork.definitionId,{source:"return 42",ports:[p("out","output")]});
  assert.equal(Object.keys(studio.definitions[source.id].versions).length,1);
});
test("view aliases retain exact original identity and protect target from deletion",()=>{
  const {studio,root,source,engine}=setup();
  const n=studio.place(root,source.id);
  const view=engine.apply([{type:"alias",graphId:root,instanceId:n}]).results[0];
  assert.deepEqual(engine.views[view.id],{graphId:root,instanceId:n});
  const prior=studio.snapshot();
  assert.throws(()=>engine.apply([{type:"remove",graphId:root,instanceId:n}]),/linked views/);
  assert.deepEqual(studio.snapshot(),prior);
  engine.apply([{type:"unalias",viewId:view.id},{type:"remove",graphId:root,instanceId:n}]);
  assert.equal(studio.graph(root).instances.length,0);
});
test("all-or-nothing rollback and stale revision rejection",()=>{
  const {studio,root,source,engine,lib}=setup();
  const before=studio.snapshot(),meta=engine.snapshot(),templates=lib.snapshot();
  assert.throws(()=>engine.apply([
    {type:"place",graphId:root,definitionId:source.id,mode:"fork"},
    {type:"remove",graphId:root,instanceId:"node_missing"}
  ]),/not found/);
  assert.deepEqual(studio.snapshot(),before);
  assert.deepEqual(engine.snapshot(),meta);
  assert.deepEqual(lib.snapshot(),templates);
  engine.apply([{type:"place",graphId:root,definitionId:source.id}],{expectedRevision:0});
  assert.throws(()=>engine.apply([{type:"place",graphId:root,definitionId:source.id}],{expectedRevision:0}),/stale/);
});
test("reactive rule applies only on matching event; replay is idempotent",()=>{
  const {studio,root,source,engine}=setup();
  engine.addRule({id:"spawn_from_ui",eventType:"ui:tab-created",enabled:true,
    commands:[{type:"place",graphId:root,definitionId:source.id}]});
  assert.equal(engine.dispatch({id:"event_1",type:"ui:tab-selected"}).skipped,true);
  const result=engine.dispatch({id:"event_1",type:"ui:tab-created"});
  assert.equal(result.skipped,false);
  assert.equal(studio.graph(root).instances.length,1);
  assert.equal(engine.dispatch({id:"event_1",type:"ui:tab-created"}).skipped,true);
  assert.equal(studio.graph(root).instances.length,1);
});
test("ambiguous auto-wire fails closed, no guessed port chosen",()=>{
  const {studio,root,engine}=setup();
  const a=studio.createDefinition({name:"a",language:"js",source:"1",
    ports:[p("x","output"),p("y","output")]});
  const b=studio.createDefinition({name:"b",language:"js",source:"2",ports:[p("z","input")]});
  const before=studio.snapshot();
  assert.throws(()=>engine.apply([
    {type:"place",graphId:root,definitionId:a.id},
    {type:"place",graphId:root,definitionId:b.id},
    {type:"auto_connect",graphId:root,fromId:"@0",toId:"@1"}
  ]),/exactly one/);
  assert.deepEqual(studio.snapshot(),before);
});
test("template instance shares underlying definitions; template fork detaches them",()=>{
  const {studio,root,source,lib,engine}=setup();
  const capsule=studio.createCapsule(root,"One");
  studio.place(capsule.graphId,source.id);
  const captured=lib.capture(studio,capsule.graphId,"Assembly");
  const a=engine.apply([{type:"template",graphId:root,templateId:captured.id,mode:"instance"}]).results[0];
  const b=engine.apply([{type:"template",graphId:root,templateId:captured.id,mode:"fork"}]).results[0];
  assert.equal(studio.graph(a.graphId).instances[0].definitionId,source.id);
  assert.notEqual(studio.graph(b.graphId).instances[0].definitionId,source.id);
  assert.deepEqual(CapsuleStudio.restore(studio.snapshot()).snapshot(),studio.snapshot());
  assert.deepEqual(ConstructEngine.restore(studio,lib,engine.snapshot()).snapshot(),engine.snapshot());
});
test("bounded command budget rejects untrusted large mutation",()=>{
 const {root,source,engine}=setup();
 assert.throws(()=>engine.apply(Array.from({length:129},()=>({type:"place",graphId:root,definitionId:source.id}))),/1..128/);
});
