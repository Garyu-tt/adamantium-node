import {CapsuleStudio,SIDES} from "../capsule-studio.mjs";
import {extractSelection,CapsuleTemplateLibrary} from "../capsule-extract.mjs";
import {ConstructEngine} from "../construct-engine.mjs";

// Offline authoring preview only: no eval(), worker, process spawn or deployment.
const STORAGE="adamantium.capsule-studio.r01";
const $=id=>document.getElementById(id);
const SIDE_NAMES={north:"Север",east:"Восток",south:"Юг",west:"Запад"};
let studio,library=new CapsuleTemplateLibrary(),construct,activeGraph,positions={},filter="all",selectedPort=null,editingId=null,exposing=null;
const selected=new Set();
const expanded=new Set();
function message(text,error=false) { $("notice").textContent=text;$("notice").dataset.error=String(error); }
function clamp(value,min,max) { return Math.min(max,Math.max(min,Number(value)||0)); }
function seed() {
  const s=new CapsuleStudio(),root=s.createGraph("Главный граф");
  const parser=s.createDefinition({name:"JSON Parser",language:"python",description:"Разбор JSON-данных",source:"def run(data):\n    return {\"result\": data, \"error\": None}",ports:[
    {tag:"data",direction:"input",semantics:"data",dataType:"core.json@1"},
    {tag:"result",direction:"output",semantics:"data",dataType:"core.json@1"},
    {tag:"error",direction:"output",semantics:"event",dataType:"core.error@1"}
  ]});
  const router=s.createDefinition({name:"Event Router",language:"rust",description:"Маршрутизация результатов",source:"// Source-only node, use an approved executor adapter",ports:[
    {tag:"data",direction:"input",semantics:"data",dataType:"core.json@1"},
    {tag:"result",direction:"output",semantics:"data",dataType:"core.json@1"}
  ]});
  const a=s.place(root,parser.id),b=s.place(root,router.id);
  const c=s.createCapsule(root,"Вложенный обработчик");
  const internal=s.place(c.graphId,parser.id);
  s.expose(c.graphId,{side:"west",instanceId:internal,tag:"data",externalTag:"input"});
  s.expose(c.graphId,{side:"east",instanceId:internal,tag:"result",externalTag:"output"});
  s.expose(c.graphId,{side:"south",instanceId:internal,tag:"error",externalTag:"error"});
  s.connect(root,{fromId:a,fromTag:"result",toId:c.instanceId,toTag:"input"});
  s.connect(root,{fromId:c.instanceId,fromTag:"output",toId:b,toTag:"data"});
  positions[root]={[a]:{x:80,y:205},[c.instanceId]:{x:355,y:205},[b]:{x:650,y:205}};
  positions[c.graphId]={[internal]:{x:430,y:245}};
  return s;
}
function load() {
  let previousConstruct=null;
  try {
    const data=JSON.parse(localStorage.getItem(STORAGE));
    studio=CapsuleStudio.restore(data.model);
    library=CapsuleTemplateLibrary.restore(data.templates);
    previousConstruct=data.construct||null;
    positions=Object.create(null);
    if(data.positions&&typeof data.positions==="object") for(const [graphId,rows] of Object.entries(data.positions)) {
      if(!studio.graphs[graphId]||!rows||typeof rows!=="object")continue;
      positions[graphId]={};
      for(const [id,p] of Object.entries(rows)) if(p&&typeof p==="object") {
        positions[graphId][id]={x:clamp(p.x,65,3500),y:clamp(p.y,70,3000)};
      }
    }
  } catch {
    studio=seed();library=new CapsuleTemplateLibrary();
  }
  construct=ConstructEngine.restore(studio,library,previousConstruct);
  activeGraph=studio.rootGraphId;
}
function persist() {
  try { localStorage.setItem(STORAGE,JSON.stringify({model:studio.snapshot(),templates:library.snapshot(),construct:construct.snapshot(),positions})); }
  catch { message("Не удалось сохранить локально. Экспортируй JSON.",true); }
}
function doAction(action) {
  try { action(); persist(); render(); }
  catch(err) { message(err.message||String(err),true); }
}
function position(graphId,id) {
  positions[graphId]??={};
  if(!positions[graphId][id]) {
    const index=studio.graph(graphId).instances.findIndex(i=>i.id===id);
    positions[graphId][id]={x:130+(index%3)*265,y:160+Math.floor(index/3)*205};
  }
  return positions[graphId][id];
}
function nodeTitle(instance) {
  return instance.kind==="capsule"?instance.title:studio.definitions[instance.definitionId].name;
}
function nodeSubtitle(instance) {
  if(instance.kind==="capsule")return "Вложенный граф · двойной клик";
  const d=studio.definitions[instance.definitionId];
  return d.language+" · v"+instance.version+" · код в библиотеке";
}
function el(tag,classname,text) {
  const node=document.createElement(tag);
  if(classname)node.className=classname;
  if(text!==undefined)node.textContent=text;
  return node;
}
function button(text,onClick,classname="") {
  const b=el("button",classname,text);
  b.type="button";b.addEventListener("click",onClick);
  return b;
}
function openDefinition(id=null) {
  editingId=id;
  const f=$("definitionForm");
  f.reset();
  $("definitionTitle").textContent=id?"Новая версия микропрограммы":"Новая микропрограмма";
  f.elements.name.disabled=!!id;
  f.elements.language.disabled=!!id;
  f.elements.description.disabled=!!id;
  if(id) {
    const d=studio.definitions[id],last=Math.max(...Object.keys(d.versions).map(Number));
    const v=d.versions[last];
    f.elements.name.value=d.name;
    f.elements.language.value=d.language;
    f.elements.description.value=d.description;
    f.elements.source.value=v.source;
    f.elements.ports.value=v.ports.map(p=>[p.tag,p.direction,p.dataType,p.semantics].join(" ")).join("\n");
  } else {
    f.elements.ports.value="data input core.json@1 data\nresult output core.json@1 data\nerror output core.error@1 event";
    f.elements.language.value="python";
  }
  $("definitionDialog").showModal();
}
function parsePorts(text) {
  return text.split(/\r?\n/).map(x=>x.trim()).filter(Boolean).map((line,index)=>{
    const parts=line.split(/\s+/);
    if(parts.length!==4)throw new TypeError("Порт #"+(index+1)+": нужны тег, направление, тип, семантика");
    return {tag:parts[0],direction:parts[1],dataType:parts[2],semantics:parts[3]};
  });
}
function addDefinition(e) {
  e.preventDefault();
  const f=e.currentTarget, raw={
    name:f.elements.name.value,language:f.elements.language.value,
    description:f.elements.description.value,source:f.elements.source.value,
    ports:parsePorts(f.elements.ports.value)
  };
  doAction(()=>{
    if(editingId) {
      const number=studio.reviseDefinition(editingId,raw);
      message("Сохранена версия "+number+". Существующие экземпляры остались на закреплённых версиях.");
    } else {
      const d=studio.createDefinition(raw);
      message(d.reused?"Совпадение найдено: используется существующая реализация.":"Определение добавлено в библиотеку.");
    }
    $("definitionDialog").close();
  });
}
function addInstance(definitionId,x,y) {
  doAction(()=>{
    const d=studio.definitions[definitionId];
    const version=Math.max(...Object.keys(d.versions).map(Number));
    const id=studio.place(activeGraph,definitionId,version);
    positions[activeGraph]??={};
    positions[activeGraph][id]={x:clamp(x??180,65,3500),y:clamp(y??195,70,3000)};
    message("Добавлен экземпляр "+d.name+" v"+version+"; исходный код не скопирован.");
  });
}
function addCapsule() {
  const title=window.prompt("Название вложенного графа","Новый контейнер");
  if(title===null)return;
  doAction(()=>{
    const c=studio.createCapsule(activeGraph,title);
    position(activeGraph,c.instanceId);
    message("Создан вложенный граф. Дважды кликни по карточке, чтобы войти.");
  });
}
function enter(id) {
  doAction(()=>{
    activeGraph=studio.enter(activeGraph,id);
    selected.clear();selectedPort=null;
    message("Внутренний граф. Четыре пограничные карточки возвращают к родителю.");
  });
}
function goTo(id) {
  doAction(()=>{
    studio.graph(id);activeGraph=id;selected.clear();selectedPort=null;
    message("Открыт граф: "+studio.graph(id).title);
  });
}
function portClick(instance,port) {
  if(!selectedPort) {
    selectedPort={graphId:activeGraph,instanceId:instance.id,tag:port.tag,direction:port.direction};
    message("Выбран порт "+port.tag+". Выбери совместимый порт другой ноды.");
    render();return;
  }
  if(selectedPort.graphId!==activeGraph) {selectedPort=null;message("Порты разных графов нельзя соединять напрямую",true);render();return;}
  if(selectedPort.instanceId===instance.id&&selectedPort.tag===port.tag) { selectedPort=null;render();return; }
  const first=selectedPort;
  selectedPort=null;
  doAction(()=>{
    const a=first.direction==="output"?first:{instanceId:instance.id,tag:port.tag};
    const b=first.direction==="input"?first:{instanceId:instance.id,tag:port.tag};
    studio.connect(activeGraph,{fromId:a.instanceId,fromTag:a.tag,toId:b.instanceId,toTag:b.tag});
    message("Соединение "+a.tag+" → "+b.tag+" создано.");
  });
}
function openExposure(instance,port) {
  if(!studio.graph(activeGraph).parent) {message("У главного графа нет родительской границы.",true);return;}
  exposing={instanceId:instance.id,tag:port.tag};
  const f=$("exposeForm");f.reset();
  f.elements.side.value=port.direction==="input"?"west":"east";
  f.elements.tag.value=port.tag;
  $("exposeSource").textContent=nodeTitle(instance)+" · "+port.tag+" · "+port.dataType;
  $("exposeDialog").showModal();
}
function submitExposure(e) {
  e.preventDefault();
  const f=e.currentTarget, current=exposing;
  if(!current)return;
  doAction(()=>{
    studio.expose(activeGraph,{side:f.elements.side.value,externalTag:f.elements.tag.value,...current});
    $("exposeDialog").close();
    message("Внешний порт создан. На карточке родительского графа он появится автоматически.");
  });
}
function portRow(instance,p) {
  const row=el("div","node-port");
  row.dataset.direction=p.direction;
  const dot=el("span","port-dot");
  const b=button(p.tag+" · "+p.dataType,()=>portClick(instance,p));
  b.title=p.tag+" · "+p.dataType+" · "+p.direction+" / "+p.semantics;
  b.dataset.portTag=p.tag;
  b.dataset.selected=String(selectedPort?.instanceId===instance.id&&selectedPort?.tag===p.tag);
  row.append(dot,b);
  if(studio.graph(activeGraph).parent) {
    const expose=button("↗",()=>openExposure(instance,p));
    expose.title="Вывести порт на одну из четырёх границ";
    row.append(expose);
  }
  return row;
}
function renderPorts(instance,host) {
  if(instance.kind==="capsule") {
    const ports=studio.resolvePorts(activeGraph,instance.id);
    for(const side of SIDES) {
      const group=ports.filter(p=>p.side===side),slot=el("div","capsule-side");
      slot.dataset.side=side;
      const expandedKey=instance.id+":"+side,limit=expanded.has(expandedKey)?128:4;
      slot.append(el("small","muted",SIDE_NAMES[side]+":"));
      for(const p of group.slice(0,limit))slot.append(portRow(instance,p));
      if(group.length>limit)slot.append(button("+"+(group.length-limit),()=>{expanded.add(expandedKey);render();},"overflow"));
      if(group.length>4&&limit===128)slot.append(button("Свернуть",()=>{expanded.delete(expandedKey);render();}));
      host.append(slot);
    }
  } else {
    for(const p of studio.resolvePorts(activeGraph,instance.id))host.append(portRow(instance,p));
  }
}

