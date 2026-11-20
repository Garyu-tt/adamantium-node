/**
 * R05 Native Q editor read-only handoff and explicitly isolated CPU demo.
 * No Node-RED deploy, MAS call or production mutation.
 * SPDX-License-Identifier: Apache-2.0
 */
import {RevisionedGraphKernel} from "./graph-tx.mjs";
const select=(root,id)=>root.querySelector("#"+id);
export function startNativeGraphTx({RED,overlay,core,writable,status,error}){
  const $=id=>select(overlay,id);
  let mirror=null,serial=0,lastReview=null;
  const go=fn=>()=>Promise.resolve().then(fn).catch(error);
  function selectedBlueprint(){
    const flow=writable();
    const selected=RED.view.selection()?.nodes||[];
    if(!selected.length||selected.length>64||selected.some(n=>n.z!==flow))
      throw new TypeError("Для R05 выбери 1..64 разрешённые ноды активного Flow");
    const stable=selected.slice().sort((a,b)=>a.id.localeCompare(b.id));
    const rows=stable.map(n=>RED.nodes.convertNode(n,{credentials:false}));
    return {flow,blueprint:core.captureSelection(rows)};
  }
  function details(value){
    $("ada-r5-output").textContent=typeof value==="string"?value:JSON.stringify(value,null,2);
  }
  function manager(){
    if(!mirror)return;
    const summary=mirror.inspectGraphManagerSnapshot({
      app:"graph_manager",version:1,
      nodes:[{id:"graph_manager.view",type:"view",requires:["graph_manager.read"]}],edges:[]
    });
    $("ada-r5-mode").textContent="Graph Manager 0.1: "+summary.mode+
      ". Применение к рабочему Flow заблокировано. Проверка основана на опубликованном read-only контракте, а не на живом подключении.";
  }
  async function seed(){
    const {flow,blueprint}=selectedBlueprint();
    mirror=await RevisionedGraphKernel.create({flowId:flow,blueprint});
    serial=0;lastReview=null;manager();
    details({status:"local_mirror_initialized",...mirror.status(),
      noExecution:true,warning:"This is a local revision simulator, not the live Node-RED runtime"});
    status("Снимок R05 создан исключительно в памяти страницы. Node-RED не изменён.");
  }
  async function propose(){
    if(!mirror)throw new TypeError("Сначала сними снимок выделения R05");
    const {flow,blueprint}=selectedBlueprint();
    if(flow!==mirror.flowId)throw new TypeError("Исходная вкладка R05 изменилась");
    const p=await mirror.submit({proposalId:"proposal_"+(++serial),
      author:"local_editor",expectedRevision:mirror.activeRevision,
      blueprint,reason:"Manual editor diff preview only"});
    lastReview=mirror.handoff(p.id);
    details(lastReview);status("Создан review-only документ. Запись в Graph Manager не выполняется.");
  }
  function exportReview(){
    if(!lastReview)throw new TypeError("Нет подготовленного предложения");
    details(lastReview);
  }
  async function demo(){
    // A new *isolated* object with a synthetic, test-only authorization
    // callback. No application graph changes. Never treat the synthetic
    // reviewers as real credentials or as an authorized MAS peer quorum.
    const bp=core.BUILTINS[0].blueprint;
    const sim=await RevisionedGraphKernel.create({
      flowId:"local_preview_only",blueprint:bp,authorize:async()=>true
    });
    const first=sim.beginEvent({entryId:"builtin_src",value:{message:"before"}});
    sim.advance(first.ticket,1);
    const next=structuredClone(bp);next.nodes[1].name="Inspect revision 2";
    const candidate=await sim.submit({proposalId:"demo_candidate",author:"synthetic_author",
      expectedRevision:1,blueprint:next,reason:"Explicit isolated demo"});
    sim.review(candidate.id,{reviewer:"synthetic_qa_a",decision:"approve"});
    sim.review(candidate.id,{reviewer:"synthetic_qa_b",decision:"approve"});
    const receipt=await sim.commit({
      proposalId:candidate.id,expectedRevision:1,expectedDigest:candidate.digest});
    const second=sim.beginEvent({entryId:"builtin_src",value:{message:"after"}});
    const earlier=sim.advance(first.ticket,32);
    const later=sim.advance(second.ticket,32);
    const back=await sim.rollback({
      expectedRevision:2,targetRevision:1,reason:"Demonstration of pointer rollback"});
    details({mode:"sandbox_only",syntheticReviewers:true,productionWrites:0,
      atomicSwitch:receipt,oldTicket:{revision:earlier.revision,debug:earlier.debug},
      newTicket:{revision:later.revision,debug:later.debug},
      rollback:back,activeAfterRollback:sim.status().activeRevision});
    status("Демо R05: r1 и r2 исполнились одновременно в памяти, затем выполнен откат. Живой Flow не тронут.");
  }
  $("ada-r5-seed").addEventListener("click",go(seed));
  $("ada-r5-propose").addEventListener("click",go(propose));
  $("ada-r5-export").addEventListener("click",go(exportReview));
  $("ada-r5-demo").addEventListener("click",go(demo));
  $("ada-r5-mode").textContent="Graph Manager 0.1: только чтение; реальных прав на изменение нет.";
  return {seed,propose,demo,review:()=>lastReview};
}
