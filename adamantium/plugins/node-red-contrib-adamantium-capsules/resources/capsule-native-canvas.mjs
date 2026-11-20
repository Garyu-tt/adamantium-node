/**
 * Adamantium-node R07 native SVG workspace — source-only Capsule lens.
 *
 * Renders inside the real Node-RED editor SVG event layer. It does NOT create
 * RED.nodes instances, alter /flows, call deploy or execute language programs.
 * The dedicated layer captures pointer interaction only while enabled.
 * SPDX-License-Identifier: Apache-2.0
 */
import {CapsuleStudio} from "./capsule-studio.mjs";
import {extractSelection} from "./capsule-extract.mjs";
import {layoutCapsuleGraph} from "./capsule-native-layout.mjs";

export const STORAGE="adamantium.capsule-studio.r01";
const NS="http://www.w3.org/2000/svg";
const T={
  background:"var(--red-ui-primary-background-color,#18222d)",
  card:"var(--red-ui-secondary-background-color,#253645)",
  border:"var(--red-ui-form-input-border-color,#718496)",
  text:"var(--red-ui-primary-text-color,#e8eef5)",
  accent:"var(--red-ui-button-background-color,#70b1d8)",
  dim:"var(--red-ui-secondary-text-color,#b7c8d6)"
};
const integer=(n,a,b)=>Math.min(b,Math.max(a,Number.isFinite(Number(n))?Number(n):a));
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
function sanePositionMap(positions,model) {
  const safe={};
  if(!positions||typeof positions!=="object")return safe;
  for(const [graphId,rows] of Object.entries(positions)){
    if(!own(model.graphs,graphId)||!rows||typeof rows!=="object")continue;
    safe[graphId]={};
    for(const [id,p] of Object.entries(rows)){
      if(!model.graph(graphId).instances.some(i=>i.id===id)||!p||typeof p!=="object")continue;
      safe[graphId][id]={x:integer(p.x,32,7900),y:integer(p.y,40,7900)};
    }
  }
  return safe;
}
function starter(){
  const s=new CapsuleStudio(),root=s.createGraph("Capsule draft");
  const d=s.createDefinition({name:"Sample passthrough",language:"python",
    source:"def run(data): return data",ports:[
      {tag:"data",direction:"input",semantics:"data",dataType:"core.json@1"},
      {tag:"result",direction:"output",semantics:"data",dataType:"core.json@1"}
    ]});
  const a=s.place(root,d.id),b=s.createCapsule(root,"Subsystem");
  const inside=s.place(b.graphId,d.id);
  s.expose(b.graphId,{side:"west",instanceId:inside,tag:"data",externalTag:"in"});
  s.expose(b.graphId,{side:"east",instanceId:inside,tag:"result",externalTag:"out"});
  s.connect(root,{fromId:a,fromTag:"result",toId:b.instanceId,toTag:"in"});
  return {model:s,positions:{[root]:{[a]:{x:220,y:300},[b.instanceId]:{x:610,y:300}}},templates:undefined};
}
/**
 * Mount on #red-ui-workspace-chart svg g.red-ui-workspace-chart-event-layer.
 * This is the real native SVG scene, not a second iframe/canvas.
 */
