/**
 * R04 local vault adapter: UI -> verified plan -> one native editor import.
 * No network, runtime deploy, global MAS action or automatic publishing.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  emptyVault,validateVault,putPackage,importVault,exportVault,
  planConstruction,compileConstruction,ConstructionQueue
} from "./vault.mjs";

const KEY="adamantium.native-q-vault.r04";
const sel=(root,id)=>root.querySelector("#"+id);
const ident=/^[a-z][a-z0-9_.-]{0,63}$/;

export async function startNativeVault({RED,overlay,core,writable,status,error,refresh,hideDialog}){
  const $=id=>sel(overlay,id);
  let raw=null;try{raw=window.localStorage.getItem(KEY);}catch{}
  let vault=await validateVault(raw?JSON.parse(raw):null);
  let plan=null,plannedFlow=null,expectedStamp=null,serial=0;
  const queue=new ConstructionQueue();
  const text=(id,message)=>{$(id).textContent=message;};
  function updateStats(){
    const versions=vault.entries.length;
    const definitions=new Set(vault.entries.map(e=>e.id)).size;
    text("ada-vault-stats",definitions+" определений · "+versions+
      " версий · "+queue.status().queued+" ожидает");
  }
  function selections(){
    const flow=writable();
    const nodes=RED.view.selection()?.nodes||[];
    if(!nodes.length||nodes.some(n=>n.z!==flow))
      throw new TypeError("Выбери ноды одного открытого Flow");
    return nodes.map(n=>RED.nodes.convertNode(n,{credentials:false}));
  }
  function readDependencies(){
    const value=$("ada-vault-deps").value.trim();
    if(!value)return [];
    return value.split(",").map(part=>{
      const match=/^([a-z][a-z0-9_.-]{0,63})@([1-9][0-9]?)$/.exec(part.trim());
      if(!match)throw new TypeError("Зависимости: package_id@version через запятую");
      return {id:match[1],version:Number(match[2])};
    });
  }
  async function refreshCurrent(){
    let latest=null;
    try{latest=window.localStorage.getItem(KEY);}catch{}
    const other=await validateVault(latest?JSON.parse(latest):null);
    if(other.revision!==vault.revision)
      throw new TypeError("Библиотека изменилась в другой вкладке. Обнови страницу.");
  }
  async function save(next){
    await refreshCurrent();
    const checked=await validateVault(next);
    // localStorage is best-effort only; no cross-browser transaction guarantee.
    window.localStorage.setItem(KEY,JSON.stringify(checked));
    vault=checked;plan=null;expectedStamp=null;
    updateStats();refresh();
  }
  async function saveSelection(){
    const rawNodes=selections();
    const id=$("ada-vault-id").value.trim();
    const version=Number($("ada-vault-version").value);
    const title=$("ada-vault-title").value.trim();
    if(!ident.test(id))throw new TypeError("ID: латинские буквы, цифры, точки и дефисы (от 1 символа)");
    const bp=core.captureSelection(rawNodes);
    const entry={id,version,title,sourceAccess:$("ada-vault-source").value,
      distribution:$("ada-vault-distribution").value,
      publicListing:$("ada-vault-public").checked,
      dependencies:readDependencies(),blueprint:bp};
    if(!window.confirm("Сохранить эту версию локально? Данные нод могут включать конфиденциальные текстовые значения."))
      return;
    await save(await putPackage(vault,entry,{expectedRevision:vault.revision}));
    status("Пакет "+id+"@"+version+" сохранён; версия неизменяема.");
  }
  async function pasteImport(){
    const value=$("ada-vault-json").value.trim();
    if(!value||value.length>1500000)throw new TypeError("JSON отсутствует или превышает лимит");
    const decoded=await validateVault(JSON.parse(value));
    if(!window.confirm("Импортировать "+decoded.entries.length+" проверяемых по SHA-256 версий из JSON?"))
      return;
    await save(await importVault(vault,decoded,{expectedRevision:vault.revision}));
    status("Проверенные версии добавлены локально.");
  }
  async function exportToText(publicOnly){
    if(!publicOnly&&!window.confirm("Частный архив включает закрытые исходники и настройки! Экспортировать полный JSON?"))
      return;
    const exported=await exportVault(vault,{publicOnly});
    $("ada-vault-json").value=JSON.stringify(exported,null,2);
    status(publicOnly?
      "В текстовое поле выгружен только явно разрешённый публичный каталог.":
      "Полный локальный архив помещён в текстовое поле. Не публикуй его автоматически.");
  }
  async function flowSignature(flowId){
    const nodes=(RED.nodes.filterNodes({z:flowId})||[])
      .map(n=>({id:n.id,type:n.type,x:n.x,y:n.y,changed:n.changed===true}))
      .sort((a,b)=>a.id.localeCompare(b.id));
    const links=[];RED.nodes.eachLink(l=>{
      if(l.source?.z===flowId)links.push([l.source.id,l.sourcePort,l.target.id]);
    });
    links.sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
    const encoded=new TextEncoder().encode(JSON.stringify({nodes,links}));
    const digest=await crypto.subtle.digest("SHA-256",encoded);
    return Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,"0")).join("");
  }
  function currentEntries(){
    const newest=new Map();
    for(const e of vault.entries){
      const item=newest.get(e.id);
      if(!item||item.version<e.version)newest.set(e.id,e);
    }
    return Array.from(newest.values()).sort((a,b)=>a.id.localeCompare(b.id));
  }
  async function preview(entry){
    const flow=writable();
    plan=await planConstruction(vault,[{id:entry.id,version:entry.version}]);
    expectedStamp=await flowSignature(flow);
    plannedFlow=flow;
    const detail=plan.steps.map(s=>s.id+"@"+s.version+" ("+s.nodeCount+" нод)").join(" → ");
    $("ada-vault-plan").textContent="План: "+detail+"\nВсего: "+plan.totals.nodes+
      " нод, "+plan.totals.edges+" соединений, "+plan.totals.constructionUnits+
      " условных строительных единиц.\nИзменения не будут выполнены, пока не нажата кнопка «Построить».";
    $("ada-vault-build").disabled=false;
    $("ada-vault-panel").open=true;
    updateStats();
  }
  async function build(){
    if(!plan||!plannedFlow||!expectedStamp)throw new TypeError("Сначала проверь план строительства");
    const flow=writable();
    if(flow!==plannedFlow)throw new TypeError("Активная вкладка изменилась");
    const currentStamp=await flowSignature(flow);
    if(currentStamp!==expectedStamp)throw new TypeError("Flow изменился. Пересобери план.");
    const ticket="vault_"+(++serial);
    queue.enqueue({ticket,flowId:flow,planId:plan.planId,expectedStamp});
    let active=null;
    try{
      active=queue.acquire(flow,currentStamp);
      const nodes=await compileConstruction(vault,plan,flow);
      for(const node of nodes){
        if(!RED.nodes.getType(node.type))throw new TypeError("Не установлен тип: "+node.type);
      }
      hideDialog();
      const imported=RED.view.importNodes(nodes,{
        generateIds:true,generateDefaultNames:true,touchImport:false,notify:true,
        eventContext:{source:"adamantium-construct-native-r04",planId:plan.planId}
      });
      const mapped=imported?.nodeMap||{};
      if(Object.keys(mapped).length!==nodes.length)
        throw new TypeError("Node-RED вернул неполную квитанцию импорта; проверь граф вручную");
      queue.settle(flow,ticket,{ok:true,createdIds:Object.values(mapped).map(n=>n.id||n)});
      status("Импортировано "+nodes.length+" нод по плану. Deploy не выполнялся.");
    }catch(e){
      if(active&&queue.status().active)queue.settle(flow,ticket,{ok:false});
      else queue.cancel(ticket);
      throw e;
    }finally{
      plan=null;plannedFlow=null;expectedStamp=null;
      $("ada-vault-build").disabled=true;updateStats();
    }
  }
  function button(value,callback){
    const b=document.createElement("button");b.type="button";b.textContent=value;
    b.addEventListener("click",()=>Promise.resolve().then(callback).catch(error));
    return b;
  }
  function render(cards,query=""){
    cards.replaceChildren();
    const found=currentEntries().filter(e=>(e.title+" "+e.id).toLowerCase().includes(query.toLowerCase().trim()));
    for(const entry of found){
      const item=document.createElement("article");item.className="adamantium-construct-card";
      const label=document.createElement("div");
      const strong=document.createElement("strong");strong.textContent=entry.title+" · v"+entry.version;
      const hint=document.createElement("small");
      hint.textContent=entry.id+" · "+entry.sourceAccess+"/"+entry.distribution+
        (entry.publicListing?" · публичный":" · локальный")+
        " · "+entry.dependencies.length+" зависимостей";
      label.append(strong,hint);
      item.append(label,button("Спланировать",()=>preview(entry)));
      cards.append(item);
    }
    if(!found.length){
      const empty=document.createElement("p");
      empty.textContent="Библиотека пуста. Выдели ноды и сохрани первую сборку ниже.";
      cards.append(empty);
    }
    updateStats();
    status(found.length+" пакетов доступно для локального планирования.");
  }
  $("ada-vault-save").addEventListener("click",()=>Promise.resolve().then(saveSelection).catch(error));
  $("ada-vault-import").addEventListener("click",()=>Promise.resolve().then(pasteImport).catch(error));
  $("ada-vault-export-public").addEventListener("click",()=>Promise.resolve().then(()=>exportToText(true)).catch(error));
  $("ada-vault-export-private").addEventListener("click",()=>Promise.resolve().then(()=>exportToText(false)).catch(error));
  $("ada-vault-build").addEventListener("click",()=>Promise.resolve().then(build).catch(error));
  updateStats();
  return {render,status:()=>queue.status(),vault:()=>vault};
}
