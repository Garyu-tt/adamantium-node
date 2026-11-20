import test from "node:test";
import assert from "node:assert/strict";
import {CapsuleStudio} from "../../adamantium/capsule-studio.mjs";
import {STORAGE,mountNativeCapsuleWorkspace} from "../../adamantium/capsule-native-canvas.mjs";
class Element {
  constructor(name){this.tagName=name;this.attributes={};this.children=[];this.events={};this.parentNode=null;this.textContent="";}
  setAttribute(name,value){this.attributes[name]=String(value);}
  getAttribute(name){return this.attributes[name]??null;}
  appendChild(child){this.children.push(child);child.parentNode=this;return child;}
  replaceChildren(...children){for(const child of this.children)child.parentNode=null;this.children=[];children.forEach(c=>this.appendChild(c));}
  remove(){if(this.parentNode){this.parentNode.children=this.parentNode.children.filter(c=>c!==this);this.parentNode=null;}}
  addEventListener(type,callback){(this.events[type]??=[]).push(callback);}
  removeEventListener(type,callback){this.events[type]=(this.events[type]||[]).filter(fn=>fn!==callback);}
  emit(type,other={}){
    const evt={type,button:0,shiftKey:false,clientX:0,clientY:0,
      stopPropagation(){},preventDefault(){},...other};
    for(const callback of this.events[type]||[])callback(evt);
  }
  querySelectorAll(selector){
    const matches=[];
    function matchesSelector(node){
      if(selector.startsWith("."))return (node.attributes.class||"").split(/\s+/).includes(selector.slice(1));
      if(selector.startsWith("[data-")){
        const m=/^\[([^=]+)="([^"]+)"\]$/.exec(selector);
        return m&&node.attributes[m[1]]===m[2];
      }
      return false;
    }
    function traverse(node){for(const child of node.children){if(matchesSelector(child))matches.push(child);traverse(child);}}
    traverse(this);
    return matches;
  }
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
}
function fakeBrowser(data=null){
 const stage=new Element("g");
 const documentRef={
  querySelector:q=>q==="#red-ui-workspace-chart svg .red-ui-workspace-chart-event-layer"?stage:null,
  createElementNS:(namespace,tag)=>{assert.equal(namespace,"http://www.w3.org/2000/svg");return new Element(tag);}
 };
 const listeners={};
 const windowRef={
  prompt:()=> "New capsule",
  addEventListener:(name,callback)=>{(listeners[name]??=[]).push(callback);},
  removeEventListener:(name,callback)=>{listeners[name]=(listeners[name]||[]).filter(c=>c!==callback);},
  emit:(name,event)=>{for(const callback of listeners[name]||[])callback(event);}
 };
 const store=new Map();
 if(data)store.set(STORAGE,JSON.stringify(data));
 const storage={
  getItem:key=>store.get(key)??null,
  setItem:(key,value)=>store.set(key,value)
 };
 return {stage,documentRef,windowRef,storage,store,listeners};
}
function modelWithOpenWire(){
 const studio=new CapsuleStudio(),root=studio.createGraph("Root");
 const d=studio.createDefinition({name:"JSON",language:"python",source:"def run(x):return x",
  ports:[{tag:"input",direction:"input",dataType:"core.json@1",semantics:"data"},
    {tag:"output",direction:"output",dataType:"core.json@1",semantics:"data"}]});
 const a=studio.place(root,d.id),b=studio.place(root,d.id);
 return {studio,root,a,b,data:{model:studio.snapshot(),
  positions:{[root]:{[a]:{x:120,y:200},[b]:{x:500,y:200}}}}};
}
function portHit(stage,instanceId,tag){
 const card=stage.querySelector('[data-instance-id="'+instanceId+'"]');
 assert.ok(card,"card exists "+instanceId);
 const p=card.querySelector('[data-port-tag="'+tag+'"]');
 assert.ok(p,"port exists "+tag);
 const hit=p.children.find(x=>x.tagName==="circle"&&x.getAttribute("pointer-events")==="all");
 assert.ok(hit,"large pointer target exists");
 return hit;
}
function actionHit(stage,name){
 const g=stage.querySelector('[data-action="'+name+'"]');
 assert.ok(g,"action "+name);
 return g.children.find(x=>x.getAttribute("pointer-events")==="all");
}
test("R07 mounts inside real Node-RED SVG event layer, never in iframe or native flows",()=>{
 const b=fakeBrowser();
 const controller=mountNativeCapsuleWorkspace(b);
 try{
  assert.equal(b.stage.children.length,1);
  const layer=b.stage.querySelector(".adamantium-native-capsule-layer");
  assert.ok(layer);
  assert.equal(layer.getAttribute("data-authority"),"none");
  assert.equal(layer.getAttribute("data-runtime"),"disabled");
  assert.equal(layer.querySelectorAll(".adamantium-native-capsule-card").length,2);
  assert.equal(layer.querySelectorAll(".adamantium-native-wire").length,1);
  assert.equal(controller.inspect().runtimeActivated,false);
  assert.throws(()=>mountNativeCapsuleWorkspace(b),/already mounted/);
 }finally{controller.close();}
 assert.equal(b.stage.children.length,0);
});
test("clicking two typed native SVG port hitboxes creates one edge in shared draft storage",()=>{
 const o=modelWithOpenWire(),b=fakeBrowser(o.data);
 const controller=mountNativeCapsuleWorkspace(b);
 try{
  assert.equal(controller.inspect().edges,0);
  portHit(b.stage,o.a,"output").emit("click");
  portHit(b.stage,o.b,"input").emit("click");
  assert.equal(controller.inspect().edges,1);
  const persisted=JSON.parse(b.store.get(STORAGE));
  const restored=CapsuleStudio.restore(persisted.model);
  assert.equal(restored.graph(o.root).edges.length,1);
  assert.equal(b.stage.querySelectorAll(".adamantium-native-wire").length,1);
  // No source code was evaluated; the model is inert.
  assert.equal(controller.inspect().runtimeActivated,false);
 }finally{controller.close();}
});
test("incompatible same-direction native ports are rejected without mutating stored snapshot",()=>{
 const o=modelWithOpenWire(),b=fakeBrowser(o.data),controller=mountNativeCapsuleWorkspace(b);
 try{
  const before=b.store.get(STORAGE);
  portHit(b.stage,o.a,"output").emit("click");
  portHit(b.stage,o.b,"output").emit("click");
  assert.equal(controller.inspect().edges,0);
  assert.equal(b.store.get(STORAGE),before);
 }finally{controller.close();}
});
test("native action creates capsule and double click navigates recursively",()=>{
 const o=modelWithOpenWire(),b=fakeBrowser(o.data),controller=mountNativeCapsuleWorkspace(b);
 try{
  actionHit(b.stage,"+ Capsule").emit("click");
  assert.equal(controller.inspect().nodes,3);
  const raw=JSON.parse(b.store.get(STORAGE));
  const cap=raw.model.graphs[o.root].instances.find(n=>n.kind==="capsule");
  assert.ok(cap);
  const handle=b.stage.querySelector('[data-drag-handle="'+cap.id+'"]');
  handle.emit("dblclick");
  assert.equal(controller.inspect().activeGraph,cap.childGraphId);
  assert.equal(b.stage.querySelectorAll(".adamantium-native-portal").length,4);
  actionHit(b.stage,"← Back").emit("click");
  assert.equal(controller.inspect().activeGraph,o.root);
 }finally{controller.close();}
});
test("native SVG draft receives localStorage sync from existing R02 sidebar preview",()=>{
 const o=modelWithOpenWire(),b=fakeBrowser(o.data),controller=mountNativeCapsuleWorkspace(b);
 try{
  const updated=CapsuleStudio.restore(o.data.model);
  updated.place(o.root,updated.graph(o.root).instances[0].definitionId);
  b.store.set(STORAGE,JSON.stringify({model:updated.snapshot(),positions:o.data.positions}));
  b.windowRef.emit("storage",{key:STORAGE});
  assert.equal(controller.inspect().nodes,3);
 }finally{controller.close();}
 assert.equal(b.listeners.storage.length,0);
});
test("malformed persisted draft does not overwrite it or grant execution",()=>{
 const b=fakeBrowser();
 b.store.set(STORAGE,"{corrupt");
 const c=mountNativeCapsuleWorkspace(b);
 try{
  assert.equal(c.inspect().nodes,2);
  assert.equal(c.inspect().authority,"none");
  assert.equal(b.store.get(STORAGE),"{corrupt");
 }finally{c.close();}
});

