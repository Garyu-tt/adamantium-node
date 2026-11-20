/**
 * Adamantium-node R07 native SVG workspace lens.
 *
 * Renders EDITOR-ONLY Capsule Studio graphs directly in Node-RED's native
 * SVG nodeLayer/linkLayer. This is not the ordinary Node-RED flow graph:
 * no /flows writes, no subflow coercion, no runtime nodes, no MAS grants.
 * SPDX-License-Identifier: Apache-2.0
 */
import {CapsuleStudio} from "./capsule-studio.mjs";
import {CapsuleTemplateLibrary,extractSelection} from "./capsule-extract.mjs";
import {layoutCapsuleCanvas} from "./capsule-canvas-geometry.mjs";

const NS="http://www.w3.org/2000/svg";
export const STORAGE_KEY="adamantium.capsule-studio.r01";
const SVG_CARD_CLASS="adamantium-capsule-native-card";
const MODULE_LIMIT=512,EDGE_LIMIT=2048;

function svg(doc,tag,attrs={},text){
  const item=doc.createElementNS(NS,tag);
  for(const [key,value] of Object.entries(attrs))item.setAttribute(key,String(value));
  if(text!==undefined)item.textContent=String(text);
  return item;
}
function childOf(parent,className) {
  return Array.from(parent.children).find(el=>el.getAttribute?.("class")===className);
}
function clear(parent){while(parent.firstChild)parent.removeChild(parent.firstChild);}
function rect(doc,group,x,y,w,h,css) {
  const item=svg(doc,"rect",{x,y,width:w,height:h,rx:7,ry:7,class:css});
  group.appendChild(item);return item;
}
function named(doc,g,x,y,value,css) {
  const t=svg(doc,"text",{x,y,class:css},value);
  g.appendChild(t);return t;
}
function clamp(value,defaultValue,min,max){
  return Number.isFinite(value)?Math.max(min,Math.min(value,max)):defaultValue;
}
function fallbackStudio(){
  const studio=new CapsuleStudio(),root=studio.createGraph("Главный граф");
  const def=studio.createDefinition({name:"JSON Parser",language:"python",
    description:"Пример неисполняемой микропрограммы",
    source:"def run(data): return data",
    ports:[{tag:"data",direction:"input",dataType:"core.json@1",semantics:"data"},
      {tag:"result",direction:"output",dataType:"core.json@1",semantics:"data"}]});
  const a=studio.place(root,def.id),b=studio.place(root,def.id);
  const c=studio.createCapsule(root,"Подграф");
  const inside=studio.place(c.graphId,def.id);
  studio.expose(c.graphId,{side:"west",instanceId:inside,tag:"data",externalTag:"input"});
  studio.expose(c.graphId,{side:"east",instanceId:inside,tag:"result",externalTag:"output"});
  studio.connect(root,{fromId:a,fromTag:"result",toId:c.instanceId,toTag:"input"});
  studio.connect(root,{fromId:c.instanceId,fromTag:"output",toId:b,toTag:"data"});
  return {studio,library:new CapsuleTemplateLibrary(),positions:{
    [root]:{[a]:{x:1100,y:220},[c.instanceId]:{x:1410,y:220},[b]:{x:1780,y:220}},
    [c.graphId]:{[inside]:{x:1330,y:260}}
  }};
}
function sanitizedPositions(studio,positions) {
  const safe=Object.create(null);
  if(!positions||typeof positions!=="object"||Array.isArray(positions))return safe;
  for(const [graphId,byId] of Object.entries(positions)){
    if(!Object.prototype.hasOwnProperty.call(studio.graphs,graphId)||
      !byId||typeof byId!=="object"||Array.isArray(byId))continue;
    const existing=new Set(studio.graph(graphId).instances.map(i=>i.id));
    safe[graphId]=Object.create(null);
    for(const [nodeId,p] of Object.entries(byId)){
      if(!existing.has(nodeId)||!p||typeof p!=="object")continue;
      safe[graphId][nodeId]={
        x:clamp(p.x,1100,0,8000),y:clamp(p.y,220,0,8000)
      };
    }
  }
  return safe;
}
/**
 * DOM controller designed for Node-RED 5 native viewRedrawCanvas hook.
 * Native node coordinates and existing flow links are never modified.
 */
