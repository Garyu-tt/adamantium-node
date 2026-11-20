/**
 * Adamantium-node R07 — inert projection into the actual Node-RED SVG canvas.
 *
 * Independent from the native Node-RED deployable flow graph. Every port is
 * located by its stable tag and N/E/S/W side, never by an output index.
 * No source code, user secrets, compiler handles or permission grants.
 * SPDX-License-Identifier: Apache-2.0
 */
import {CapsuleStudio} from "./capsule-studio.mjs";

export const CANVAS_FORMAT="adamantium.native-svg-projection/1";
export const SIDES=["north","east","south","west"];
const DIRECTION=["input","output"];
const SEMANTICS=["data","event","control","signal"];
const ID=/^[a-z][a-z0-9_.-]{0,95}$/;
const TYPE=/^[a-zA-Z0-9_.@:-]{1,128}$/;
const object=v=>v!==null&&typeof v==="object"&&!Array.isArray(v);
const fail=(condition,what)=>{if(!condition)throw new TypeError("Capsule native SVG: "+what);};
function exact(v,fields,label){
  fail(object(v) && JSON.stringify(Object.keys(v).sort())===JSON.stringify(fields.slice().sort()),"invalid "+label+" fields");
}
function id(v,label){fail(typeof v==="string"&&ID.test(v),"invalid "+label);return v;}
function title(v,label){fail(typeof v==="string"&&v.length<=128,"invalid "+label);return v;}
function safeInt(v,label){fail(Number.isSafeInteger(v)&&v>=0&&v<=4000,"invalid "+label);return v;}
function normalizePosition(raw,defaultX,defaultY){
  return {x:Math.min(4000,Math.max(0,Number.isFinite(raw?.x)?Math.round(raw.x):defaultX)),
    y:Math.min(4000,Math.max(0,Number.isFinite(raw?.y)?Math.round(raw.y):defaultY))};
}
function nativePort(raw){
  fail(object(raw),"invalid source port");
  const side=raw.side||(raw.direction==="input"?"west":"east");
  return {tag:id(raw.tag,"port tag"),direction:raw.direction,
    dataType:raw.dataType,semantics:raw.semantics,side};
}
function dimensions(kind,ports){
  const columns=SIDES.reduce((o,side)=>{
    o[side]=ports.filter(p=>p.side===side).length;return o;
  },{});
  return {width:kind==="capsule"?270:206,
    height:Math.min(3000,Math.max(kind==="capsule"?152:108,
      52+Math.max(columns.west,columns.east)*26))};
}
export function projectNativeCanvas(studio,{graphId=studio.rootGraphId,positions={}}={}) {
  fail(studio instanceof CapsuleStudio,"expected CapsuleStudio model");
  // Restoring a snapshot re-validates the complete graph, including pinned
  // microprogram versions and external port/edge contracts.
  const verified=CapsuleStudio.restore(studio.snapshot());
  const graph=verified.graph(graphId);
  fail(graph.instances.length<=512&&graph.edges.length<=2048,
    "native lens viewport budget exceeded");
  const nodes=graph.instances.map((instance,index)=>{
    const ports=verified.resolvePorts(graphId,instance.id).map(nativePort);
    const {width,height}=dimensions(instance.kind,ports);
    const place=normalizePosition(positions?.[graphId]?.[instance.id],
      90+index%4*310,120+Math.floor(index/4)*220);
    const isCapsule=instance.kind==="capsule";
    const definition=isCapsule?null:verified.definitions[instance.definitionId];
    return {
      id:instance.id,kind:instance.kind,title:title(isCapsule?instance.title:definition.name,"node title"),
      subtitle:isCapsule?"↳ nested graph":definition.language+" · v"+instance.version,
      childGraphId:isCapsule?instance.childGraphId:"",
      x:place.x,y:place.y,width,height,ports
    };
  });
  const edges=graph.edges.map(e=>({id:e.id,fromId:e.fromId,fromTag:e.fromTag,
    toId:e.toId,toTag:e.toTag}));
  const projection={format:CANVAS_FORMAT,mode:"inert-editor-lens",graphId:graph.id,
    graphTitle:title(graph.title,"graph title"),nodes,edges};
  validateNativeCanvas(projection);
  return projection;
}
export function validateNativeCanvas(p){
  exact(p,["format","mode","graphId","graphTitle","nodes","edges"],"projection");
  fail(p.format===CANVAS_FORMAT&&p.mode==="inert-editor-lens",
    "projection must remain inert");
  id(p.graphId,"graphId");title(p.graphTitle,"graphTitle");
  fail(Array.isArray(p.nodes)&&p.nodes.length<=512&&Array.isArray(p.edges)&&p.edges.length<=2048,
    "projection budget exceeded");
  const nodes=new Map();
  for(const node of p.nodes){
    exact(node,["id","kind","title","subtitle","childGraphId","x","y","width","height","ports"],"node");
    id(node.id,"node id");
    fail(!nodes.has(node.id),"duplicate node");
    fail(["capsule","microprogram"].includes(node.kind),"unsupported node kind");
    title(node.title,"node title");title(node.subtitle,"subtitle");
    if(node.kind==="capsule")id(node.childGraphId,"childGraphId");
    else fail(node.childGraphId==="","microprogram childGraphId forbidden");
    safeInt(node.x,"node x");safeInt(node.y,"node y");
    fail(Number.isSafeInteger(node.width)&&node.width>=180&&node.width<=400 &&
      Number.isSafeInteger(node.height)&&node.height>=90&&node.height<=3000,"node geometry invalid");
    fail(Array.isArray(node.ports)&&node.ports.length<=128,"invalid node ports");
    const names=new Set();
    for(const port of node.ports){
      exact(port,["tag","direction","dataType","semantics","side"],"port");
      id(port.tag,"port tag");fail(!names.has(port.tag),"duplicate port tag");names.add(port.tag);
      fail(DIRECTION.includes(port.direction),"unsupported port direction");
      fail(TYPE.test(port.dataType),"invalid data type");
      fail(SEMANTICS.includes(port.semantics),"semantic-only permission port");
      fail(SIDES.includes(port.side),"invalid port side");
    }
    nodes.set(node.id,node);
  }
  const edges=new Set();
  for(const edge of p.edges){
    exact(edge,["id","fromId","fromTag","toId","toTag"],"edge");
    id(edge.id,"edge id");fail(!edges.has(edge.id),"duplicate edge id");edges.add(edge.id);
    const from=nodes.get(edge.fromId),to=nodes.get(edge.toId);
    fail(!!from&&!!to,"edge points outside graph");
    const fp=from.ports.find(x=>x.tag===edge.fromTag);
    const tp=to.ports.find(x=>x.tag===edge.toTag);
    fail(fp?.direction==="output"&&tp?.direction==="input","invalid wire direction");
    fail(fp.dataType===tp.dataType&&fp.semantics===tp.semantics,
      "incompatible typed wire");
  }
  return {valid:true,graphId:p.graphId,nodes:p.nodes.length,edges:p.edges.length,
    executable:false,authoritative:false};
}
/**
 * Port anchors are in native workspace SVG units, not CSS/viewport pixels.
 * Three or more ports on one side have independent, deterministic hit areas.
 */
