/**
 * Adamantium-node R07: deterministic, non-executable four-sided SVG projection.
 * No Node-RED flow nodes, runtime grants, file writes or graph activation.
 * SPDX-License-Identifier: Apache-2.0
 */
import {SIDES} from "./capsule-studio.mjs";
const VALID=new Set(SIDES);
const DEFAULT_LIMIT=4;
const SIZE_LIMIT=1200;
const clamp=(n,a,b)=>Math.min(b,Math.max(a,Number.isFinite(n)?n:a));
function check(ok,msg){if(!ok)throw new TypeError("Capsule native layout: "+msg);}
function asPoint(raw,index){
  const fallback={x:160+(index%4)*370,y:180+Math.floor(index/4)*240};
  if(!raw || typeof raw!=="object")return fallback;
  return {x:clamp(Number(raw.x),32,7900),y:clamp(Number(raw.y),40,7900)};
}
function checkIdentifier(x){check(typeof x==="string"&&/^[a-z][a-z0-9_.-]{0,95}$/.test(x),"invalid node identifier");}
function tangent(side){
  return side==="north"?[0,-1]:side==="south"?[0,1]:side==="east"?[1,0]:[-1,0];
}
export function layoutCapsuleGraph(studio,graphId,positions={},expanded=new Set()){
  check(studio&&typeof studio.graph==="function"&&typeof studio.resolvePorts==="function","missing studio");
  check(positions&&typeof positions==="object"&&!Array.isArray(positions),"bad position map");
  check(expanded instanceof Set,"expanded side set expected");
  const graph=studio.graph(graphId);
  check(graph.instances.length<=SIZE_LIMIT,"too many nodes for interactive canvas; use sidebar");
  const nodes=[],index=new Map();
  for(const [i,instance] of graph.instances.entries()){
    checkIdentifier(instance.id);
    const ports=studio.resolvePorts(graphId,instance.id);
    check(Array.isArray(ports)&&ports.length<=128,"port budget exceeded");
    const sides={north:[],east:[],south:[],west:[]};
    const tags=new Set();
    for(const port of ports){
      check(port&&typeof port.tag==="string"&&!tags.has(port.tag),"duplicate node port");
      tags.add(port.tag);
      const side=port.side||(port.direction==="input"?"west":"east");
      check(VALID.has(side),"invalid port side");
      sides[side].push({...port,side});
    }
    const visibility=Object.create(null);
    let width=instance.kind==="capsule"?296:238;
    let height=instance.kind==="capsule"?164:126;
    for(const side of SIDES){
      const open=expanded.has(instance.id+":"+side),length=sides[side].length;
      visibility[side]={shown:open?length:Math.min(length,DEFAULT_LIMIT),
        hidden:open?0:Math.max(0,length-DEFAULT_LIMIT),expanded:open};
      const shown=visibility[side].shown;
      if((side==="north"||side==="south")&&open){
        width=Math.max(width,48+shown*66);
      }
      if((side==="west"||side==="east")&&open){
        height=Math.max(height,54+shown*25);
      }
    }
    const pos=asPoint(positions[instance.id],i);
    const anchors=Object.create(null);
    for(const side of SIDES){
      const list=sides[side],len=list.length;
      list.forEach((port,portIndex)=>{
        const dx=tangent(side)[0],dy=tangent(side)[1];
        const isHorizontal=side==="north"||side==="south";
        const progress=(portIndex+1)/(len+1);
        anchors[port.tag]={
          tag:port.tag,side,direction:port.direction,
          dataType:port.dataType,semantics:port.semantics,
          hidden:portIndex>=visibility[side].shown,
          x:pos.x+(isHorizontal?width*progress:(side==="east"?width:0)),
          y:pos.y+(isHorizontal?(side==="south"?height:0):height*progress),
          dx,dy
        };
      });
    }
    const name=instance.kind==="capsule"?instance.title:studio.definitions[instance.definitionId]?.name;
    check(typeof name==="string"&&name.length<=128,"missing node display name");
    const output={
      id:instance.id,kind:instance.kind,title:name,
      subtitle:instance.kind==="capsule"?"Recursive capsule":"Source-only microprogram",
      graphId,childGraphId:instance.kind==="capsule"?instance.childGraphId:null,
      x:pos.x,y:pos.y,width,height,sides,visibility,anchors
    };
    nodes.push(output);index.set(output.id,output);
  }
  const edges=graph.edges.map(edge=>{
    const from=index.get(edge.fromId)?.anchors[edge.fromTag],
      to=index.get(edge.toId)?.anchors[edge.toTag];
    check(from&&to&&from.direction==="output"&&to.direction==="input",
      "dangling or wrong-direction wire "+edge.id);
    check(from.dataType===to.dataType&&from.semantics===to.semantics,
      "typed wire contract mismatch");
    const length=Math.hypot(from.x-to.x,from.y-to.y);
    const bend=Math.max(38,Math.min(120,length*.35));
    const curve="M "+from.x+" "+from.y+" C "+
      (from.x+from.dx*bend)+" "+(from.y+from.dy*bend)+" "+
      (to.x-to.dx*bend)+" "+(to.y-to.dy*bend)+" "+to.x+" "+to.y;
    return {id:edge.id,fromId:edge.fromId,fromTag:edge.fromTag,
      toId:edge.toId,toTag:edge.toTag,from,to,path:curve};
  });
  const extent=nodes.reduce((r,n)=>({
    width:Math.max(r.width,n.x+n.width+120),
    height:Math.max(r.height,n.y+n.height+120)
  }),{width:1100,height:680});
  return {graphId,title:graph.title,rootGraphId:studio.rootGraphId,
    parentGraphId:studio.exit(graphId),nodes,edges,extent,
    boundary:SIDES.map(side=>studio.boundaryCard(graphId,side,4))};
}