export function mountNativeCapsuleWorkspace({
  documentRef=document,windowRef=window,storage=window.localStorage
}={}) {
  const stage=documentRef.querySelector(
    "#red-ui-workspace-chart svg .red-ui-workspace-chart-event-layer"
  );
  if(!stage)throw new Error("Native Node-RED SVG workspace not initialized");
  if(stage.querySelector(".adamantium-native-capsule-layer"))
    throw new Error("Native Capsule workspace already mounted");
  const layer=documentRef.createElementNS(NS,"g");
  layer.setAttribute("class","adamantium-native-capsule-layer");
  layer.setAttribute("data-authority","none");
  layer.setAttribute("data-runtime","disabled");
  layer.setAttribute("role","group");
  layer.setAttribute("aria-label","Capsule Studio draft graph on native Node-RED SVG canvas");
  stage.appendChild(layer);
  let snapshot,model,positions,templates,activeGraph,selectedPort=null;
  const expanded=new Set(),selected=new Set();
  let status="Черновик: изменения не передаются в исполняемые flow Node-RED.";
  let closed=false,drag=null;
  function svg(tag,attrs={},textValue){
    const el=documentRef.createElementNS(NS,tag);
    for(const [key,value] of Object.entries(attrs))el.setAttribute(key,String(value));
    if(textValue!==undefined)el.textContent=String(textValue);
    return el;
  }
  function append(parent,...children){for(const child of children)parent.appendChild(child);return children.length===1?children[0]:parent;}
  function text(parent,x,y,value,attrs={}){
    parent.appendChild(svg("text",{
      x,y,fill:T.text,"font-size":12,"font-family":"sans-serif",
      "pointer-events":"none",...attrs
    },value));
  }
  function rect(parent,x,y,width,height,options={}){
    return append(parent,svg("rect",{
      x,y,width,height,rx:options.rx??9,fill:options.fill??T.card,
      stroke:options.stroke??T.border,"stroke-width":options.strokeWidth??1
    }));
  }
  function notify(message,error=false){
    status=(error?"Ошибка: ":"")+String(message).slice(0,220);
  }
  function load(preserve=true){
    const previous=activeGraph;
    try{
      const data=JSON.parse(storage.getItem(STORAGE));
      if(!data||typeof data!=="object")throw new TypeError("missing persisted draft");
      const restored=CapsuleStudio.restore(data.model);
      model=restored;positions=sanePositionMap(data.positions,restored);
      templates=data.templates;
      snapshot=data;
    }catch(error){
      if(model && preserve){notify("Не удалось прочитать обновление: "+error.message,true);return;}
      const initial=starter();
      model=initial.model;positions=initial.positions;templates=initial.templates;
      notify("Создан локальный демонстрационный граф; он пока не сохранён.");
    }
    activeGraph=preserve&&previous&&model.graphs[previous]?previous:model.rootGraphId;
    selected.clear();selectedPort=null;
  }
  function persist(){
    const data={model:model.snapshot(),positions};
    if(templates!==undefined)data.templates=templates;
    storage.setItem(STORAGE,JSON.stringify(data));
    snapshot=data;
  }
  function transact(operation,message){
    if(closed)throw new Error("Capsule workspace closed");
    const beforeModel=model.snapshot();
    const beforePositions=JSON.parse(JSON.stringify(positions));
    try{
      const result=operation();
      // Fail closed against invalid editor manipulations before saving.
      CapsuleStudio.restore(model.snapshot());
      persist();
      if(message)notify(message);
      render();
      return result;
    }catch(error){
      model=CapsuleStudio.restore(beforeModel);positions=beforePositions;
      notify(error.message,true);render();return null;
    }
  }
  function chooseGraph(id){
    try{model.graph(id);activeGraph=id;selected.clear();selectedPort=null;render();}
    catch(err){notify(err.message,true);render();}
  }
  function addButton(host,x,y,width,label,handler){
    const g=append(host,svg("g",{"class":"adamantium-native-action","data-action":label,
      transform:"translate("+x+","+y+")"}));
    rect(g,0,0,width,30,{fill:T.card});
    text(g,12,20,label,{"font-size":12});
    const hit=append(g,svg("rect",{x:0,y:0,width,height:30,fill:"transparent",
      "pointer-events":"all"}));
    hit.addEventListener("click",event=>{event.preventDefault();event.stopPropagation();handler();});
    return g;
  }
  function portClicked(node,port){
    if(!selectedPort){
      selectedPort={instanceId:node.id,tag:port.tag,direction:port.direction};
      notify("Выбран порт "+port.tag+"; укажи совместимый порт.");render();return;
    }
    const first=selectedPort;
    selectedPort=null;
    if(first.instanceId===node.id&&first.tag===port.tag){render();return;}
    const second={instanceId:node.id,tag:port.tag,direction:port.direction};
    const from=first.direction==="output"?first:second;
    const to=first.direction==="input"?first:second;
    transact(()=>model.connect(activeGraph,{
      fromId:from.instanceId,fromTag:from.tag,toId:to.instanceId,toTag:to.tag
    }),"Типизированное соединение создано. Runtime не затронут.");
  }
  function pointerPoint(event){
    const ctm=layer.getScreenCTM?.();
    if(!ctm||typeof ctm.inverse!=="function")
      return {x:event.clientX,y:event.clientY};
    const owner=layer.ownerSVGElement;
    if(owner&&typeof owner.createSVGPoint==="function"){
      const point=owner.createSVGPoint();point.x=event.clientX;point.y=event.clientY;
      return point.matrixTransform(ctm.inverse());
    }
    if(typeof windowRef.DOMPoint==="function"){
      const point=new windowRef.DOMPoint(event.clientX,event.clientY);
      return point.matrixTransform(ctm.inverse());
    }
    return {x:event.clientX,y:event.clientY};
  }
  function pointerMove(event){
    if(!drag)return;
    if(drag.graphId!==activeGraph){drag=null;return;}
    const p=pointerPoint(event);
    const previous=positions[activeGraph]?.[drag.id]||drag.start;
    positions[activeGraph]??={};
    positions[activeGraph][drag.id]={
      x:integer(drag.start.x+p.x-drag.origin.x,32,7900),
      y:integer(drag.start.y+p.y-drag.origin.y,40,7900)
    };
    if(previous.x!==positions[activeGraph][drag.id].x||previous.y!==positions[activeGraph][drag.id].y)
      render();
  }
  function pointerEnd(){
    if(!drag)return;
    drag=null;
    try{persist();notify("Положение ноды сохранено локально.");render();}
    catch(err){notify(err.message,true);render();}
  }
  function attachDrag(header,node){
    header.addEventListener("pointerdown",event=>{
      event.stopPropagation();
      if(event.button!==0)return;
      if(event.shiftKey){
        if(selected.has(node.id))selected.delete(node.id);else selected.add(node.id);
        render();return;
      }
      event.preventDefault();
      positions[activeGraph]??={};
      const p=positions[activeGraph][node.id]||{x:node.x,y:node.y};
      drag={id:node.id,graphId:activeGraph,origin:pointerPoint(event),start:{x:p.x,y:p.y}};
    });
    if(node.kind==="capsule"){
      header.addEventListener("dblclick",event=>{
        event.preventDefault();event.stopPropagation();
        drag=null;chooseGraph(node.childGraphId);
      });
    }
  }
  function drawCard(parent,node){
    const group=append(parent,svg("g",{
      "class":"adamantium-native-capsule-card",
      "data-instance-id":node.id,"data-kind":node.kind,
      transform:"translate("+node.x+","+node.y+")"
    }));
    rect(group,0,0,node.width,node.height,{
      fill:T.card,stroke:selected.has(node.id)?T.accent:T.border,
      strokeWidth:selected.has(node.id)?3:1
    });
    rect(group,0,0,node.width,42,{fill:T.background,stroke:T.border,rx:8});
    text(group,14,25,node.title.length>35?node.title.slice(0,32)+"…":node.title,{
      "font-size":14,"font-weight":"bold"
    });
    text(group,16,70,node.subtitle,{fill:T.dim,"font-size":11});
    text(group,16,node.height-13,node.kind==="capsule"?"Double-click to enter":"Definition source shared",{
      fill:T.dim,"font-size":10
    });
    const header=append(group,svg("rect",{
      x:0,y:0,width:node.width,height:42,fill:"transparent",
      "pointer-events":"all","data-drag-handle":node.id
    }));
    attachDrag(header,node);
    for(const side of ["north","east","south","west"]){
      const ports=node.sides[side],shown=node.visibility[side].shown;
      for(const [index,port] of ports.entries()){
        const anchor=node.anchors[port.tag];
        if(index>=shown)continue;
        const localX=anchor.x-node.x,localY=anchor.y-node.y;
        const root=append(group,svg("g",{
          "class":"adamantium-native-port",
          "data-port-tag":port.tag,"data-side":side,"data-direction":port.direction,
          transform:"translate("+localX+","+localY+")"
        }));
        append(root,svg("circle",{
          cx:0,cy:0,r:6,fill:port.direction==="output"?T.accent:T.background,
          stroke:T.accent,"stroke-width":2
        }));
        const tooltip=append(root,svg("title",{},port.tag+" · "+port.dataType+
          " · "+port.semantics+" · "+port.direction));
        const hit=append(root,svg("circle",{
          cx:0,cy:0,r:12,fill:"transparent","pointer-events":"all"
        }));
        hit.addEventListener("pointerdown",e=>{e.stopPropagation();});
        hit.addEventListener("click",e=>{
          e.preventDefault();e.stopPropagation();portClicked(node,port);
        });
      }
      const hidden=node.visibility[side].hidden;
      const expandedCount=node.visibility[side].expanded;
      if(hidden||expandedCount&&ports.length>4){
        const x=side==="west"?7:side==="east"?node.width-55:node.width-73;
        const y=side==="north"?8:side==="south"?node.height-30:node.height-48;
        addButton(group,x,y,side==="west"?56:60,
          hidden?"+"+hidden:"−",()=>{
            const key=node.id+":"+side;
            if(expanded.has(key))expanded.delete(key);else expanded.add(key);
            render();
          });
      }
    }
    return group;
  }
  function drawPortal(parent,p,at){
    if(!p.returnTo)return;
    const group=append(parent,svg("g",{
      "class":"adamantium-native-portal","data-side":p.side,
      transform:"translate("+at.x+","+at.y+")"
    }));
    rect(group,0,0,146,56,{stroke:T.accent,fill:T.background});
    text(group,10,20,p.side.toUpperCase()+" ↶",{"font-weight":"bold"});
    text(group,10,40,p.visible.length+" ports"+(p.hiddenCount?" +"+p.hiddenCount:""),{
      "font-size":10,fill:T.dim
    });
    const hit=append(group,svg("rect",{x:0,y:0,width:146,height:56,
      fill:"transparent","pointer-events":"all"}));
    hit.addEventListener("click",e=>{
      e.stopPropagation();chooseGraph(p.returnTo);
    });
  }
  function drawToolbar(parent,layout){
    const toolbar=append(parent,svg("g",{
      "class":"adamantium-native-toolbar",
      transform:"translate(58,48)"
    }));
    rect(toolbar,-12,-30,1040,110,{fill:T.background,stroke:T.accent});
    text(toolbar,0,-7,"CAPSULE DRAFT · INERT SVG LENS · NO DEPLOY",{
      fill:T.accent,"font-size":12,"font-weight":"bold"
    });
    text(toolbar,0,16,model.path(activeGraph).map(x=>x.title).join(" › ").slice(0,95),{
      "font-size":14
    });
    const buttons=[
      ["← Back",()=>layout.parentGraphId&&chooseGraph(layout.parentGraphId),92],
      ["Root",()=>chooseGraph(model.rootGraphId),75],
      ["+ Capsule",()=>{
        const name=windowRef.prompt("Название контейнера","Новый контейнер");
        if(name===null)return;
        transact(()=>{
          const instance=model.createCapsule(activeGraph,name);
          positions[activeGraph]??={};
          positions[activeGraph][instance.instanceId]={x:420,y:420};
        },"Вложенный граф создан без запуска.");
      },110],
      ["Extract "+selected.size,()=>{
        if(!selected.size){notify("Shift+клик для выбора нескольких карточек.",true);render();return;}
        const title=windowRef.prompt("Имя извлечённого графа","Extracted capsule");
        if(title===null)return;
        transact(()=>{
          const ids=Array.from(selected);
          const pts=ids.map(id=>positions[activeGraph]?.[id]||{x:180,y:200});
          const cx=Math.round(pts.reduce((s,p)=>s+p.x,0)/pts.length);
          const cy=Math.round(pts.reduce((s,p)=>s+p.y,0)/pts.length);
          const before=activeGraph,extracted=extractSelection(model,before,ids,title);
          positions[before]??={};
          positions[before][extracted.instanceId]={x:cx,y:cy};
          positions[extracted.graphId]??={};
          for(const id of ids){
            if(positions[before][id])positions[extracted.graphId][id]=positions[before][id];
            delete positions[before][id];
          }
          selected.clear();
        },"Экстракция и типизированные связи сохранены.");
      },112],
      ["Reload",()=>{load();render();},85],
      ["Close",()=>close(),83]
    ];
    let x=0;
    for(const [caption,callback,width] of buttons){
      addButton(toolbar,x,30,width,caption,callback);x+=width+7;
    }
    text(toolbar,0,98,status,{"font-size":11,fill:T.dim});
  }
  function render(){
    if(closed)return;
    const layout=layoutCapsuleGraph(model,activeGraph,positions[activeGraph]||{},expanded);
    layer.replaceChildren();
    const ground=append(layer,svg("rect",{
      x:0,y:0,width:8000,height:8000,
      fill:T.background,stroke:"none","pointer-events":"all",
      "class":"adamantium-native-draft-background"
    }));
    for(const name of ["pointerdown","mousedown","mouseup","dblclick","touchstart"]){
      ground.addEventListener(name,event=>event.stopPropagation());
    }
    ground.addEventListener("click",()=>{selectedPort=null;selected.clear();render();});
    const wires=append(layer,svg("g",{"class":"adamantium-native-wires"}));
    for(const edge of layout.edges){
      const path=append(wires,svg("path",{
        "class":"adamantium-native-wire","data-edge-id":edge.id,
        d:edge.path,fill:"none",stroke:T.accent,"stroke-width":2,
        "pointer-events":"none"
      }));
      path.setAttribute("aria-label",edge.fromTag+" to "+edge.toTag);
    }
    const cards=append(layer,svg("g",{"class":"adamantium-native-cards"}));
    for(const node of layout.nodes)drawCard(cards,node);
    if(layout.parentGraphId){
      const at={north:{x:1000,y:175},east:{x:1530,y:450},
        south:{x:1000,y:1000},west:{x:35,y:450}};
      for(const p of layout.boundary)drawPortal(layer,p,at[p.side]);
    }
    drawToolbar(layer,layout);
    layer.setAttribute("data-active-graph",activeGraph);
    layer.setAttribute("data-instance-count",String(layout.nodes.length));
    layer.setAttribute("data-edge-count",String(layout.edges.length));
  }
  function storageChanged(event){
    if(event.key===STORAGE){load();render();}
  }
  function swallow(event){
    // Do not send native Node-RED canvas mouse events through the draft lens.
    event.stopPropagation();
  }
  function protectNativeFlowShortcuts(event){
    if(closed)return;
    const target=event.target;
    const tag=String(target?.tagName||"").toLowerCase();
    // Preserve inputs, forms and accessibility navigation outside workspace.
    if(["input","textarea","select","button"].includes(tag)||
      target?.isContentEditable||event.key==="Tab"||event.key==="F5"||
      (event.ctrlKey||event.metaKey)&&event.key?.toLowerCase()==="r")return;
    // Native flow Delete / Deploy / clipboard shortcuts must never act on
    // previously selected Node-RED flow nodes behind the Capsule overlay.
    event.stopImmediatePropagation?.();
    event.stopPropagation();
    if(["Delete","Backspace"," ","Enter"].includes(event.key)||
      event.ctrlKey||event.metaKey)event.preventDefault();
    if(event.key==="Escape"){
      selectedPort=null;selected.clear();render();
    }
  }
  for(const event of ["mousedown","mouseup","mousemove","dblclick","pointerdown","touchstart"]){
    layer.addEventListener(event,swallow);
  }
  windowRef.addEventListener("keydown",protectNativeFlowShortcuts,true);
  windowRef.addEventListener("storage",storageChanged);
  windowRef.addEventListener("pointermove",pointerMove);
  windowRef.addEventListener("pointerup",pointerEnd);
  windowRef.addEventListener("pointercancel",pointerEnd);
  function close(){
    if(closed)return;
    closed=true;drag=null;
    windowRef.removeEventListener("keydown",protectNativeFlowShortcuts,true);
    windowRef.removeEventListener("storage",storageChanged);
    windowRef.removeEventListener("pointermove",pointerMove);
    windowRef.removeEventListener("pointerup",pointerEnd);
    windowRef.removeEventListener("pointercancel",pointerEnd);
    layer.remove();
  }
  try{load(false);render();}
  catch(err){close();throw err;}
  return {close,render,refresh:()=>{load();render();},
    inspect:()=>({activeGraph,nodes:model.graph(activeGraph).instances.length,
      edges:model.graph(activeGraph).edges.length,closed,authority:"none",runtimeActivated:false})};
}
