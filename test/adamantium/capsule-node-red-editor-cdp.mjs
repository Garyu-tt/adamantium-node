/**
 * Real Node-RED 5 R07 CDP acceptance, NOT a native flow editor or runtime.
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
  const close=await evaluate('(function(){RED.actions.invoke("adamantium:toggle-native-canvas");return {layerStillPresent:!!document.querySelector(".adamantium-native-capsule-layer"),flowNodes:document.querySelectorAll(".red-ui-flow-node").length};})()');
  if(close.layerStillPresent)throw Error("Native SVG did not unmount cleanly");
  console.log(JSON.stringify({status:"R07_REAL_NODERED_NATIVE_SVG_PASS",before:pre,after:post,closed:close}));
}finally{ws.close();}