function extractSelected() {
  if(!selected.size){message("Сначала отметь ноды Shift+клик по заголовкам.",true);return;}
  const title=window.prompt("Название извлекаемого компонента","Извлечённый модуль");
  if(title===null)return;
  doAction(()=>{
    const original=activeGraph,chosen=Array.from(selected);
    const points=chosen.map(id=>position(original,id));
    const cx=Math.round(points.reduce((s,p)=>s+p.x,0)/points.length);
    const cy=Math.round(points.reduce((s,p)=>s+p.y,0)/points.length);
    const result=extractSelection(studio,original,chosen,title);
    positions[original]??={};
    positions[original][result.instanceId]={x:cx,y:cy};
    positions[result.graphId]??={};
    for(const id of chosen){
      const p=positions[original][id];
      if(p)positions[result.graphId][id]={x:p.x,y:p.y};
      delete positions[original][id];
    }
    selected.clear();
    message("Выделенные ноды извлечены: "+result.interfacePorts+" интерфейсных каналов, связи сохранены.");
  });
}
function saveCurrentTemplate() {
  if(!studio.graph(activeGraph).parent){
    message("Для шаблона сначала создай вложенный граф или извлеки выделенные ноды.",true);return;
  }
  const title=window.prompt("Имя переиспользуемого шаблона",studio.graph(activeGraph).title);
  if(title===null)return;
  doAction(()=>{
    const result=library.capture(studio,activeGraph,title);
    message(result.reused?"Эквивалентный шаблон уже есть в библиотеке.":"Граф сохранён как переиспользуемый шаблон.");
  });
}
function addTemplate(templateId,x,y) {
  doAction(()=>{
    const inst=library.place(studio,activeGraph,templateId);
    positions[activeGraph]??={};
    positions[activeGraph][inst.instanceId]={x:clamp(x??250,65,3500),y:clamp(y??180,70,3000)};
    message("Создан независимый экземпляр шаблона без копирования исходников микропрограмм.");
  });
}
function nodeElement(i) {
  const node=el("article","node "+i.kind);
  node.dataset.nodeId=i.id;
  const pos=position(activeGraph,i.id);node.style.left=pos.x+"px";node.style.top=pos.y+"px";
  node.classList.toggle("selected",selected.has(i.id));
  const head=el("div","node-head");
  head.addEventListener("click",event=>{
    if(!event.shiftKey)return;
    if(selected.has(i.id))selected.delete(i.id);else selected.add(i.id);
    render();
    message(selected.size+" нод выбрано. Нажми «Извлечь выбранные».");
  });
  head.append(el("strong","",nodeTitle(i)),el("small","muted",nodeSubtitle(i)));
  head.addEventListener("dblclick",event=>{
    if(event.shiftKey)return;
    i.kind==="capsule"?enter(i.id):openDefinition(i.definitionId);
  });
  drag(head,node,i);
  const body=el("div","node-body");
  renderPorts(i,body);
  if(i.kind==="capsule"){
    const center=el("div","capsule-center");
    center.append(button("Открыть ↗",()=>enter(i.id)));
    body.append(center);
  }
  node.append(head,body);
  return node;
}
function drag(handle,node,instance) {
  let origin=null;
  handle.addEventListener("pointerdown",e=>{
    if(e.button!==0)return;
    const p=position(activeGraph,instance.id);
    origin={pointer:e.pointerId,x:e.clientX,y:e.clientY,startX:p.x,startY:p.y};
    handle.setPointerCapture(e.pointerId);
  });
  handle.addEventListener("pointermove",e=>{
    if(!origin||origin.pointer!==e.pointerId)return;
    const p=position(activeGraph,instance.id);
    p.x=clamp(origin.startX+e.clientX-origin.x,65,3500);
    p.y=clamp(origin.startY+e.clientY-origin.y,70,3000);
    node.style.left=p.x+"px";node.style.top=p.y+"px";
    renderWires();
  });
  function done(){if(origin){origin=null;persist();}}
  handle.addEventListener("pointerup",done);
  handle.addEventListener("pointercancel",done);
}
function svg(tag,attrs) {
  const n=document.createElementNS("http://www.w3.org/2000/svg",tag);
  for(const [k,v] of Object.entries(attrs))n.setAttribute(k,String(v));
  return n;
}
function wireAnchor(instanceId,tag,direction) {
  const host=$("nodes").querySelectorAll(".node");
  const node=Array.from(host).find(n=>n.dataset.nodeId===instanceId);
  if(!node)return null;
  const port=studio.resolvePorts(activeGraph,instanceId).find(p=>p.tag===tag);
  if(!port)return null;
  const side=port.side||(direction==="output"?"east":"west");
  const buttonNode=Array.from(node.querySelectorAll("[data-port-tag]")).find(b=>b.dataset.portTag===tag);
  const buttonBox=buttonNode?.getBoundingClientRect()||node.getBoundingClientRect();
  const box=node.getBoundingClientRect();
  const field=$("field").getBoundingClientRect();
  const cx=(buttonBox.left+buttonBox.right)/2-field.left;
  const cy=(buttonBox.top+buttonBox.bottom)/2-field.top;
  const directions={north:[0,-1],east:[1,0],south:[0,1],west:[-1,0]};
  const [dx,dy]=directions[side];
  return {
    x:dx<0?box.left-field.left:dx>0?box.right-field.left:cx,
    y:dy<0?box.top-field.top:dy>0?box.bottom-field.top:cy,
    dx,dy
  };
}
function renderWires() {
  const layer=$("wires"),graph=studio.graph(activeGraph);
  layer.replaceChildren();
  const extent=graph.instances.reduce((size,i)=>{
    const pos=position(activeGraph,i.id);
    size.width=Math.max(size.width,pos.x+(i.kind==="capsule"?280:190)+180);
    size.height=Math.max(size.height,pos.y+235);
    return size;
  },{width:1100,height:740});
  $("field").style.width=extent.width+"px";
  $("field").style.height=extent.height+"px";
  layer.setAttribute("width",String(extent.width));
  layer.setAttribute("height",String(extent.height));
  for(const e of graph.edges) {
    const a=wireAnchor(e.fromId,e.fromTag,"output");
    const b=wireAnchor(e.toId,e.toTag,"input");
    if(!a||!b)continue;
    const bend=Math.max(38,Math.min(110,Math.hypot(b.x-a.x,b.y-a.y)*.3));
    const curve="M"+a.x+" "+a.y+
      " C"+(a.x+a.dx*bend)+" "+(a.y+a.dy*bend)+
      ","+(b.x-b.dx*bend)+" "+(b.y-b.dy*bend)+
      ","+b.x+" "+b.y;
    layer.append(svg("path",{d:curve,fill:"none",stroke:"var(--accent)","stroke-width":2}));
    const text=svg("text",{x:(a.x+b.x)/2,y:(a.y+b.y)/2-9,fill:"var(--muted)","text-anchor":"middle","font-size":10});
    text.textContent=e.fromTag+" → "+e.toTag;layer.append(text);
  }
}
function renderPortals() {
  const host=$("portals");host.replaceChildren();
  if(!studio.graph(activeGraph).parent)return;
  for(const side of SIDES) {
    const card=el("div","portal "+side);
    const data=studio.boundaryCard(activeGraph,side,4);
    card.append(button("↖ Родитель · "+SIDE_NAMES[side],()=>goTo(data.returnTo)));
    for(const p of data.visible) {
      const tag=button(p.tag+" ×",e=>{
        e.stopPropagation();
        doAction(()=>{studio.unexpose(activeGraph,p.tag);message("Порт "+p.tag+" снят.");});
      });
      tag.title="Удалить порт, если он не подключён снаружи";
      card.append(tag);
    }
    if(data.hiddenCount)card.append(el("small","muted","+"+data.hiddenCount));
    host.append(card);
  }
}
function renderPalette() {
  const host=$("palette");host.replaceChildren();
  const list=studio.palette($("search").value,filter);
  $("count").textContent=list.length+" шт.";
  if(!list.length)host.append(el("p","muted","По запросу ничего не найдено."));
  for(const d of list) {
    const card=el("article","library-item");
    card.draggable=true;
    card.addEventListener("dragstart",e=>e.dataTransfer.setData("text/plain",d.id));
    const details=el("div","");
    details.append(el("div","name",d.name),el("small","",d.language+" · "+d.used+" в графах · v"+Math.max(...d.versions)));
    const controls=el("div","controls");
    controls.append(button("+",()=>addInstance(d.id)));
    controls.append(button(d.favorite?"★":"☆",()=>doAction(()=>studio.favorite(d.id,!d.favorite))));
    controls.append(button("v+",()=>openDefinition(d.id)));
    details.title=d.description;card.append(details,controls);host.append(card);
  }
  const templateMatches=filter==="favorites"?[]:library.palette($("search").value).filter(t=>filter!=="used"||t.used>0);
  for(const t of templateMatches) {
    const item=el("article","library-item");
    item.draggable=true;
    item.addEventListener("dragstart",e=>e.dataTransfer.setData("text/plain",t.id));
    const detail=el("div","");
    detail.append(el("div","name",t.name),el("small","muted","◈ Вложенный шаблон · "+t.used+" экземпляров"));
    item.append(detail,button("↳ +",()=>addTemplate(t.id)));
    host.append(item);
  }
  $("count").textContent=(list.length+templateMatches.length)+" шт.";
  if(!list.length&&!templateMatches.length)host.append(el("p","muted","По запросу ничего не найдено."));
}
function renderBreadcrumbs() {
  const root=$("breadcrumbs");root.replaceChildren();
  for(const [index,crumb] of studio.path(activeGraph).entries()) {
    if(index)root.append(el("span","muted","›"));
    root.append(button(crumb.title,()=>goTo(crumb.id)));
  }
}
function render() {
  renderPalette();renderBreadcrumbs();renderPortals();
  const graph=studio.graph(activeGraph);
  $("nodes").replaceChildren(...graph.instances.map(nodeElement));
  $("extractSelection").disabled=selected.size===0;
  $("saveTemplate").disabled=!graph.parent;
  $("graphInfo").textContent=graph.instances.length+" нод · "+graph.edges.length+" соединений · "+graph.boundary.length+" внешних портов";
  renderWires();
}

