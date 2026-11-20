import test from "node:test";
import assert from "node:assert/strict";
import {CapsuleStudio} from "../../adamantium/capsule-studio.mjs";
import {projectNativeCanvas} from "../../adamantium/capsule-native-canvas.mjs";
import {createNativeCanvasLens} from "../../adamantium/capsule-native-canvas-lens.mjs";
const p=(tag,direction)=>({tag,direction,semantics:"data",dataType:"core.json@1"});

class FakeElement {
  constructor(ownerDocument,tag){
    this.ownerDocument=ownerDocument;this.tagName=tag;this.children=[];
    this.events={};this.attrs={};this.style={};this.dataset={};this.textContent="";
    this.ownerSVGElement=ownerDocument.svg;
  }
  appendChild(element){this.children.push(element);return element;}
  replaceChildren(...items){this.children=[...items];}
  setAttribute(name,value){
    this.attrs[name]=String(value);
    if(name.startsWith("data-")){
      const camel=name.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase());
      this.dataset[camel]=String(value);
    }
  }
  addEventListener(name,fn){this.events[name]=fn;}
  getScreenCTM(){return {inverse:()=>({})};}
  walk(predicate){
    if(predicate(this))return this;
    for(const child of this.children){const match=child.walk(predicate);if(match)return match;}
    return null;
  }
}
function fakeEditor(){
  const win={
    events:new Map(),
    addEventListener(name,fn){this.events.set(name,fn);},
    removeEventListener(name){this.events.delete(name);},
    trigger(name,event){this.events.get(name)?.(event);}
  };
  const document={
    defaultView:win,svg:{createSVGPoint(){
      return {x:0,y:0,matrixTransform(){return {x:this.x,y:this.y};}};
    }},
    createElementNS(_,tag){return new FakeElement(document,tag);}
  };
  const links=new FakeElement(document,"g");
  const nodes=new FakeElement(document,"g");
  let workspace="flow_1",onWorkspace;
  const RED={
    view:{capsuleCanvas:{layers:()=>({nodes,links})}},
    workspaces:{active:()=>workspace},
    events:{on(name,fn){if(name==="workspace:change")onWorkspace=fn;}}
  };
  return {RED,links,nodes,win,
    setWorkspace(next){workspace=next;onWorkspace?.({new:next});}};
}
function sample(){
  const s=new CapsuleStudio(),root=s.createGraph("Root");
  const d=s.createDefinition({name:"JSON handler",language:"python",
    source:"SECRET_CODE_DO_NOT_PAINT",ports:[p("input","input"),p("output","output")]});
  const a=s.place(root,d.id),b=s.place(root,d.id);
  const capsule=s.createCapsule(root,"Nested engine");
  const child=s.place(capsule.graphId,d.id);
  s.expose(capsule.graphId,{side:"west",instanceId:child,tag:"input",externalTag:"in"});
  s.expose(capsule.graphId,{side:"east",instanceId:child,tag:"output",externalTag:"out"});
  s.connect(root,{fromId:a,fromTag:"output",toId:capsule.instanceId,toTag:"in"});
  s.connect(root,{fromId:capsule.instanceId,fromTag:"out",toId:b,toTag:"input"});
  return {projection:projectNativeCanvas(s,{graphId:root}),a,b,capsule};
}
function event(extra={}){
  return {button:0,clientX:100,clientY:100,
    preventDefault(){},stopPropagation(){},...extra};
}
test("actual Node-RED SVG layer API paints independent capsule cards and tagged wire paths",()=>{
  const editor=fakeEditor(),{projection,a,capsule}=sample();
  const lens=createNativeCanvasLens({RED:editor.RED});
  lens.setProjection(projection);
  assert.equal(editor.nodes.children.length,0,"disabled lens does not paint");
  assert.equal(lens.show(true),true);
  assert.equal(editor.nodes.children.length,3);
  assert.equal(editor.links.children.length,2);
  assert.equal(editor.nodes.attrs["data-capsule-active"],"true");
  const capsuleNode=editor.nodes.walk(n=>n.attrs["data-capsule-node-id"]===capsule.instanceId);
  assert.ok(capsuleNode);
  const west=capsuleNode.walk(n=>n.attrs["data-capsule-port-tag"]==="in");
  const east=capsuleNode.walk(n=>n.attrs["data-capsule-port-tag"]==="out");
  assert.equal(west.attrs["data-capsule-side"],"west");
  assert.equal(east.attrs["data-capsule-side"],"east");
  assert.ok(editor.links.children.every(w=>w.attrs.d?.includes(" C ")));
  assert.equal(lens.status().deployable,false);
  assert.equal(lens.status().executable,false);
  assert.ok(!JSON.stringify(editor.nodes).includes("SECRET_CODE_DO_NOT_PAINT"));
  lens.clear();
  assert.equal(editor.nodes.children.length,0);
  assert.equal(editor.links.children.length,0);
});
test("native port click hit-tests stable tags, not overloaded numbered Node-RED outputs",()=>{
  const editor=fakeEditor(),{projection,a,capsule}=sample(),connections=[],warnings=[];
  const lens=createNativeCanvasLens({
    RED:editor.RED,onConnect:entry=>connections.push(entry),
    onWarning:message=>warnings.push(message)
  });
  lens.setProjection(projection);lens.show(true);
  const source=editor.nodes.walk(n=>n.attrs["data-capsule-node-id"]===a);
  const target=editor.nodes.walk(n=>n.attrs["data-capsule-node-id"]===capsule.instanceId);
  const out=source.walk(n=>n.attrs["data-capsule-port-tag"]==="output");
  const inp=target.walk(n=>n.attrs["data-capsule-port-tag"]==="in");
  out.events.click(event());
  assert.equal(out.attrs["data-capsule-selected"],"true");
  inp.events.click(event());
  assert.deepEqual(connections,[{
    graphId:projection.graphId,fromId:a,fromTag:"output",
    toId:capsule.instanceId,toTag:"in"
  }]);
  // An input cannot be used as an initial source.
  inp.events.click(event());
  assert.match(warnings.at(-1),/source output/);
});
test("double-click navigation and actual native-pointer drag produce scoped authoring intents",()=>{
  const editor=fakeEditor(),{projection,capsule}=sample(),moves=[],navigation=[];
  const lens=createNativeCanvasLens({RED:editor.RED,
    onNavigate:value=>navigation.push(value),onMove:value=>moves.push(value)});
  lens.setProjection(projection);lens.show(true);
  const group=editor.nodes.walk(n=>n.attrs["data-capsule-node-id"]===capsule.instanceId);
  const background=group.walk(n=>n.attrs["class"]==="red-ui-capsule-native-background");
  background.events.dblclick(event());
  assert.deepEqual(navigation,[{
    graphId:projection.graphId,childGraphId:capsule.graphId,nodeId:capsule.instanceId
  }]);
  const n=projection.nodes.find(n=>n.id===capsule.instanceId);
  background.events.pointerdown(event({clientX:100,clientY:100}));
  editor.win.trigger("pointermove",event({clientX:132,clientY:146}));
  editor.win.trigger("pointerup",event({clientX:132,clientY:146}));
  assert.deepEqual(moves,[{graphId:projection.graphId,nodeId:n.id,x:n.x+32,y:n.y+46}]);
});
test("switching Node-RED workspace hides independent lens and does not mutate its flow",()=>{
  const editor=fakeEditor(),{projection}=sample();
  const lens=createNativeCanvasLens({RED:editor.RED});
  lens.setProjection(projection);
  lens.show(true);
  editor.setWorkspace("unrelated_flow");
  assert.equal(lens.isVisible(),false);
  assert.equal(editor.nodes.style.display,"none");
  assert.equal(editor.links.style.display,"none");
  editor.setWorkspace("flow_1");
  assert.equal(lens.isVisible(),true);
  assert.equal(editor.nodes.style.display,"");
});
test("lens rejects forged projection with hidden code before creating any SVG children",()=>{
  const editor=fakeEditor(),{projection}=sample();
  const lens=createNativeCanvasLens({RED:editor.RED});
  const malicious=structuredClone(projection);
  malicious.nodes[0].source="evil";
  assert.throws(()=>lens.setProjection(malicious),/invalid node fields/);
  assert.equal(editor.nodes.children.length,0);
});
