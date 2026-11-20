import test from "node:test";
import assert from "node:assert/strict";
import {CapsuleStudio} from "../../adamantium/capsule-studio.mjs";
import {projectNativeCanvas,validateNativeCanvas,positionNativePort,pathNativeWire} from "../../adamantium/capsule-native-canvas.mjs";
const p=(tag,direction,semantics="data")=>({tag,direction,semantics,dataType:"core.json@1"});
function sample(){
  const studio=new CapsuleStudio(),root=studio.createGraph("Main");
  const d=studio.createDefinition({
    name:"Source",language:"python",source:"SECRET_SOURCE_MUST_NOT_LEAK",
    ports:[p("input","input"),p("result","output"),p("event","output","event")]
  });
  const a=studio.place(root,d.id),b=studio.place(root,d.id);
  const capsule=studio.createCapsule(root,"Four rail capsule");
  const n=studio.place(capsule.graphId,d.id);
  studio.expose(capsule.graphId,{side:"north",instanceId:n,tag:"input",externalTag:"top"});
  studio.expose(capsule.graphId,{side:"east",instanceId:n,tag:"result",externalTag:"right"});
  studio.expose(capsule.graphId,{side:"south",instanceId:n,tag:"event",externalTag:"bottom"});
  studio.expose(capsule.graphId,{side:"west",instanceId:n,tag:"input",externalTag:"left"});
  studio.connect(root,{fromId:a,fromTag:"result",toId:capsule.instanceId,toTag:"top"});
  studio.connect(root,{fromId:capsule.instanceId,fromTag:"right",toId:b,toTag:"input"});
  const positions={[root]:{[a]:{x:80,y:170},[capsule.instanceId]:{x:400,y:200},[b]:{x:720,y:170}}};
  return {studio,root,a,b,capsule,positions};
}
test("R07 projects real four-sided capsule geometry and preserves exact typed tags",()=>{
  const {studio,root,capsule,positions}=sample();
  const model=projectNativeCanvas(studio,{graphId:root,positions});
  assert.deepEqual(validateNativeCanvas(model),{
    valid:true,graphId:root,nodes:3,edges:2,executable:false,authoritative:false
  });
  assert.equal(model.mode,"inert-editor-lens");
  const node=model.nodes.find(n=>n.id===capsule.instanceId);
  assert.ok(node);
  assert.equal(node.kind,"capsule");
  assert.equal(node.childGraphId,capsule.graphId);
  assert.equal(node.x,400);
  assert.equal(node.y,200);
  assert.deepEqual(node.ports.map(p=>[p.tag,p.side]),[
    ["top","north"],["right","east"],["bottom","south"],["left","west"]
  ]);
  const anchors=Object.fromEntries(node.ports.map(p=>[p.side,positionNativePort(node,p.tag)]));
  assert.equal(anchors.north.y,node.y);
  assert.equal(anchors.east.x,node.x+node.width);
  assert.equal(anchors.south.y,node.y+node.height);
  assert.equal(anchors.west.x,node.x);
  assert.equal(anchors.north.dy,-1);
  assert.equal(anchors.west.dx,-1);
  assert.equal(anchors.east.dx,1);
  assert.equal(anchors.south.dy,1);
  for(const edge of model.edges)assert.match(pathNativeWire(model,edge),/^M \d+(\.\d+)? \d+(\.\d+)? C /);
  assert.ok(!JSON.stringify(model).includes("SECRET_SOURCE_MUST_NOT_LEAK"));
  assert.ok(!JSON.stringify(model).includes("source"));
});
test("multiple same-side channels keep independent anchor locations even when their data types match",()=>{
  const {studio,root,capsule,positions}=sample();
  const node=projectNativeCanvas(studio,{graphId:root,positions}).nodes.find(n=>n.id===capsule.instanceId);
  const x=node.ports.filter(p=>p.tag==="top")[0];
  const y=node.ports.filter(p=>p.tag==="left")[0];
  assert.notEqual(x.side,y.side);
  const dupe={...node,ports:[
    ...node.ports,
    {tag:"other_top",direction:"input",dataType:x.dataType,semantics:x.semantics,side:"north"},
    {tag:"third_top",direction:"input",dataType:x.dataType,semantics:x.semantics,side:"north"}
  ]};
  const points=["top","other_top","third_top"].map(tag=>positionNativePort(dupe,tag));
  assert.equal(new Set(points.map(point=>point.x)).size,3);
  assert.ok(points.every(point=>point.y===dupe.y));
});
test("projection rejects source injection, forged policy ports, duplicate/invalid endpoints and invalid geometry",()=>{
  const {studio,root,positions}=sample();
  const good=projectNativeCanvas(studio,{graphId:root,positions});
  const source=structuredClone(good);source.nodes[0].source="malicious code";
  assert.throws(()=>validateNativeCanvas(source),/invalid node fields/);
  const sem=structuredClone(good);sem.nodes[0].ports[0].semantics="permission";
  assert.throws(()=>validateNativeCanvas(sem),/semantic-only permission/);
  const dup=structuredClone(good);dup.edges.push(structuredClone(dup.edges[0]));
  assert.throws(()=>validateNativeCanvas(dup),/duplicate edge id/);
  const missing=structuredClone(good);missing.edges[0].toId="node_not_here";
  assert.throws(()=>validateNativeCanvas(missing),/outside graph/);
  const wrong=structuredClone(good);wrong.edges[0].toTag="right";
  assert.throws(()=>validateNativeCanvas(wrong),/invalid wire direction/);
  const invalid=structuredClone(good);invalid.nodes[0].x=NaN;
  assert.throws(()=>validateNativeCanvas(invalid),/node x/);
});
test("canvas projection does not mutate original Capsule Studio or pinned microprogram versions",()=>{
  const {studio,root,positions}=sample();
  const before=studio.snapshot();
  const model=projectNativeCanvas(studio,{graphId:root,positions});
  model.nodes[0].title="Changed only in visual lens";
  model.nodes[0].ports.length=0;
  assert.deepEqual(studio.snapshot(),before);
});
test("invalid graph ID or missing definitions are rejected during model snapshot restore",()=>{
  const {studio,root}=sample();
  assert.throws(()=>projectNativeCanvas(studio,{graphId:"missing"}),/graph not found/);
  const corrupt=studio.snapshot();
  const d=Object.keys(studio.definitions)[0];
  delete studio.definitions[d];
  assert.throws(()=>projectNativeCanvas(studio,{graphId:root}),/definition/);
  assert.ok(corrupt);
});