function refreshConstructMenu() {
  const host=$("constructItems");
  host.replaceChildren();
  const query=$("constructSearch").value.trim();
  const matches=studio.palette(query,"all").map(d=>({
    id:d.id,name:d.name,kind:"definition",details:d.language+" · pinned v"+Math.max(...d.versions)
  })).concat(library.palette(query).map(t=>({
    id:t.id,name:t.name,kind:"template",details:"◈ Recursive blueprint"
  })));
  $("constructCount").textContent=matches.length+" available · "+Object.keys(construct.views).length+" aliases";
  for(const item of matches.slice(0,200)) {
    const card=el("div","construct-item");
    const label=el("div","");label.append(el("strong","",item.name),el("small","",item.details));
    card.append(label,button("Создать",()=>{
      const mode=$("constructMode").value;
      const cmd=item.kind==="definition"
        ?{type:"place",graphId:activeGraph,definitionId:item.id,
          version:Math.max(...Object.keys(studio.definitions[item.id].versions).map(Number)),mode}
        :{type:"template",graphId:activeGraph,templateId:item.id,mode};
      doConstruct([cmd],"Создан "+item.name+" ("+(mode==="fork"?"независимый форк":"общая реализация")+")");
    }));
    host.append(card);
  }
  if(matches.length>200)host.append(el("small","muted","Показаны первые 200 совпадений. Уточни поиск."));
  if(!matches.length)host.append(el("small","muted","Ничего не найдено."));
}
function doConstruct(commands,success){
  doAction(()=>{
    const result=construct.apply(commands);
    for(const item of result.results)if(item.instanceId)position(activeGraph,item.instanceId);
    message(success);
    refreshConstructMenu();
  });
}
function openConstructMenu() {
  refreshConstructMenu();
  $("constructDialog").showModal();
  $("constructSearch").focus();
}
function selectedConstructCommand(mode) {
  if(selected.size!==1){message("Для действия выбери одну ноду: Shift + клик по заголовку.",true);return;}
  const only=Array.from(selected)[0];
  doConstruct([{type:"duplicate",graphId:activeGraph,instanceId:only,mode}],
    mode==="view"?"Создано представление-ссылка (без копирования исполнения).":
    mode==="fork"?"Создана независимая копия определения.":"Создан новый экземпляр с общей реализацией.");
}