export function positionNativePort(node,tag) {
  const port=node.ports.find(p=>p.tag===tag);
  fail(!!port,"unknown port anchor");
  const peers=node.ports.filter(p=>p.side===port.side);
  const index=peers.findIndex(p=>p.tag===tag);
  const f=(index+1)/(peers.length+1);
  let px,py,dx,dy;
  switch(port.side){
  case "north":px=node.width*f;py=0;dx=0;dy=-1;break;
  case "south":px=node.width*f;py=node.height;dx=0;dy=1;break;
  case "west":px=0;py=node.height*f;dx=-1;dy=0;break;
  case "east":px=node.width;py=node.height*f;dx=1;dy=0;break;
  default:throw new Error("unsupported port side");
  }
  return {x:node.x+px,y:node.y+py,dx,dy,side:port.side,
    tag,kind:port.direction,dataType:port.dataType,semantics:port.semantics};
}
export function pathNativeWire(projection,edge){
  const from=projection.nodes.find(n=>n.id===edge.fromId);
  const to=projection.nodes.find(n=>n.id===edge.toId);
  fail(!!from&&!!to,"wire requires endpoints");
  const a=positionNativePort(from,edge.fromTag),b=positionNativePort(to,edge.toTag);
  const distance=Math.hypot(b.x-a.x,b.y-a.y);
  const bend=Math.max(36,Math.min(140,distance*0.35));
  return [
    "M",a.x,a.y,"C",a.x+a.dx*bend,a.y+a.dy*bend,
    b.x+b.dx*bend,b.y+b.dy*bend,b.x,b.y
  ].join(" ");
}
