/**
 * Real Node-RED 5 R08 zoom and stale-draft CDP acceptance, NOT a native flow editor or runtime.
 * An operator must explicitly supply an isolated safe-mode Node-RED with NO
 * existing flows, plus a private localhost Chrome DevTools debugging session.
 *
 * Example:
 * ADAMANTIUM_R07_DISPOSABLE_SAFE_MODE=1
 * ADAMANTIUM_R07_TEST_EDITOR_URL=http://127.0.0.1:18978/
 * ADAMANTIUM_R07_TEST_CDP_URL=http://127.0.0.1:18979/
 * node test/adamantium/capsule-node-red-editor-cdp.mjs
 *
 * The script does not launch Chrome or Node-RED, does not edit /flows, and
 * refuses non-local endpoints or populated flow registries.
 * SPDX-License-Identifier: Apache-2.0
 */
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const editor=process.env.ADAMANTIUM_R07_TEST_EDITOR_URL;
const debuggerBase=process.env.ADAMANTIUM_R07_TEST_CDP_URL;
if(process.env.ADAMANTIUM_R07_DISPOSABLE_SAFE_MODE!=="1"||!editor||!debuggerBase)
  throw Error("Explicit disposable safe-mode confirmation, editor URL and CDP URL required");
const safeLoopback=(value,label)=>{
  const url=new URL(value);
  if(url.protocol!=="http:"||url.hostname!=="127.0.0.1"||
    ["80","443","1880",""].includes(url.port))
    throw Error("Refusing non-loopback or standard Node-RED port for "+label);
  return url;
};
const editorURL=safeLoopback(editor,"editor");
const cdpURL=safeLoopback(debuggerBase,"CDP");
const flowsResponse=await fetch(new URL("/flows",editorURL));
if(!flowsResponse.ok)throw Error("Cannot verify empty disposable flow registry");
const rawFlows=await flowsResponse.json();
const flows=Array.isArray(rawFlows)?rawFlows:rawFlows?.flows;
if(!Array.isArray(flows)||flows.length!==0)
  throw Error("Refusing editor with preexisting flow entries");