$("definitionForm").addEventListener("submit",addDefinition);
$("cancelDefinition").addEventListener("click",()=>$("definitionDialog").close());
$("exposeForm").addEventListener("submit",submitExposure);
$("cancelExpose").addEventListener("click",()=>$("exposeDialog").close());
$("newDefinition").addEventListener("click",()=>openDefinition());
$("newCapsule").addEventListener("click",addCapsule);
$("extractSelection").addEventListener("click",extractSelected);
$("saveTemplate").addEventListener("click",saveCurrentTemplate);
$("constructMenuToggle").addEventListener("click",openConstructMenu);
$("constructClose").addEventListener("click",()=>$("constructDialog").close());
$("constructSearch").addEventListener("input",refreshConstructMenu);
$("constructMode").addEventListener("change",refreshConstructMenu);
$("constructDuplicate").addEventListener("click",()=>selectedConstructCommand($("constructMode").value));
$("constructAlias").addEventListener("click",()=>selectedConstructCommand("view"));
$("constructRemove").addEventListener("click",()=>{
  if(selected.size===0){message("Выдели ноды для удаления.",true);return;}
  const commands=Array.from(selected).map(instanceId=>({type:"remove",graphId:activeGraph,instanceId}));
  doConstruct(commands,"Удалены выбранные микропрограммы и их связи.");
  if(!selected.size)return;
  const remaining=new Set(studio.graph(activeGraph).instances.map(x=>x.id));
  for(const id of selected)if(!remaining.has(id))selected.delete(id);
});
$("constructAutoWire").addEventListener("click",()=>{
  if(selected.size!==2){message("Выбери ровно две ноды для автоподключения.",true);return;}
  const [a,b]=Array.from(selected);
  let command={type:"auto_connect",graphId:activeGraph,fromId:a,toId:b};
  try{construct.preview([command]);}
  catch {
    command={type:"auto_connect",graphId:activeGraph,fromId:b,toId:a};
    try{construct.preview([command]);}catch(error){message("Автосоединение: "+error.message,true);return;}
  }
  doConstruct([command],"Совместимые порты соединены.");
});
document.addEventListener("keydown",event=>{
  if(event.key.toLowerCase()!=="q"||event.ctrlKey||event.metaKey||event.altKey||event.repeat)return;
  if(event.target instanceof HTMLElement && (event.target.closest("input,textarea,select,[contenteditable]")||event.target.isContentEditable))return;
  if(document.querySelector("dialog[open]"))return;
  event.preventDefault();openConstructMenu();
});
$("search").addEventListener("input",renderPalette);
for(const b of document.querySelectorAll("[data-filter]"))b.addEventListener("click",()=>{
  filter=b.dataset.filter;
  for(const item of document.querySelectorAll("[data-filter]"))item.classList.toggle("active",item===b);
  renderPalette();
});
$("field").addEventListener("dragover",e=>e.preventDefault());
$("field").addEventListener("drop",e=>{
  e.preventDefault();
  const id=e.dataTransfer.getData("text/plain");
  const rect=$("field").getBoundingClientRect();
  const x=e.clientX-rect.left-95,y=e.clientY-rect.top-25;
  if(studio.definitions[id])addInstance(id,x,y);
  else if(library.templates[id])addTemplate(id,x,y);
});
$("export").addEventListener("click",()=>{
  try{
    const json=JSON.stringify({model:studio.snapshot(),templates:library.snapshot(),construct:construct.snapshot(),positions},null,2);
    const url=URL.createObjectURL(new Blob([json],{type:"application/json"}));
    const a=el("a");a.href=url;a.download="adamantium-capsule-studio-r01.json";a.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
    message("Снимок экспортирован. Он содержит исходный код определений, не добавляй секреты.");
  }catch(e){message(e.message,true);}
});
$("import").addEventListener("click",()=>$("fileInput").click());
$("fileInput").addEventListener("change",async e=>{
  const file=e.target.files[0];if(!file)return;
  try{
    if(file.size>5*1024*1024)throw new TypeError("Файл превышает 5 МБ");
    const parsed=JSON.parse(await file.text());
    const restored=CapsuleStudio.restore(parsed.model);
    const restoredLibrary=CapsuleTemplateLibrary.restore(parsed.templates);
    const restoredConstruct=ConstructEngine.restore(restored,restoredLibrary,parsed.construct);
    const safePositions={};
    if(parsed.positions&&typeof parsed.positions==="object")for(const [graphId,rows] of Object.entries(parsed.positions)) {
      if(!restored.graphs[graphId]||!rows||typeof rows!=="object")continue;
      safePositions[graphId]={};
      for(const [id,p] of Object.entries(rows))if(p&&typeof p==="object")safePositions[graphId][id]={x:clamp(p.x,65,3500),y:clamp(p.y,70,3000)};
    }
    studio=restored;library=restoredLibrary;construct=restoredConstruct;positions=safePositions;activeGraph=studio.rootGraphId;selectedPort=null;selected.clear();
    persist();render();message("Снимок импортирован. Никакой код не запускался.");
  }catch(err){message("Импорт отклонён: "+err.message,true);}
  e.target.value="";
});
$("reset").addEventListener("click",()=>{
  if(!window.confirm("Заменить локальную модель демонстрационным графом? Экспортируй важные изменения перед сбросом."))return;
  studio=seed();library=new CapsuleTemplateLibrary();construct=new ConstructEngine(studio,library);activeGraph=studio.rootGraphId;selectedPort=null;selected.clear();
  persist();render();message("Демонстрационный граф восстановлен.");
});
load();render();