export class CapsuleNativeCanvas {
  constructor({doc,storage,onUpdate,requestRedraw,getWorkspaceId}={}){
    if(!doc||typeof doc.createElementNS!=="function")
      throw new TypeError("SVG DOM required");
    if(!storage||typeof storage.getItem!=="function"||typeof storage.setItem!=="function")
      throw new TypeError("local-only storage required");
    this.doc=doc;this.storage=storage;this.onUpdate=onUpdate||(()=>{});
    this.requestRedraw=requestRedraw||(()=>{});
    this.getWorkspaceId=typeof getWorkspaceId==="function"?getWorkspaceId:null;
    this.workspaceId=null;
    this.enabled=false;this.studio=null;this.library=null;this.positions={};
    this.graphId=null;this.activePort=null;this.selected=new Set();
    this.expandedSides=Object.create(null);
    this.dirty=true;this.layers=null;this.notice="Без исполнения · локальный слой";
    this.storageLocked=false;
    this.drag=null;
    this.read();
  }
  read(){
    let loaded=false;
    this.storageLocked=false;
    try{
      const text=this.storage.getItem(STORAGE_KEY);
      if(text){
        const json=JSON.parse(text);
        const studio=CapsuleStudio.restore(json.model);
        const library=CapsuleTemplateLibrary.restore(json.templates);
        this.studio=studio;this.library=library;
        this.positions=sanitizedPositions(studio,json.positions);
        loaded=true;
      }
    }catch(err){
      this.storageLocked=true;
      this.notice="Локальные данные повреждены/недоступны: сохранение заблокировано. Исправь через Sidebar.";
    }
    if(!loaded){
      const data=fallbackStudio();
      this.studio=data.studio;this.library=data.library;this.positions=data.positions;
    }
    this.graphId=this.studio.rootGraphId;this.selected.clear();
    this.activePort=null;this.dirty=true;
    return loaded;
  }
  save(){
    if(this.storageLocked){
      this.notice="Сохранение заблокировано: исправь повреждённые данные через Sidebar.";
      return false;
    }
    try {
      const state={model:this.studio.snapshot(),templates:this.library.snapshot(),positions:this.positions};
      this.storage.setItem(STORAGE_KEY,JSON.stringify(state));
      // A nonessential UI notifier must not turn a successful disk/browser
      // write into a reported persistence failure.
      try {
        this.onUpdate({graphId:this.graphId,source:"capsule-native-canvas"});
      } catch (_ignored) { /* persisted state remains canonical */ }
      return true;
    }catch(error){
      this.notice="Ошибка сохранения. Проверь доступный объём хранилища и экспортируй через Sidebar.";
      return false;
    }
  }
  /**
   * Editor operations are all-or-nothing at the localStorage boundary.
   * A failed browser quota/write must not leave a phantom in-memory graph
   * that silently disappears on reload or overwrites a newer saved model.
   */
  mutateWithPersistence(operation){
    if(this.storageLocked){
      this.notice="Сохранение заблокировано. Исправь хранилище через Sidebar.";
      this.dirty=true;this.requestRedraw();return null;
    }
    const checkpoint={
      model:this.studio.snapshot(),
      library:this.library.snapshot(),
      positions:JSON.parse(JSON.stringify(this.positions)),
      graphId:this.graphId,
      selected:Array.from(this.selected)
    };
    let result=null;
    try{
      result=operation();
      if(!this.save())throw new Error("browser storage write rejected");
    }catch(error){
      this.studio=CapsuleStudio.restore(checkpoint.model);
      this.library=CapsuleTemplateLibrary.restore(checkpoint.library);
      this.positions=checkpoint.positions;
      this.graphId=checkpoint.graphId;
      this.selected=new Set(checkpoint.selected);
      this.activePort=null;
      this.notice="Изменения отменены: "+error.message;
      result=null;
    }
    this.dirty=true;this.requestRedraw();
    return result;
  }
  setEnabled(value) {
    this.enabled=value===true;
    if(this.enabled&&this.getWorkspaceId)this.workspaceId=this.getWorkspaceId();
    this.dirty=true;
    this.requestRedraw();
  }
  isEnabled(){return this.enabled;}
  refresh(){
    const loaded=this.read();
    if(!this.storageLocked)
      this.notice=loaded?"Прочитан актуальный граф из библиотеки Sidebar.":
        "Создан локальный пример. Никаких потоков Node-RED не затронуто.";
    this.requestRedraw();
  }
  navigate(graphId) {
    this.studio.graph(graphId);
    this.graphId=graphId;
    this.activePort=null;this.selected.clear();this.dirty=true;
    this.requestRedraw();
  }
  addCapsule(){
    return this.mutateWithPersistence(()=>{
      const target=this.graphId;
      const result=this.studio.createCapsule(target,"Новый контейнер");
      const existing=this.studio.graph(target).instances.length-1;
      this.positions[target]??={};
      this.positions[target][result.instanceId]={x:1160+((existing%3)*310),y:230+Math.floor(existing/3)*220};
      this.notice="Создан пустой вложенный граф (editor-only).";
      return result;
    });
  }
  extract(){
    if(!this.selected.size){this.notice="Сначала Shift+клик по заголовкам нод.";this.requestRedraw();return null;}
    return this.mutateWithPersistence(()=>{
      const parent=this.graphId;
      const chosen=Array.from(this.selected);
      const positions=chosen.map(id=>this.positions[parent]?.[id]||{x:1300,y:240});
      const result=extractSelection(this.studio,parent,chosen,"Извлечённый граф");
      const cx=positions.reduce((s,p)=>s+p.x,0)/positions.length;
      const cy=positions.reduce((s,p)=>s+p.y,0)/positions.length;
      this.positions[parent]??={};
      this.positions[parent][result.instanceId]={x:cx,y:cy};
      this.positions[result.graphId]??={};
      chosen.forEach((id,i)=>{
        this.positions[result.graphId][id]=positions[i];delete this.positions[parent][id];
      });
      this.selected.clear();this.activePort=null;
      this.notice="Извлечены "+chosen.length+" нод, "+result.interfacePorts+" типизированных каналов.";
      return result;
    });
  }
  toggleSelect(id){
    this.studio.instance(this.graphId,id);
    if(this.selected.has(id))this.selected.delete(id);else this.selected.add(id);
    this.dirty=true;this.requestRedraw();
  }
  toggleSide(id,side){
    const key=JSON.stringify([id,side]);
    this.expandedSides[key]=!this.expandedSides[key];
    this.dirty=true;this.requestRedraw();
  }
  pickPort(nodeId,tag){
    try{
      const port=this.studio.resolvePorts(this.graphId,nodeId).find(p=>p.tag===tag);
      if(!port)throw new Error("Порт отсутствует");
      if(!this.activePort){
        this.activePort={nodeId,tag,port};
        this.notice="Выбран "+tag+" · "+port.direction+". Теперь выбери совместимый порт.";
      }else{
        const first=this.activePort;
        this.activePort=null;
        if(first.nodeId===nodeId&&first.tag===tag){
          this.notice="Соединение отменено.";
        }else{
          const from=first.port.direction==="output"?first:{nodeId,tag,port};
          const to=first.port.direction==="input"?first:{nodeId,tag,port};
          this.mutateWithPersistence(()=>{
            const edge=this.studio.connect(this.graphId,{
              fromId:from.nodeId,fromTag:from.tag,toId:to.nodeId,toTag:to.tag
            });
            this.notice="Связь "+edge+" сохранена локально; не опубликована в Node-RED.";
            return edge;
          });
        }
      }
    }catch(error){this.activePort=null;this.notice="Связь отклонена: "+error.message;}
    this.dirty=true;this.requestRedraw();
  }
  updatePosition(id,x,y,{persist=false}={}){
    this.studio.instance(this.graphId,id);
    this.positions[this.graphId]??={};
    const before=this.positions[this.graphId][id];
    this.positions[this.graphId][id]={x:clamp(x,1100,0,8000),y:clamp(y,240,0,8000)};
    if(persist && !this.save()){
      if(before===undefined)delete this.positions[this.graphId][id];
      else this.positions[this.graphId][id]=before;
    }
    this.dirty=true;this.requestRedraw();
  }
  model(){
    const graph=this.studio.graph(this.graphId);
    if(graph.instances.length>MODULE_LIMIT||graph.edges.length>EDGE_LIMIT)
      throw new TypeError("SVG canvas budget 512 nodes/2048 edges. Углубись в контейнер.");
    return layoutCapsuleCanvas(this.studio,this.graphId,this.positions[this.graphId]||{},this.expandedSides);
  }
  pointInLayer(event,layer){
    const svgRoot=layer.ownerSVGElement;
    if(!svgRoot||!svgRoot.createSVGPoint||!layer.getScreenCTM)return null;
    const ctm=layer.getScreenCTM();
    if(!ctm||!ctm.inverse)return null;
    const pt=svgRoot.createSVGPoint();pt.x=event.clientX;pt.y=event.clientY;
    const local=pt.matrixTransform(ctm.inverse());
    return {x:local.x,y:local.y};
  }
  startDrag(event,card,layer){
    if(event.shiftKey)return;
    if(event.button!==0||this.drag)return;
    const point=this.pointInLayer(event,layer);
    if(!point)return;
    event.preventDefault();event.stopPropagation();
    const origin={x:card.x,y:card.y};
    const onMove=(e)=>{
      const p=this.pointInLayer(e,layer);if(!p)return;
      if(Math.abs(p.x-point.x)+Math.abs(p.y-point.y)<1)return;
      this.drag.moved=true;
      this.updatePosition(card.id,origin.x+p.x-point.x,origin.y+p.y-point.y);
    };
    const onUp=(e)=>{
      this.doc.removeEventListener("pointermove",onMove);
      this.doc.removeEventListener("pointerup",onUp);
      if(this.drag?.moved){
        if(!this.save()){
          // Pointer motion is optimistic; a failed final write must restore
          // the initial position to prevent a visually lost unsaved drag.
          this.updatePosition(card.id,origin.x,origin.y);
        }
        this.dirty=true;this.requestRedraw();
      }
      this.drag=null;
      e.stopPropagation();
    };
    this.drag={id:card.id,moved:false};
    this.doc.addEventListener("pointermove",onMove);
    this.doc.addEventListener("pointerup",onUp);
  }
  toolbarButton(group,x,text,onClick){
    const g=svg(this.doc,"g",{class:"adamantium-capsule-native-control",
      transform:"translate("+x+",0)",role:"button",tabindex:0});
    rect(this.doc,g,0,0,112,28,"adamantium-capsule-native-control-bg");
    named(this.doc,g,56,19,text,"adamantium-capsule-native-control-label")
      .setAttribute("text-anchor","middle");
    const act=e=>{e.preventDefault();e.stopPropagation();onClick();};
    g.addEventListener("click",act);
    g.addEventListener("keydown",e=>{
      if(e.key==="Enter"||e.key===" "){act(e);}
    });
    group.appendChild(g);
  }
  drawToolbar(group,layout){
    const bar=svg(this.doc,"g",{class:"adamantium-capsule-native-toolbar",
      transform:"translate(1000,58)"});
    group.appendChild(bar);
    named(this.doc,bar,0,-12,"Adamantium Capsule · SVG workspace",
      "adamantium-capsule-native-heading");
    this.toolbarButton(bar,0,"+ Контейнер",()=>this.addCapsule());
    this.toolbarButton(bar,120,"Извлечь",()=>this.extract());
    this.toolbarButton(bar,240,"Обновить",()=>this.refresh());
    this.toolbarButton(bar,360,"Назад",()=>{
      const parent=this.studio.exit(this.graphId);
      if(parent)this.navigate(parent);
    });
    this.toolbarButton(bar,480,"Скрыть слой",()=>this.setEnabled(false));
    const crumbs=layout.graphPath.map(p=>p.title).join(" / ");
    named(this.doc,bar,0,51,crumbs,"adamantium-capsule-native-breadcrumb");
    named(this.doc,bar,0,69,this.notice,"adamantium-capsule-native-status");
    if(layout.hiddenLinks) named(this.doc,bar,0,87,
      "Скрыто линий: "+layout.hiddenLinks+" (раскрой +N на стороне ноды)",
      "adamantium-capsule-native-warning");
  }
  drawCard(group,card,layer){
    const g=svg(this.doc,"g",{
      class:SVG_CARD_CLASS+(this.selected.has(card.id)?" selected":""),
      "data-instance-id":card.id,"data-kind":card.kind,
      transform:"translate("+card.x+","+card.y+")"
    });
    rect(this.doc,g,0,0,card.width,card.height,
      "adamantium-capsule-native-body"+(card.kind==="capsule"?" is-capsule":""));
    const header=svg(this.doc,"g",{class:"adamantium-capsule-native-header",role:"button",tabindex:0});
    rect(this.doc,header,0,0,card.width,31,"adamantium-capsule-native-header-bg");
    named(this.doc,header,13,21,card.title.slice(0,36),
      "adamantium-capsule-native-card-title");
    header.addEventListener("pointerdown",e=>{
      if(e.shiftKey){e.stopPropagation();return;}
      this.startDrag(e,card,layer);
    });
    header.addEventListener("click",e=>{
      e.stopPropagation();
      if(e.shiftKey)this.toggleSelect(card.id);
    });
    header.addEventListener("dblclick",e=>{
      e.preventDefault();e.stopPropagation();
      if(card.childGraphId)this.navigate(card.childGraphId);
    });
    header.addEventListener("keydown",e=>{
      if(e.key==="Enter"&&card.childGraphId)this.navigate(card.childGraphId);
      if(e.key===" "){e.preventDefault();this.toggleSelect(card.id);}
    });
    g.appendChild(header);
    if(card.childGraphId){
      named(this.doc,g,card.width/2,card.height/2,
        "↳ Двойной клик: внутрь","adamantium-capsule-native-subtitle")
        .setAttribute("text-anchor","middle");
    }else{
      named(this.doc,g,card.width/2,card.height/2,
        "Микропрограмма · editor-only","adamantium-capsule-native-subtitle")
        .setAttribute("text-anchor","middle");
    }
    for(const port of card.ports){
      const button=svg(this.doc,"g",{class:"adamantium-capsule-native-port",
        "data-port-tag":port.tag,"data-node-id":card.id,
        "data-side":port.side,"data-direction":port.direction,role:"button",tabindex:0});
      const cx=port.x-card.x,cy=port.y-card.y;
      button.appendChild(svg(this.doc,"circle",{cx,cy,r:7,class:
        "adamantium-capsule-native-port-circle"+(this.activePort?.nodeId===card.id &&
        this.activePort?.tag===port.tag?" active":"")}));
      const caption=svg(this.doc,"title",{},port.tag+" · "+port.dataType+
        " · "+port.semantics+" · "+port.direction);
      button.appendChild(caption);
      const onPick=e=>{
        e.preventDefault();e.stopPropagation();
        this.pickPort(card.id,port.tag);
      };
      button.addEventListener("mousedown",e=>e.stopPropagation());
      button.addEventListener("pointerdown",e=>e.stopPropagation());
      button.addEventListener("click",onPick);
      button.addEventListener("keydown",e=>{
        if(e.key==="Enter"||e.key===" ")onPick(e);
      });
      g.appendChild(button);
    }
    for(const [side,entry] of Object.entries(card.sides)){
      if(entry.total<=4 && !entry.expanded)continue;
      const x=side==="west"?-16:side==="east"?card.width+16:card.width/2;
      const y=side==="north"?-18:side==="south"?card.height+18:card.height/2;
      const t=svg(this.doc,"text",{x,y,class:"adamantium-capsule-native-expand",
        "data-side":side,"data-instance-id":card.id,role:"button",tabindex:0,
        "text-anchor":"middle"},entry.expanded?"−":("+"+entry.hiddenCount));
      const toggle=e=>{e.preventDefault();e.stopPropagation();this.toggleSide(card.id,side);};
      t.addEventListener("click",toggle);
      t.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" ")toggle(e);});
      g.appendChild(t);
    }
    group.appendChild(g);
  }
  render() {
    if(!this.layers)return;
    const {nodeLayer,linkLayer}=this.layers;
    let nodes=childOf(nodeLayer,"adamantium-capsule-native-overlay");
    let links=childOf(linkLayer,"adamantium-capsule-native-wires");
    if(!this.enabled){
      if(nodes)nodes.remove();
      if(links)links.remove();
      this.dirty=false;return;
    }
    if(!nodes){
      nodes=svg(this.doc,"g",{class:"adamantium-capsule-native-overlay",
        "data-editor-only":"true"});
      nodeLayer.appendChild(nodes);
    }
    if(!links){
      links=svg(this.doc,"g",{class:"adamantium-capsule-native-wires",
        "data-editor-only":"true"});
      linkLayer.appendChild(links);
    }
    if(!this.dirty)return;
    clear(nodes);clear(links);
    try {
      const layout=this.model();
      this.drawToolbar(nodes,layout);
      for(const wire of layout.wires){
        const path=svg(this.doc,"path",{d:wire.d,
          class:"adamantium-capsule-native-wire",fill:"none",
          "data-edge-id":wire.id,"data-from-port":wire.fromTag,
          "data-to-port":wire.toTag});
        path.appendChild(svg(this.doc,"title",{},
          wire.fromTag+" → "+wire.toTag+" (editor-only)"));
        links.appendChild(path);
      }
      for(const card of layout.cards)this.drawCard(nodes,card,nodeLayer);
    }catch(error) {
      const g=svg(this.doc,"g",{class:"adamantium-capsule-native-error"});
      named(this.doc,g,1010,120,"SVG-граф отклонён: "+error.message,
        "adamantium-capsule-native-warning");
      nodes.appendChild(g);
    }
    this.dirty=false;
  }
  redraw({nodeLayer,linkLayer,workspaceId}={}){
    if(!nodeLayer||!linkLayer)return;
    this.layers={nodeLayer,linkLayer};
    // The editor-only lens belongs to the selected native workspace,
    // never every Node-RED flow tab simultaneously.
    if(this.enabled&&this.workspaceId!==null&&workspaceId!==undefined&&
      this.workspaceId!==workspaceId){
      childOf(nodeLayer,"adamantium-capsule-native-overlay")?.remove();
      childOf(linkLayer,"adamantium-capsule-native-wires")?.remove();
      this.dirty=true;
      return;
    }
    this.render();
  }
}