const list=await fetch(new URL("/json/list",cdpURL)).then(r=>r.json());
const page=list.find(p=>p.type==="page"&&p.url.startsWith(editorURL.href));
if(!page)throw Error("isolated Node-RED page missing");
const ws=new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve,reject)=>{
  ws.onopen=resolve;ws.onerror=reject;
  setTimeout(()=>reject(Error("CDP open timeout")),7000);
});
let next=1;const pending=new Map();
ws.onmessage=event=>{
  const message=JSON.parse(event.data);
  if(!message.id)return;
  const item=pending.get(message.id);
  if(!item)return;
  pending.delete(message.id);
  clearTimeout(item.timer);
  if(message.error)item.reject(Error(message.error.message));
  else item.resolve(message.result);
};
async function send(method,params={}){
  const id=next++;
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{pending.delete(id);reject(Error("CDP "+method+" timeout"));},12000);
    pending.set(id,{resolve,reject,timer});
    ws.send(JSON.stringify({id,method,params}));
  });
}
async function evaluate(expression){
  const response=await send("Runtime.evaluate",{expression,returnByValue:true,awaitPromise:true});
  if(response.exceptionDetails)throw Error(response.exceptionDetails.text+" "+JSON.stringify(response.exceptionDetails.exception?.description||""));
  return response.result?.value;
}
try{
  await send("Runtime.enable");
  let pre=null;
  for(let i=0;i<24;i++){
    pre=await evaluate('({red:typeof window.RED,action:typeof window.RED?.actions?.invoke,svg:!!document.querySelector("#red-ui-workspace-chart svg .red-ui-workspace-chart-event-layer"),pluginTab:!!document.querySelector("#adamantium-capsules-r02"),title:document.title,nodeRedNodes:document.querySelectorAll(".red-ui-flow-node").length})');
    if(pre.action==="function"&&pre.svg)break;
    await sleep(400);
  }
  if(pre.action!=="function"||!pre.svg)throw Error("Editor not initialized: "+JSON.stringify(pre));
  // Reruns may inherit a previous failed test's inert overlay. Close that
  // isolated editor-only layer before establishing a fresh initial condition.
  const priorLayer=await evaluate('!!document.querySelector(".adamantium-native-capsule-layer")');
  if(priorLayer){
    await evaluate('RED.actions.invoke("adamantium:toggle-native-canvas")');
    await sleep(200);
    if(await evaluate('!!document.querySelector(".adamantium-native-capsule-layer")'))
      throw Error("Previous isolated editor layer could not be removed");
  }
  const toggled=await evaluate('(function(){try{RED.actions.invoke("adamantium:toggle-native-canvas");return {called:true};}catch(e){return {called:false,error:String(e.message)};}})()');
  if(!toggled.called)throw Error("Action invoke failed: "+JSON.stringify(toggled));
  let post=null;
  for(let i=0;i<25;i++){
    post=await evaluate('({mounted:!!document.querySelector(".adamantium-native-capsule-layer"),cards:document.querySelectorAll(".adamantium-native-capsule-card").length,ports:document.querySelectorAll(".adamantium-native-port").length,wires:document.querySelectorAll(".adamantium-native-wire").length,mode:document.querySelector(".adamantium-native-capsule-layer")?.getAttribute("data-runtime"),authority:document.querySelector(".adamantium-native-capsule-layer")?.getAttribute("data-authority"),layerInside:!!document.querySelector(".red-ui-workspace-chart-event-layer .adamantium-native-capsule-layer"),nativeFlowNodes:document.querySelectorAll(".red-ui-flow-node").length,title:document.title})');
    if(post.mounted)break;
    await sleep(350);
  }
  if(!post.mounted||post.cards<2||post.mode!=="disabled"||!post.layerInside){
    throw Error("Native SVG failed to mount: "+JSON.stringify({pre,post}));
  }
  // In a *disposable* Node-RED profile only, refuse to opt in to its first-
  // launch update telemetry. Other dialogs are not dismissed or clicked.
  const intro=await evaluate('(function(){const dialog=[...document.querySelectorAll(".red-ui-popover.red-ui-dialog")].find(d=>getComputedStyle(d).display!=="none"&&d.textContent?.includes("Enable Update Notifications"));if(!dialog)return "none";const no=[...dialog.querySelectorAll("button")].find(b=>b.textContent.trim()==="No, do not enable notifications");if(!no)throw Error("Cannot safely decline first-launch notifications");no.click();return "declined-test-profile-only";})()');
  if(intro!=="none")await sleep(250);
  const tour=await evaluate('(function(){const pop=[...document.querySelectorAll(".red-ui-tourGuide-popover")].find(e=>getComputedStyle(e).display!=="none");if(!pop)return "none";if(!pop.textContent.includes("Welcome to Node-RED 5.0!"))throw Error("Unexpected tour overlay in test editor");const close=pop.querySelector("button[aria-label=Закрыть],button[aria-label=Close]");if(!close)throw Error("No safe tour close action");close.click();return "closed-disposable-tour";})()');
  if(tour!=="none")await sleep(500);
  let overlayBlock=null;
  for(let i=0;i<20;i++){
    overlayBlock=await evaluate('(function(){const el=document.querySelector(".adamantium-native-capsule-card [data-drag-handle]");const rect=el?.getBoundingClientRect();return {hit:rect?document.elementFromPoint(rect.left+Math.min(40,rect.width*.3),rect.top+Math.min(20,rect.height*.4))?.getAttribute("data-drag-handle"):null,shade:[...document.querySelectorAll(".red-ui-shade,.red-ui-tourGuide-shade")].some(e=>getComputedStyle(e).display!=="none")};})()');
    if(!overlayBlock.shade&&overlayBlock.hit)break;
    await sleep(200);
  }
  if(overlayBlock.shade||!overlayBlock.hit)
    throw Error("Node-RED overlay blocks real SVG drag; refusing blind clicks "+JSON.stringify(overlayBlock));
  // R08: actual Node-RED zoom action, then actual Chrome pointer events.
  await evaluate('RED.actions.invoke("core:zoom-out"); RED.actions.invoke("core:zoom-out");');
  await sleep(1100);
  const dragBefore=await evaluate("(function(){\n  const el=document.querySelector(\".adamantium-native-capsule-card [data-drag-handle]\");\n  if(!el)throw Error(\"no native draggable header\");\n  const rect=el.getBoundingClientRect();\n  const layer=document.querySelector(\".adamantium-native-capsule-layer\");\n  const matrix=layer.getScreenCTM();\n  const card=el.closest(\".adamantium-native-capsule-card\");\n  return {\n    screenX:rect.left+Math.min(40,rect.width*.3),\n    screenY:rect.top+Math.min(20,rect.height*.4),\n    scale:Math.hypot(matrix.a,matrix.b),\n    id:card.getAttribute(\"data-instance-id\"),\n    graph:layer.getAttribute(\"data-active-graph\"),\n    started:card.getAttribute(\"transform\"),\n    viewScale:RED.view.scale()\n  };\n})()");
  if(!dragBefore||!Number.isFinite(dragBefore.scale)||dragBefore.scale>=1||dragBefore.scale<=0)
    throw Error("Expected zoom-out transform in real editor: "+JSON.stringify(dragBefore));
  const startX=dragBefore.screenX,startY=dragBefore.screenY;
  for(const [type,x,y,button,buttons] of [
    ["mouseMoved",startX,startY,"none",0],
    ["mousePressed",startX,startY,"left",1],
    ["mouseMoved",startX+36,startY+22,"left",1],
    ["mouseMoved",startX+50,startY+30,"left",1],
    ["mouseReleased",startX+50,startY+30,"left",0]]){
    await send("Input.dispatchMouseEvent",{type,x,y,button,buttons,clickCount:1});
    await sleep(55);
  }
  await sleep(200);
  const dragAfter=await evaluate("(function(){\n  const raw=JSON.parse(localStorage.getItem(\"adamantium.capsule-studio.r01\"));\n  const layer=document.querySelector(\".adamantium-native-capsule-layer\");\n  return {revision:raw?.draftRevision??null,x:raw?.positions?.[layer.getAttribute(\"data-active-graph\")]?.[document.querySelector(\".adamantium-native-capsule-card\").getAttribute(\"data-instance-id\")]?.x??null,\n  y:raw?.positions?.[layer.getAttribute(\"data-active-graph\")]?.[document.querySelector(\".adamantium-native-capsule-card\").getAttribute(\"data-instance-id\")]?.y??null,\n  raw:localStorage.getItem(\"adamantium.capsule-studio.r01\"),\n  flowNodes:document.querySelectorAll(\".red-ui-flow-node\").length};\n})()");
  if(dragAfter.revision!==1||!Number.isFinite(dragAfter.x)||!Number.isFinite(dragAfter.y))
    throw Error("Native drag did not persist revision 1: "+JSON.stringify({dragBefore,dragAfter}));
  const beforeLocation=/translate\(([0-9.]+),([0-9.]+)\)/.exec(dragBefore.started);
  if(!beforeLocation)throw Error("Native initial card position malformed");
  const expectedX=Number(beforeLocation[1])+50/dragBefore.scale;
  const expectedY=Number(beforeLocation[2])+30/dragBefore.scale;
  if(Math.abs(dragAfter.x-expectedX)>4||Math.abs(dragAfter.y-expectedY)>4)
    throw Error("Drag under zoom has invalid coordinates "+JSON.stringify({expectedX,expectedY,dragAfter,dragBefore}));
  // Simulate a sidebar update without triggering a storage event in this window.
  const outside=await evaluate("(function(){\n  const key=\"adamantium.capsule-studio.r01\";\n  const data=JSON.parse(localStorage.getItem(key));\n  data.draftRevision=43;\n  localStorage.setItem(key,JSON.stringify(data));\n  return localStorage.getItem(key);\n})()");
  const latestLocation=await evaluate("(function(){\n  return document.querySelector(\".adamantium-native-capsule-card\")?.getAttribute(\"transform\");\n})()");
  const retryX=startX+50,retryY=startY+30;
  for(const [type,x,y,button,buttons] of [
    ["mouseMoved",retryX,retryY,"none",0],
    ["mousePressed",retryX,retryY,"left",1],
    ["mouseMoved",retryX+25,retryY+17,"left",1],
    ["mouseReleased",retryX+25,retryY+17,"left",0]]){
    await send("Input.dispatchMouseEvent",{type,x,y,button,buttons,clickCount:1});
    await sleep(50);
  }
  const stored=await evaluate("(function(){\n  const raw=JSON.parse(localStorage.getItem(\"adamantium.capsule-studio.r01\"));\n  const layer=document.querySelector(\".adamantium-native-capsule-layer\");\n  return {revision:raw?.draftRevision??null,x:raw?.positions?.[layer.getAttribute(\"data-active-graph\")]?.[document.querySelector(\".adamantium-native-capsule-card\").getAttribute(\"data-instance-id\")]?.x??null,\n  y:raw?.positions?.[layer.getAttribute(\"data-active-graph\")]?.[document.querySelector(\".adamantium-native-capsule-card\").getAttribute(\"data-instance-id\")]?.y??null,\n  raw:localStorage.getItem(\"adamantium.capsule-studio.r01\"),\n  flowNodes:document.querySelectorAll(\".red-ui-flow-node\").length};\n})()");
  if(stored.raw!==outside||stored.revision!==43)
    throw Error("External draft was overwritten by stale native drag: "+JSON.stringify(stored));
  const zoomProof={scale:dragBefore.scale,revisionAfterDrag:dragAfter.revision,revisionAfterConflict:stored.revision,
    originalFlowNodes:stored.flowNodes,previousGraphX:dragAfter.x,previousGraphY:dragAfter.y};
  const close=await evaluate('(function(){RED.actions.invoke("adamantium:toggle-native-canvas");return {layerStillPresent:!!document.querySelector(".adamantium-native-capsule-layer"),flowNodes:document.querySelectorAll(".red-ui-flow-node").length};})()');
  if(close.layerStillPresent)throw Error("Native SVG did not unmount cleanly");
  console.log(JSON.stringify({status:"R08_REAL_NODERED_ZOOM_CONFLICT_PASS",before:pre,after:post,zoomProof,closed:close}));
}finally{ws.close();}