test("dragging a native SVG card persists graph-scoped coordinates without changing flow model",()=>{
 const o=modelWithOpenWire(),b=fakeBrowser(o.data);
 const controller=mountNativeCapsuleWorkspace(b);
 try{
  const handle=b.stage.querySelector('[data-drag-handle="'+o.a+'"]');
  assert.ok(handle);
  handle.emit("pointerdown",{button:0,clientX:100,clientY:120});
  b.windowRef.emit("pointermove",{clientX:185,clientY:165});
  b.windowRef.emit("pointerup",{});
  const saved=JSON.parse(b.store.get(STORAGE));
  assert.equal(saved.positions[o.root][o.a].x,205);
  assert.equal(saved.positions[o.root][o.a].y,245);
  assert.deepEqual(saved.model,o.studio.snapshot());
 }finally{controller.close();}
});
test("extract selection action moves selected native cards atomically into one recursive capsule",()=>{
 const o=modelWithOpenWire(),b=fakeBrowser(o.data),controller=mountNativeCapsuleWorkspace(b);
 try{
  b.stage.querySelector('[data-drag-handle="'+o.a+'"]').emit("pointerdown",{shiftKey:true});
  b.stage.querySelector('[data-drag-handle="'+o.b+'"]').emit("pointerdown",{shiftKey:true});
  actionHit(b.stage,"Extract 2").emit("click");
  assert.equal(controller.inspect().nodes,1);
  const saved=JSON.parse(b.store.get(STORAGE));
  const restored=CapsuleStudio.restore(saved.model);
  const capsule=restored.graph(o.root).instances[0];
  assert.equal(capsule.kind,"capsule");
  assert.equal(restored.graph(capsule.childGraphId).instances.length,2);
  assert.equal(restored.graph(capsule.childGraphId).edges.length,0);
  assert.equal(controller.inspect().runtimeActivated,false);
 }finally{controller.close();}
});

test("native draft layer intercepts dangerous flow shortcuts and unregisters on close",()=>{
 const b=fakeBrowser(),controller=mountNativeCapsuleWorkspace(b);
 let prevented=false,stopped=false;
 b.windowRef.emit("keydown",{
   key:"Delete",ctrlKey:false,metaKey:false,
   target:{tagName:"BODY"},
   stopImmediatePropagation(){stopped=true;},
   stopPropagation(){},
   preventDefault(){prevented=true;}
 });
 assert.equal(prevented,true,"native Delete is blocked while draft is active");
 assert.equal(stopped,true,"native editor hotkey listeners do not receive Delete");
 assert.equal(b.listeners.keydown.length,1);
 controller.close();
 assert.equal(b.listeners.keydown.length,0);
});
