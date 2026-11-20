/**
 * Native Q Menu R02: bounded, portable, editor-only Node-RED blueprints.
 * No credentials, executable plugin installs, runtime execution, or deploy.
 * SPDX-License-Identifier: Apache-2.0
 */
export const FORMAT="adamantium.native-blueprints/1";
export const MAX_NODES=64;
const TYPES=Object.freeze({
  inject:["name","props","repeat","crontab","once","onceDelay","topic","payload","payloadType"],
  debug:["name","active","tosidebar","console","tostatus","complete","targetType","statusVal","statusType"],
  change:["name","rules","action","property","from","to","reg"],
  switch:["name","property","propertyType","rules","checkall","repair","outputs"],
  delay:["name","pauseType","timeout","timeoutUnits","rate","nbRateUnits","drop","allowrate","outputs"],
  comment:["name","info"],
  json:["name","property","action","pretty"],
  catch:["name","scope","uncaught"]
});
const has=(v,k)=>Object.prototype.hasOwnProperty.call(v,k);
const obj=v=>v!==null&&typeof v==="object"&&!Array.isArray(v);
const copy=v=>JSON.parse(JSON.stringify(v));
const fail=(ok,message)=>{if(!ok)throw new TypeError(message);};
const ID=/^[a-zA-Z][a-zA-Z0-9_.-]{0,95}$/;
const FLOW=/^[a-zA-Z0-9_.:-]{1,128}$/;
function safeData(value,depth=0){
  fail(depth<=12,"nested payload too deep");
  if(value===null||typeof value==="string"||typeof value==="boolean")return;
  if(typeof value==="number"){fail(Number.isFinite(value),"non-finite payload");return;}
  fail(typeof value==="object","non-data payload");
  if(Array.isArray(value)){fail(value.length<=2048,"array budget exceeded");value.forEach(v=>safeData(v,depth+1));return;}
  fail(Object.keys(value).length<=128,"object budget exceeded");
  for(const [k,v] of Object.entries(value)){
    fail(!["__proto__","prototype","constructor"].includes(k),"unsafe payload key");
    fail(k.length<=100,"payload key too long");safeData(v,depth+1);
  }
}
function title(value){fail(typeof value==="string"&&value.trim().length>0&&value.length<=100,"invalid blueprint title");return value.trim();}
function nodesOf(raw){
  fail(obj(raw)&&Array.isArray(raw.nodes)&&raw.nodes.length>=1&&raw.nodes.length<=MAX_NODES,"blueprint node budget exceeded");
  fail(JSON.stringify(raw).length<=96000,"blueprint too large");
  const ids=new Set(),normalized=[];
  for(const node of raw.nodes){
    fail(obj(node)&&typeof node.type==="string"&&has(TYPES,node.type),"unsupported native node type");
    fail(typeof node.id==="string"&&ID.test(node.id)&&!ids.has(node.id),"invalid or repeated blueprint ID");ids.add(node.id);
    fail(Number.isFinite(node.x)&&Number.isFinite(node.y)&&Math.abs(node.x)<=100000&&Math.abs(node.y)<=100000,"invalid node coordinates");
    const out={id:node.id,type:node.type,x:node.x,y:node.y};
    for(const field of TYPES[node.type])if(has(node,field)&&node[field]!==undefined){safeData(node[field]);out[field]=copy(node[field]);}
    fail(Array.isArray(node.wires)&&node.wires.length<=16,"invalid wires");
    out.wires=node.wires.map(w=>{
      fail(Array.isArray(w)&&w.length<=32,"invalid output fanout");
      w.forEach(target=>fail(typeof target==="string"&&ID.test(target),"invalid wire target"));
      return w.slice();
    });
    normalized.push(out);
  }
  for(const node of normalized)for(const list of node.wires)for(const target of list)fail(ids.has(target),"wire escapes selected blueprint");
  return normalized;
}
export function validateBlueprint(raw){return {nodes:nodesOf(raw)};}
export function preparePlacement(blueprint,flowId,position={x:170,y:160}){
  fail(typeof flowId==="string"&&FLOW.test(flowId),"invalid flow ID");
  fail(obj(position)&&Number.isFinite(position.x)&&Number.isFinite(position.y),"invalid placement anchor");
  const nodes=nodesOf(blueprint);
  const minX=Math.min(...nodes.map(n=>n.x)),minY=Math.min(...nodes.map(n=>n.y));
  return nodes.map(n=>({...n,z:flowId,x:Math.max(15,Math.round(position.x+n.x-minX)),
    y:Math.max(15,Math.round(position.y+n.y-minY))}));
}
/**
 * Capture only explicitly approved built-in types. Unknown/custom nodes,
 * config nodes, subflow definitions and arbitrary credentials are rejected.
 * The caller supplies RED.nodes.convertNode(node, {credentials:false}).
 */
