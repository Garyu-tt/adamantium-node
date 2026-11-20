import test from "node:test";
import assert from "node:assert/strict";
import {CapsuleStudio} from "../../adamantium/capsule-studio.mjs";
import {layoutCapsuleCanvas} from "../../adamantium/capsule-canvas-geometry.mjs";

const P=(tag,direction,semantics="data",dataType="core.json@1")=>
 ({tag,direction,semantics,dataType});
function setup(){
 const s=new CapsuleStudio(),root=s.createGraph("Main");
 const def=s.createDefinition({name:"Source",language:"rust",source:"// inert",
  ports:[P("in","input"),P("out","output")]});
 const source=s.place(root,def.id);
 const cap=s.createCapsule(root,"Four-sided capsule");
 const worker=s.place(cap.graphId,def.id);
 s.expose(cap.graphId,{side:"north",instanceId:worker,tag:"in",externalTag:"north_input"});
 s.expose(cap.graphId,{side:"east",instanceId:worker,tag:"out",externalTag:"east_output"});
 s.expose(cap.graphId,{side:"south",instanceId:worker,tag:"out",externalTag:"south_output"});
 s.expose(cap.graphId,{side:"west",instanceId:worker,tag:"in",externalTag:"west_input"});
 s.connect(root,{fromId:source,fromTag:"out",toId:cap.instanceId,toTag:"west_input"});
 return {s,root,cap,source};
}
test("native editor geometry keeps 4 physical sides, stable typed tags and unique wires",()=>{
 const {s,root,cap,source}=setup();
 const result=layoutCapsuleCanvas(s,root,{
  [source]:{x:50,y:80},[cap.instanceId]:{x:320,y:200}
 });
 assert.equal(result.runtimeActivated,false);
 assert.equal(result.modelType,"editor-only");
 assert.equal(result.cards.length,2);
 const capsule=result.cards.find(c=>c.id===cap.instanceId);
 assert.equal(capsule.kind,"capsule");
 assert.deepEqual(capsule.ports.map(p=>p.side).sort(),["east","north","south","west"]);
 assert.equal(new Set(capsule.ports.map(p=>p.tag)).size,4);
 assert.equal(result.wires.length,1);
 const wire=result.wires[0];
 assert.equal(wire.to.side,"west");
 assert.equal(wire.from.side,"east");
 assert.match(wire.d,/^M [0-9.]+ [0-9.]+ C /);
 assert.equal(result.hiddenLinks,0);
});
test("overflow is explicitly hidden until expansion and never aliases typed channels",()=>{
 const s=new CapsuleStudio(),root=s.createGraph("Root");
 const ports=Array.from({length:7},(_,i)=>P("out"+i,"output"));
 const def=s.createDefinition({name:"Seven outputs",language:"python",source:"pass",ports});
 const cap=s.createCapsule(root,"Big");
 const inner=s.place(cap.graphId,def.id);
 for(const p of ports){
  s.expose(cap.graphId,{side:"east",instanceId:inner,tag:p.tag,externalTag:p.tag});
 }
 const sinkDef=s.createDefinition({name:"Sink",language:"rust",source:"// none",ports:[P("in","input")]});
 const sink=s.place(root,sinkDef.id);
 s.connect(root,{fromId:cap.instanceId,fromTag:"out5",toId:sink,toTag:"in"});
 let layout=layoutCapsuleCanvas(s,root);
 let card=layout.cards.find(c=>c.id===cap.instanceId);
 assert.equal(card.sides.east.visible.length,4);
 assert.equal(card.sides.east.hiddenCount,3);
 assert.equal(new Set(card.ports.map(p=>p.tag)).size,4);
 assert.equal(layout.wires.length,0);
 assert.equal(layout.hiddenLinks,1);
 const expand={[JSON.stringify([cap.instanceId,"east"])]:true};
 layout=layoutCapsuleCanvas(s,root,{},expand);
 card=layout.cards.find(c=>c.id===cap.instanceId);
 assert.equal(card.sides.east.hiddenCount,0);
 assert.equal(card.ports.filter(p=>p.side==="east").length,7);
 assert.equal(new Set(card.ports.map(p=>p.y)).size,7);
 assert.equal(layout.wires.length,1);
 assert.equal(layout.hiddenLinks,0);
 assert.equal(layout.wires[0].fromTag,"out5");
});
test("same physical side may carry independent input and output; no implicit Node-RED flow conversion",()=>{
 const {s,root,cap}=setup();
 const layout=layoutCapsuleCanvas(s,root);
 const card=layout.cards.find(c=>c.id===cap.instanceId);
 assert.equal(card.ports.find(p=>p.tag==="north_input").direction,"input");
 assert.equal(card.ports.find(p=>p.tag==="south_output").direction,"output");
 assert.equal(layout.graphPath.length,1);
 assert.equal(layout.hasNestedView,false);
 const child=layoutCapsuleCanvas(s,cap.graphId);
 assert.equal(child.hasNestedView,true);
 assert.equal(child.graphPath.length,2);
 assert.equal(child.cards.length,1);
});
test("invalid coordinates, graph IDs and missing source ports are fail-closed or clamped",()=>{
 const {s,root,source}=setup();
 assert.throws(()=>layoutCapsuleCanvas(s,"invalid"),/graph not found/);
 const layout=layoutCapsuleCanvas(s,root,{[source]:{x:Infinity,y:-600}});
 const src=layout.cards.find(c=>c.id===source);
 assert.equal(src.x,1100);
 assert.equal(src.y,0);
 s.graph(root).edges[0].fromTag="missing";
 assert.throws(()=>layoutCapsuleCanvas(s,root),/missing typed edge endpoint/);
});

test("hidden overflow links are still validated instead of silently skipping forged semantics or directions",()=>{
 const studio=new CapsuleStudio(),root=studio.createGraph("Root");
 const ports=Array.from({length:6},(_,i)=>P("out"+i,"output"));
 const writer=studio.createDefinition({name:"Writer",language:"rust",source:"// source",ports});
 const cap=studio.createCapsule(root,"Big");
 const internal=studio.place(cap.graphId,writer.id);
 for(const p of ports)studio.expose(cap.graphId,{
   side:"east",instanceId:internal,tag:p.tag,externalTag:p.tag
 });
 const sinkDef=studio.createDefinition({
   name:"Sink",language:"python",source:"pass",
   ports:[P("input","input"),P("alsoOutput","output")]
 });
 const sink=studio.place(root,sinkDef.id);
 studio.connect(root,{fromId:cap.instanceId,fromTag:"out5",toId:sink,toTag:"input"});
 assert.equal(layoutCapsuleCanvas(studio,root).hiddenLinks,1);
 // This edge has a valid endpoint name but a forbidden output→output link.
 studio.graph(root).edges[0].toTag="alsoOutput";
 assert.throws(()=>layoutCapsuleCanvas(studio,root),/typed edge mismatch/);
 studio.graph(root).edges[0].toTag="input";
 // Semantics on a hidden port cannot become a permission route.
 const bound=studio.graph(cap.graphId).boundary.find(p=>p.tag==="out5");
 bound.semantics="permission";
 assert.throws(()=>layoutCapsuleCanvas(studio,root),/forbidden semantic-only port/);
});
