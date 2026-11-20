/**
 * Adapter binding pure Construct R03 event plans to the NATIVE Node-RED editor.
 * Import/delete use the editor's own history, not runtime/admin APIs.
 * SPDX-License-Identifier: Apache-2.0
 */
import {ReactiveCoordinator,REACTIVE_ORIGIN,restoreReactionRules} from "./reactor.mjs";
const STORAGE="adamantium.native-q-reactions.r03";
const TYPES=["inject","debug","change","switch","delay","comment","json","catch"];
const field=(root,id)=>root.querySelector("#"+id);
export function startNativeReactions({RED,overlay,ensureLoaded,buildPreset,writable,renderPalette,status,error}){
  const $=id=>field(overlay,id);
  const p=x=>Promise.resolve().then(x).catch(error);
  const saveRules=()=>{
    // Save rules/configuration only, never session approvals or node ownership.
    const raw=coordinator.rulesSnapshot();
    window.localStorage.setItem(STORAGE,JSON.stringify(raw));
  };
  let snapshot=null;
  try{snapshot=JSON.parse(window.localStorage.getItem(STORAGE));}catch{}
  const coordinator=new ReactiveCoordinator(snapshot);
  let currentSerial=0,draining=false;
  const fingerprints=new Map();
  for(const t of TYPES){
    const option=document.createElement("option");option.value=t;option.textContent=t;
    $("ada-r3-trigger").appendChild(option);
  }
  function renderRules(){
    const target=$("ada-r3-rules");target.replaceChildren();
    for(const r of coordinator.list()){
      const line=document.createElement("div");line.className="adamantium-r3-rule";
      const title=document.createElement("span");
      title.textContent=r.whenType+" → "+r.presetId+(r.cleanup?" · авточистка":"");
      const toggle=document.createElement("input");
      toggle.type="checkbox";toggle.checked=r.enabled;
      toggle.setAttribute("aria-label","Включить правило "+r.id);
      toggle.addEventListener("change",()=>{
        coordinator.setEnabled(r.id,toggle.checked);
        try{saveRules();}catch(e){error(e);}
        renderRules();
      });
      const label=document.createElement("label");label.append(toggle,title);
      const remove=document.createElement("button");remove.type="button";remove.textContent="Удалить";
      remove.addEventListener("click",()=>{
        coordinator.removeRule(r.id);
        try{saveRules();}catch(e){error(e);}
        renderRules();
      });
      line.append(label,remove);target.append(line);
    }
    $("ada-r3-stats").textContent=coordinator.enabledCount()+" включено · "+
      coordinator.status().queued+" в очереди · максимум 48 операций/сессию";
    if(coordinator.list().length===0)
      $("ada-r3-rules").textContent="Правил нет. Сначала добавь одно.";
  }
  $("ada-r3-add").addEventListener("click",()=>{
    try{
      let id;
      do{id="r3_"+(++currentSerial).toString(36);}while(coordinator.list().some(r=>r.id===id));
      const rule=coordinator.addRule({id,event:"nodes:add",whenType:$("ada-r3-trigger").value,
        presetId:$("ada-r3-preset").value,enabled:false,
        cleanup:$("ada-r3-cleanup").checked,maxPerFlow:Number($("ada-r3-max").value)});
      saveRules();
      renderRules();
      status("Правило "+rule.id+" создано выключенным. Включи его вручную.");
    }catch(e){error(e);}
  });
  for(const preset of ["inject_debug","catch_debug","change_debug"]){
    const option=document.createElement("option");option.value=preset;option.textContent=preset;
    $("ada-r3-preset").appendChild(option);
  }
  // Status and auto-approval are browser-session-local. No reload of enabled
  // rules and no history of target node fingerprints into persistent storage.
  renderRules();
  function eligible(flowId){
    if(RED.workspaces.active()!==flowId)return false;
    try{return writable()===flowId;}catch{return false;}
  }
  function eventOf(type,node,options){
    if(!node?.id||!node?.z||!TYPES.includes(node.type))return null;
    const origin=options?.source||options?.eventContext?.source||"native-user";
    return {event:type,flowId:node.z,nodeId:node.id,nodeType:node.type,origin:String(origin).slice(0,128)};
  }
  function schedule(){
    if(draining)return;
    draining=true;
    Promise.resolve().then(async()=>{
      try{
        let plan;
        while((plan=coordinator.next())){
          let success=false,ids=[];
          try{
            if(!eligible(plan.flowId))throw new TypeError("Flow недоступен или заблокирован");
            if(plan.action==="build"){
              const source=RED.nodes.node(plan.sourceId);
              if(!source||source.z!==plan.flowId)throw new TypeError("Исходная нода отсутствует");
              const before=new Set((RED.nodes.filterNodes({z:plan.flowId})||[]).map(n=>n.id));
              await ensureLoaded();
              await buildPreset(plan.presetId,REACTIVE_ORIGIN+":"+plan.ruleId);
              ids=(RED.nodes.filterNodes({z:plan.flowId})||[]).map(n=>n.id).filter(id=>!before.has(id));
              if(ids.length<1||ids.length>64)throw new TypeError("Неверный размер построенной сборки");
              const fingerprint=new Map();
              for(const id of ids){
                const node=RED.nodes.node(id);
                if(!node||node.z!==plan.flowId)throw new TypeError("Не найдена построенная нода");
                fingerprint.set(id,JSON.stringify(RED.nodes.convertNode(node,{credentials:false})));
              }
              fingerprints.set(plan.id,fingerprint);
              success=true;
            } else if(plan.action==="cleanup"){
              const owned=coordinator.getOwned(plan.flowId,plan.sourceId,plan.ruleId);
              const expected=fingerprints.get(owned?.planId);
              if(!owned||!expected||expected.size!==owned.nodeIds.length)
                throw new TypeError("Отсутствует проверенная запись владения");
              // If the source is back (Undo), never delete a generated assembly.
              if(RED.nodes.node(plan.sourceId))throw new TypeError("Исходная нода восстановлена");
              const ownedIds=new Set(owned.nodeIds);
              for(const id of ownedIds){
                const node=RED.nodes.node(id);
                if(!node||node.z!==plan.flowId)throw new TypeError("Сборка изменилась: отсутствует нода");
                if(JSON.stringify(RED.nodes.convertNode(node,{credentials:false}))!==expected.get(id))
                  throw new TypeError("Сборка редактировалась; автоудаление запрещено");
                const links=[...RED.nodes.getNodeLinks(node,0),...RED.nodes.getNodeLinks(node,1)];
                if(links.some(l=>!ownedIds.has(l.source.id)||!ownedIds.has(l.target.id)))
                  throw new TypeError("Обнаружены внешние соединения; автоудаление запрещено");
              }
              const previous=(RED.view.selection()?.nodes||[]).map(n=>n.id);
              RED.view.select({nodes:owned.nodeIds.map(id=>RED.nodes.node(id))});
              RED.actions.invoke("core:delete-selection");
              const left=owned.nodeIds.filter(id=>RED.nodes.node(id));
              if(left.length)throw new TypeError("Удаление выполнено не полностью");
              const still=previous.map(id=>RED.nodes.node(id)).filter(Boolean);
              RED.view.select({nodes:still});
              fingerprints.delete(owned.planId);
              success=true;
            }
            status(plan.action==="build"?
              "Конструктор добавил "+ids.length+" нод в Flow. Deploy не выполнялся.":
              "Автосборка удалена после проверки владения, состояния и соединений.");
          }catch(e){
            error(e);
          }finally{
            coordinator.complete(plan.id,{success,nodeIds:ids});
            renderRules();
          }
        }
      }finally{draining=false;}
    }).catch(e=>{draining=false;error(e);});
  }
  function observe(type,node,opts){
    const ev=eventOf(type,node,opts);
    if(!ev)return;
    if(ev.origin.startsWith("adamantium-construct-native-"))return;
    if(!eligible(ev.flowId))return;
    try{
      const added=coordinator.accept(ev);
      if(added.enqueued) schedule();
    }catch(e){error(e);}
  }
  RED.events.on("nodes:add",(node,context)=>observe("nodes:add",node,context));
  RED.events.on("nodes:remove",node=>observe("nodes:remove",node,{source:"native-user"}));
  // Hot-loaded plugin or subflow registration updates search results
  // without requiring the editor process to restart.
  const refresh=()=>{
    if(overlay.hidden)return;
    p(renderPalette);
  };
  for(const e of ["registry:node-type-added","registry:node-type-removed",
    "registry:node-set-enabled","registry:node-set-disabled",
    "subflows:add","subflows:remove","subflows:change"])RED.events.on(e,refresh);
  return {coordinator,renderRules};
}