export function captureSelection(exported){
  fail(Array.isArray(exported)&&exported.length>=1&&exported.length<=MAX_NODES,"select 1..64 native nodes");
  const selected=new Map(),oldIds=new Set();
  for(let i=0;i<exported.length;i++){
    const raw=exported[i];
    fail(obj(raw)&&typeof raw.id==="string"&&!oldIds.has(raw.id),"duplicate or invalid selection");
    fail(has(TYPES,raw.type),"snapshot supports only vetted built-in types");
    fail(!has(raw,"credentials"),"credentials must never be exported");
    oldIds.add(raw.id);selected.set(raw.id,"native_"+(i+1));
  }
  const nodeRows=exported.map(raw=>{
    const wires=Array.isArray(raw.wires)?raw.wires.map(w=>{
      fail(Array.isArray(w),"invalid native wires");
      return w.filter(target=>selected.has(target)).map(target=>selected.get(target));
    }):[];
    const out={id:selected.get(raw.id),type:raw.type,x:raw.x,y:raw.y,wires};
    for(const field of TYPES[raw.type])if(has(raw,field)&&raw[field]!==undefined){safeData(raw[field]);out[field]=copy(raw[field]);}
    return out;
  });
  return validateBlueprint({nodes:nodeRows});
}
export const BUILTINS=Object.freeze([
  {id:"inject_debug",title:"Триггер → отладка",description:"Локальная диагностическая связка из двух нод",blueprint:{
    nodes:[
      {id:"builtin_src",type:"inject",name:"Start",props:[{p:"payload"}],repeat:"",crontab:"",once:false,onceDelay:0.1,
        topic:"",payload:"",payloadType:"date",x:130,y:150,wires:[["builtin_sink"]]},
      {id:"builtin_sink",type:"debug",name:"Inspect",active:true,tosidebar:true,console:false,tostatus:false,
        complete:"payload",targetType:"msg",x:350,y:150,wires:[]}
    ]}},
  {id:"catch_debug",title:"Перехват ошибок",description:"Catch → Debug без сетевых входов и секретов",blueprint:{
    nodes:[
      {id:"builtin_catch",type:"catch",name:"Error",scope:null,uncaught:false,x:130,y:150,wires:[["builtin_debug"]]},
      {id:"builtin_debug",type:"debug",name:"Errors",active:true,tosidebar:true,console:false,tostatus:false,
        complete:"true",targetType:"full",x:350,y:150,wires:[]}
    ]}},
  {id:"change_debug",title:"Обработка → лог",description:"Change → Debug; безопасная стартовая заготовка",blueprint:{
    nodes:[
      {id:"builtin_change",type:"change",name:"Transform",rules:[],x:120,y:150,wires:[["builtin_debug"]]},
      {id:"builtin_debug",type:"debug",name:"Output",active:true,tosidebar:true,console:false,tostatus:false,
        complete:"true",targetType:"full",x:340,y:150,wires:[]}
    ]}}
]);
for(const preset of BUILTINS)validateBlueprint(preset.blueprint);
export function freshLibrary(){return {format:FORMAT,seq:0,snapshots:[],references:[]};}
export function restoreLibrary(raw){
  if(raw===null||raw===undefined)return freshLibrary();
  fail(obj(raw)&&raw.format===FORMAT&&Number.isSafeInteger(raw.seq)&&raw.seq>=0&&raw.seq<=1000000,"invalid native library");
  fail(Array.isArray(raw.snapshots)&&raw.snapshots.length<=40,"snapshot library budget exceeded");
  fail(Array.isArray(raw.references)&&raw.references.length<=40,"reference library budget exceeded");
  fail(JSON.stringify(raw).length<=2000000,"native library too large");
  const result=freshLibrary();result.seq=raw.seq;
  const used=new Set();
  for(const s of raw.snapshots){
    fail(obj(s)&&typeof s.id==="string"&&ID.test(s.id)&&!used.has(s.id),"invalid blueprint entry");
    used.add(s.id);
    result.snapshots.push({id:s.id,title:title(s.title),blueprint:validateBlueprint(s.blueprint)});
  }
  for(const a of raw.references){
    fail(obj(a)&&typeof a.id==="string"&&ID.test(a.id)&&!used.has(a.id),"invalid reference");
    fail(typeof a.nodeId==="string"&&FLOW.test(a.nodeId),"invalid target node ID");
    fail(typeof a.flowId==="string"&&FLOW.test(a.flowId),"invalid target flow ID");
    used.add(a.id);result.references.push({id:a.id,title:title(a.title),flowId:a.flowId,nodeId:a.nodeId});
  }
  return result;
}
export function addSnapshot(library,name,blueprint){
  const entry=restoreLibrary(library);
  fail(entry.snapshots.length<40,"snapshot library is full");
  const nextId="snapshot_"+(++entry.seq).toString(36);
  entry.snapshots.push({id:nextId,title:title(name),blueprint:validateBlueprint(blueprint)});
  return entry;
}
export function addReference(library,name,flowId,nodeId){
  const entry=restoreLibrary(library);
  fail(entry.references.length<40,"reference library is full");
  fail(typeof flowId==="string"&&FLOW.test(flowId)&&typeof nodeId==="string"&&FLOW.test(nodeId),"invalid reference target");
  const nextId="reference_"+(++entry.seq).toString(36);
  entry.references.push({id:nextId,title:title(name),flowId,nodeId});
  return entry;
}
export function stampBlueprint(blueprint,count=1){
  fail(Number.isInteger(count)&&[1,2,4].includes(count),"unsupported stamp quantity");
  const nodes=nodesOf(blueprint);
  fail(nodes.length*count<=MAX_NODES,"stamp exceeds node budget");
  if(count===1)return {nodes};
  const min=Math.min(...nodes.map(n=>n.x)),max=Math.max(...nodes.map(n=>n.x));
  const width=Math.max(230,Math.round(max-min)+150);
  const stamped=[];
  for(let copyIndex=0;copyIndex<count;copyIndex++){
    const ids=new Map(nodes.map((n,i)=>[n.id,"s"+(copyIndex+1)+"_n"+(i+1)]));
    for(const n of nodes){
      stamped.push({...copy(n),id:ids.get(n.id),x:n.x+copyIndex*width,
        wires:n.wires.map(group=>group.map(target=>ids.get(target)))});
    }
  }
  return validateBlueprint({nodes:stamped});
}

export function makeSubflowPlacement(subflowId,flowId){
  fail(typeof subflowId==="string"&&FLOW.test(subflowId),"invalid subflow ID");
  fail(typeof flowId==="string"&&FLOW.test(flowId),"invalid target flow ID");
  return [{id:"linked_subflow",type:"subflow:"+subflowId,z:flowId,x:180,y:150,wires:[[]]}];
}
