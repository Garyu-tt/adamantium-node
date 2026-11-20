import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {CapsuleStudio} from "../../adamantium/capsule-studio.mjs";
import {CapsuleNativeCanvas,STORAGE_KEY} from "../../adamantium/capsule-native-canvas.mjs";

const NS="http://www.w3.org/2000/svg";
class FakeSvg {
  constructor(tag,doc){
    this.tagName=tag;this.doc=doc;this.attributes={};
    this.children=[];this.parentNode=null;this.handlers={};
    this.ownerSVGElement=null;this.textContent="";
  }
  setAttribute(name,value){this.attributes[name]=String(value);}
  getAttribute(name){return this.attributes[name]??null;}
  appendChild(node){
    this.children.push(node);node.parentNode=this;
    node.ownerSVGElement=this.tagName==="svg"?this:this.ownerSVGElement;
    return node;
  }
  removeChild(node){
    const n=this.children.indexOf(node);
    assert.ok(n>=0);this.children.splice(n,1);node.parentNode=null;return node;
  }
  get firstChild(){return this.children[0]||null;}
  remove(){if(this.parentNode)this.parentNode.removeChild(this);}
  addEventListener(name,listener){this.handlers[name]??=[];this.handlers[name].push(listener);}
  getScreenCTM(){return {inverse:()=>({})};}
  createSVGPoint(){return {x:0,y:0,matrixTransform(){return {x:this.x,y:this.y};}};}
  fire(name,props={}){
    const event={button:0,clientX:0,clientY:0,shiftKey:false,
      stopPropagation(){},preventDefault(){},...props};
    for(const fn of this.handlers[name]||[])fn(event);
    return event;
  }
}
class FakeDoc {
  constructor(){this.handlers={};}
  createElementNS(ns,name){assert.equal(ns,NS);return new FakeSvg(name,this);}
  addEventListener(name,fn){this.handlers[name]??=[];this.handlers[name].push(fn);}
  removeEventListener(name,fn){this.handlers[name]=(this.handlers[name]||[]).filter(f=>f!==fn);}
  fire(name,props={}){
    const event={button:0,clientX:0,clientY:0,shiftKey:false,
      stopPropagation(){},preventDefault(){},...props};
    for(const fn of this.handlers[name]||[])fn(event);
  }
}
const find=(root,predicate)=>{
  const result=[];
  const scan=node=>{
    if(predicate(node))result.push(node);
    for(const child of node.children)scan(child);
  };
  scan(root);return result;
};
const cls=(root,name)=>find(root,n=>n.getAttribute("class")?.split(" ").includes(name));
function fixture(raw,{workspaceId=null,failWrites=false,notifyFails=false}={}){
  const document=new FakeDoc(),root=document.createElementNS(NS,"svg");
  const nodeLayer=document.createElementNS(NS,"g"),linkLayer=document.createElementNS(NS,"g");
  root.appendChild(linkLayer);root.appendChild(nodeLayer);
  const backing=new Map();
  if(raw)backing.set(STORAGE_KEY,JSON.stringify(raw));
  const storage={
    getItem:key=>backing.get(key)||null,
    setItem:(key,val)=>{if(failWrites)throw new Error("browser quota exceeded");backing.set(key,val);}
  };
  let canvas,redraws=0,activeWorkspaceId=workspaceId;
  const render=()=>{
    redraws++;canvas.redraw({nodeLayer,linkLayer,workspaceId:activeWorkspaceId});
  };
  canvas=new CapsuleNativeCanvas({doc:document,storage,requestRedraw:render,
    onUpdate:()=>{if(notifyFails)throw new Error("nonessential notification failed");},
    getWorkspaceId:workspaceId===null?undefined:()=>activeWorkspaceId});
  return {document,nodeLayer,linkLayer,root,canvas,render,backing,
    setWorkspace:(id)=>{activeWorkspaceId=id;render();},
    getRedraws:()=>redraws};
}
function makeModel({dataType="core.json@1"}={}){
 const s=new CapsuleStudio(),root=s.createGraph("Root");
 const output=s.createDefinition({name:"Source",language:"python",source:"print('not executed')",
  ports:[{tag:"result",direction:"output",dataType:"core.json@1",semantics:"data"}]});
 const input=s.createDefinition({name:"Sink",language:"rust",source:"// no runtime",
  ports:[{tag:"data",direction:"input",dataType,semantics:"data"}]});
 const a=s.place(root,output.id),b=s.place(root,input.id);
 return {s,root,a,b,snapshot:{model:s.snapshot(),positions:{[root]:{
  [a]:{x:1130,y:210},[b]:{x:1580,y:260}
 }}}};
}
test("native SVG layer mounts inside real Node-RED node/link layer and preserves non-flow siblings",()=>{
 const f=fixture();
 const other=f.document.createElementNS(NS,"g");
 other.setAttribute("class","red-ui-flow-node red-ui-flow-node-group");
 f.nodeLayer.appendChild(other);
 f.render();
 assert.equal(cls(f.nodeLayer,"adamantium-capsule-native-overlay").length,0,"disabled by default");
 f.canvas.setEnabled(true);
 assert.equal(cls(f.nodeLayer,"adamantium-capsule-native-overlay").length,1);
 assert.equal(cls(f.linkLayer,"adamantium-capsule-native-wires").length,1);
 assert.equal(cls(f.nodeLayer,"adamantium-capsule-native-card").length,3);
 assert.equal(cls(f.linkLayer,"adamantium-capsule-native-wire").length,2);
 assert.equal(cls(f.nodeLayer,"red-ui-flow-node-group").length,1,"native nodes remain intact");
 f.canvas.setEnabled(false);
 assert.equal(cls(f.nodeLayer,"adamantium-capsule-native-overlay").length,0);
 assert.equal(cls(f.nodeLayer,"red-ui-flow-node-group").length,1);
});
test("native port picking writes only local typed Capsule graph, not Node-RED flows",()=>{
 const {s,root,a,b,snapshot}=makeModel();
 const f=fixture(snapshot);
 f.canvas.setEnabled(true);
 assert.equal(f.canvas.model().wires.length,0);
 f.canvas.pickPort(a,"result");
 f.canvas.pickPort(b,"data");
 assert.equal(f.canvas.model().wires.length,1);
 assert.equal(s.graph(root).edges.length,0,"input source object remains unmodified");
 const stored=JSON.parse(f.backing.get(STORAGE_KEY));
 assert.equal(CapsuleStudio.restore(stored.model).graph(root).edges.length,1);
 assert.ok(!JSON.stringify(stored.model.graphs).includes("red-ui-flow-node"));
 f.canvas.pickPort(a,"result");
 f.canvas.pickPort(b,"data");
 assert.equal(f.canvas.model().wires.length,1,"duplicate wire not inserted");
 assert.match(f.canvas.notice,/отклонена/);
});
test("wrong semantic input type refuses wire without corrupting model",()=>{
 const {snapshot,a,b}=makeModel({dataType:"core.error@1"});
 const f=fixture(snapshot);
 f.canvas.setEnabled(true);
 f.canvas.pickPort(a,"result");f.canvas.pickPort(b,"data");
 assert.equal(f.canvas.model().wires.length,0);
 assert.match(f.canvas.notice,/тип|typed|mismatch|отклонена/i);
});
test("double click on actual SVG header enters nested graph, breadcrumb back stays navigable",()=>{
 const f=fixture();f.canvas.setEnabled(true);
 const before=f.canvas.model();assert.equal(before.graphPath.length,1);
 const cap=before.cards.find(c=>c.kind==="capsule");
 const nativeCard=cls(f.nodeLayer,"adamantium-capsule-native-card")
  .find(e=>e.getAttribute("data-instance-id")===cap.id);
 const header=cls(nativeCard,"adamantium-capsule-native-header")[0];
 assert.ok(header);
 header.fire("dblclick");
 assert.equal(f.canvas.model().graphPath.length,2);
 assert.equal(cls(f.nodeLayer,"adamantium-capsule-native-card").length,1);
 const controls=cls(f.nodeLayer,"adamantium-capsule-native-control");
 const back=controls[3];
 assert.ok(back);back.fire("click");
 assert.equal(f.canvas.model().graphPath.length,1);
});
test("move event maps drag into native SVG coordinates, persists only at pointer release",()=>{
 const f=fixture();f.canvas.setEnabled(true);
 const model=f.canvas.model(),card=model.cards[0],id=card.id;
 const node=cls(f.nodeLayer,"adamantium-capsule-native-card")[0];
 const header=cls(node,"adamantium-capsule-native-header")[0];
 header.fire("pointerdown",{clientX:100,clientY:150});
 f.document.fire("pointermove",{clientX:150,clientY:180});
 assert.equal(f.canvas.positions[f.canvas.graphId][id].x,card.x+50);
 assert.equal(f.canvas.positions[f.canvas.graphId][id].y,card.y+30);
 f.document.fire("pointerup",{clientX:150,clientY:180});
 const saved=JSON.parse(f.backing.get(STORAGE_KEY));
 assert.equal(saved.positions[f.canvas.graphId][id].x,card.x+50);
 assert.equal(saved.positions[f.canvas.graphId][id].y,card.y+30);
});
test("Shift+click selection triggers extract transaction with stable typed boundary",()=>{
 const f=fixture();f.canvas.setEnabled(true);
 const before=f.canvas.model();
 const selected=before.cards.find(c=>c.kind==="microprogram");
 const node=cls(f.nodeLayer,"adamantium-capsule-native-card")
   .find(e=>e.getAttribute("data-instance-id")===selected.id);
 const header=cls(node,"adamantium-capsule-native-header")[0];
 header.fire("click",{shiftKey:true});
 assert.equal(f.canvas.selected.size,1);
 const result=f.canvas.extract();
 assert.ok(result?.graphId);
 assert.equal(f.canvas.selected.size,0);
 assert.ok(f.canvas.studio.graph(result.graphId).instances.some(i=>i.id===selected.id));
 assert.ok(f.canvas.studio.graph(f.canvas.graphId).instances.some(i=>i.id===result.instanceId));
 assert.equal(f.canvas.model().runtimeActivated,false);
});
test("corrupt storage refuses implicit overwrite and explicit refresh can recover",()=>{
 const f=fixture();
 f.backing.set(STORAGE_KEY,"{invalid JSON");
 f.canvas.refresh();
 assert.match(f.canvas.notice,/повреждены|недоступны/);
 // A corrupt origin is preserved until the user's own sidebar replaces it.
 const original=f.backing.get(STORAGE_KEY);
 f.canvas.addCapsule();
 assert.equal(f.backing.get(STORAGE_KEY),original,"corrupt backup must not silently be destroyed");
});
test("R07 uses explicit hook in native view and plugin resources remain inert",async()=>{
 const nativeView=await readFile(new URL("../../packages/node_modules/@node-red/editor-client/src/js/ui/view.js",import.meta.url),"utf8");
 const hooks=await readFile(new URL("../../packages/node_modules/@node-red/editor-client/src/js/hooks.js",import.meta.url),"utf8");
 assert.match(nativeView,/RED\.hooks\.trigger\("viewRedrawCanvas"/);
 assert.match(hooks,/viewRedrawCanvas: true/);
 assert.doesNotMatch(nativeView,/viewRedrawCanvas[\s\S]{0,180}\/flows/);
});

test("SVG capsule lens remains bound to one native Node-RED workspace tab",()=>{
 const f=fixture(null,{workspaceId:"workspace_a"});
 f.canvas.setEnabled(true);
 assert.equal(cls(f.nodeLayer,"adamantium-capsule-native-card").length,3);
 f.setWorkspace("workspace_b");
 assert.equal(cls(f.nodeLayer,"adamantium-capsule-native-card").length,0);
 assert.equal(cls(f.linkLayer,"adamantium-capsule-native-wire").length,0);
 assert.equal(f.canvas.isEnabled(),true,"state retained for original workspace");
 f.setWorkspace("workspace_a");
 assert.equal(cls(f.nodeLayer,"adamantium-capsule-native-card").length,3);
 f.setWorkspace("workspace_b");
 f.canvas.setEnabled(true);
 assert.equal(cls(f.nodeLayer,"adamantium-capsule-native-card").length,3,
   "explicitly activating SVG in the new tab rebinds the lens");
});

test("browser write failure atomically restores addCapsule and extracted graph edits",()=>{
  const {snapshot,a}=makeModel();
  const f=fixture(snapshot,{failWrites:true});
  const graphId=f.canvas.graphId;
  const before=f.canvas.studio.snapshot();
  const originalPositions=JSON.stringify(f.canvas.positions);
  const result=f.canvas.addCapsule();
  assert.equal(result,null);
  assert.deepEqual(f.canvas.studio.snapshot(),before);
  assert.equal(JSON.stringify(f.canvas.positions),originalPositions);
  assert.match(f.canvas.notice,/Изменения отменены/);
  f.canvas.selected.add(a);
  assert.equal(f.canvas.extract(),null);
  assert.deepEqual(f.canvas.studio.snapshot(),before);
  assert.equal(JSON.stringify(f.canvas.positions),originalPositions);
});
test("failed browser commit does not leave phantom typed edges or port connections",()=>{
  const {snapshot,root,a,b}=makeModel();
  const f=fixture(snapshot,{failWrites:true});
  const before=f.canvas.studio.snapshot();
  f.canvas.pickPort(a,"result");
  f.canvas.pickPort(b,"data");
  assert.equal(f.canvas.studio.graph(root).edges.length,0);
  assert.deepEqual(f.canvas.studio.snapshot(),before);
  assert.match(f.canvas.notice,/Изменения отменены/);
});
test("a failed release of optimistic drag restores original layout coordinates",()=>{
  const f=fixture(null,{failWrites:true});f.canvas.setEnabled(true);
  const model=f.canvas.model(),card=model.cards[0];
  const graphId=f.canvas.graphId;
  const original=JSON.stringify(f.canvas.positions[graphId][card.id]);
  const nativeCard=cls(f.nodeLayer,"adamantium-capsule-native-card")
    .find(x=>x.getAttribute("data-instance-id")===card.id);
  const header=cls(nativeCard,"adamantium-capsule-native-header")[0];
  header.fire("pointerdown",{clientX:100,clientY:150});
  f.document.fire("pointermove",{clientX:165,clientY:192});
  f.document.fire("pointerup",{clientX:165,clientY:192});
  assert.equal(JSON.stringify(f.canvas.positions[graphId][card.id]),original);
  assert.match(f.canvas.notice,/Ошибка сохранения/);
});
test("post-write notification failure never rolls back already persisted graph",()=>{
  const f=fixture(null,{notifyFails:true});
  const before=f.canvas.studio.graph(f.canvas.graphId).instances.length;
  const result=f.canvas.addCapsule();
  assert.ok(result?.graphId);
  assert.equal(f.canvas.studio.graph(f.canvas.graphId).instances.length,before+1);
  const stored=JSON.parse(f.backing.get(STORAGE_KEY));
  assert.equal(stored.model.graphs[f.canvas.graphId].instances.length,before+1);
});
