import test from "node:test";
import assert from "node:assert/strict";
import {CapsuleStudio} from "../../adamantium/capsule-studio.mjs";
import {layoutCapsuleGraph} from "../../adamantium/capsule-native-layout.mjs";
const port=(tag,direction,dataType="core.json@1")=>({tag,direction,semantics:"data",dataType});
function make(){
 const studio=new CapsuleStudio(),root=studio.createGraph("Root");
 const def=studio.createDefinition({name:"Adapter",language:"rust",source:"fn run() {}",
   ports:[port("in","input"),port("out","output")]});
 return {studio,root,def};
}
test("four-sided native SVG layout assigns actual typed, independently tagged anchors",()=>{
 const {studio,root,def}=make();
 const c=studio.createCapsule(root,"Gateway");
 const internal=studio.place(c.graphId,def.id);
 for(const [side,tag,externalTag] of [
  ["north","in","north_in"],["west","in","west_in"],
  ["east","out","east_out"],["south","out","south_out"]
 ])studio.expose(c.graphId,{side,instanceId:internal,tag,externalTag});
 const projection=layoutCapsuleGraph(studio,root,{[c.instanceId]:{x:330,y:270}});
 const node=projection.nodes[0];
 assert.equal(node.width,296);assert.equal(node.height,164);
 assert.equal(node.anchors.north_in.y,270);
 assert.equal(node.anchors.south_out.y,434);
 assert.equal(node.anchors.west_in.x,330);
 assert.equal(node.anchors.east_out.x,626);
 assert.deepEqual(Object.values(node.anchors).map(x=>x.tag).sort(),
  ["east_out","north_in","south_out","west_in"]);
 assert.ok(Object.values(node.anchors).every(a=>a.dataType==="core.json@1"));
});
test("output and input anchors produce side-specific cubic wire geometry",()=>{
 const {studio,root,def}=make();
 const a=studio.place(root,def.id),b=studio.place(root,def.id);
 studio.connect(root,{fromId:a,fromTag:"out",toId:b,toTag:"in"});
 const projection=layoutCapsuleGraph(studio,root,{
  [a]:{x:80,y:250},[b]:{x:500,y:250}
 });
 const wire=projection.edges[0];
 assert.equal(wire.from.side,"east");
 assert.equal(wire.to.side,"west");
 assert.equal(wire.from.x,318);
 assert.equal(wire.to.x,500);
 assert.equal(wire.from.dataType,wire.to.dataType);
 assert.match(wire.path,/^M [0-9.]+ [0-9.]+ C /);
});
test("collapsed rail never merges hidden typed port IDs, expandable rails reveal all",()=>{
 const studio=new CapsuleStudio(),root=studio.createGraph("Root");
 const wide=studio.createDefinition({name:"Wide",language:"rust",source:"// 9 distinct ports",
  ports:Array.from({length:9},(_,i)=>port("out_"+i,"output"))});
 const c=studio.createCapsule(root,"Wide");
 const inside=studio.place(c.graphId,wide.id);
 for(let i=0;i<9;i++){
  studio.expose(c.graphId,{side:"east",instanceId:inside,tag:"out_"+i,externalTag:"out_"+i});
 }
 const collapsed=layoutCapsuleGraph(studio,root);
 const node=collapsed.nodes[0];
 assert.equal(node.visibility.east.shown,4);
 assert.equal(node.visibility.east.hidden,5);
 assert.equal(Object.keys(node.anchors).length,9);
 assert.equal(new Set(Object.values(node.anchors).map(x=>x.y)).size,9);
 assert.equal(node.anchors.out_8.hidden,true);
 const expanded=layoutCapsuleGraph(studio,root,{},new Set([c.instanceId+":east"])).nodes[0];
 assert.equal(expanded.visibility.east.shown,9);
 assert.equal(expanded.visibility.east.hidden,0);
 assert.equal(expanded.anchors.out_8.hidden,false);
 assert.ok(expanded.height>node.height);
});
test("repeated microprogram instances retain independent positions and pinned definitions",()=>{
 const {studio,root,def}=make();
 const a=studio.place(root,def.id),b=studio.place(root,def.id);
 const projected=layoutCapsuleGraph(studio,root,{[a]:{x:40,y:70},[b]:{x:550,y:70}});
 assert.deepEqual(projected.nodes.map(x=>x.x),[40,550]);
 assert.equal(Object.keys(studio.definitions).length,1);
 assert.equal(projected.nodes[0].kind,"microprogram");
});
test("nested parent portal is explicitly navigable through all four boundary cards",()=>{
 const {studio,root,def}=make();
 const c=studio.createCapsule(root,"Child"),inside=studio.place(c.graphId,def.id);
 studio.expose(c.graphId,{side:"west",instanceId:inside,tag:"in",externalTag:"input"});
 studio.expose(c.graphId,{side:"east",instanceId:inside,tag:"out",externalTag:"output"});
 const layout=layoutCapsuleGraph(studio,c.graphId);
 assert.equal(layout.parentGraphId,root);
 assert.deepEqual(layout.boundary.map(x=>x.side),["north","east","south","west"]);
 assert.equal(layout.boundary.find(x=>x.side==="west").visible[0].tag,"input");
 assert.equal(layout.boundary.find(x=>x.side==="east").visible[0].tag,"output");
});
test("bad positions are clamped and layout does not mutate source model",()=>{
 const {studio,root,def}=make();
 const a=studio.place(root,def.id),before=studio.snapshot();
 const output=layoutCapsuleGraph(studio,root,{[a]:{x:-Infinity,y:Infinity}});
 assert.equal(output.nodes[0].x,32);
 assert.equal(output.nodes[0].y,7900);
 assert.deepEqual(studio.snapshot(),before);
});
test("native interactive projection fails closed for oversized graph",()=>{
 const {studio,root,def}=make();
 for(let i=0;i<1201;i++)studio.place(root,def.id);
 assert.throws(()=>layoutCapsuleGraph(studio,root),/too many nodes/);
});

test("hidden +N port cannot conceal a wrong-direction or mismatched typed wire",()=>{
 const studio=new CapsuleStudio(),root=studio.createGraph("Guarded");
 const wide=studio.createDefinition({name:"Hidden sources",language:"rust",source:"// display-only",
  ports:Array.from({length:7},(_,i)=>port("out_"+i,"output"))});
 const receiver=studio.createDefinition({name:"Receiver",language:"rust",source:"// display-only",
  ports:[port("in","input","core.text@1"),port("out","output")]});
 const a=studio.place(root,wide.id),b=studio.place(root,receiver.id);
 const edges=studio.graph(root).edges;
 edges.push({id:"forged_wrong_type",fromId:a,fromTag:"out_6",toId:b,toTag:"in",semantics:"data",dataType:"core.json@1"});
 assert.throws(()=>layoutCapsuleGraph(studio,root),/typed wire contract mismatch/,
  "collapsed hidden source must be validated before visual clipping");
 edges.length=0;
 edges.push({id:"forged_wrong_direction",fromId:a,fromTag:"out_6",toId:b,toTag:"out",semantics:"data",dataType:"core.json@1"});
 assert.throws(()=>layoutCapsuleGraph(studio,root),/dangling or wrong-direction wire/,
  "collapsed hidden output must not connect to another output");
});
