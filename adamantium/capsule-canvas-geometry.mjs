/**
 * Adamantium-node R07: pure, deterministic 4-sided capsule geometry in the
 * actual Node-RED workspace coordinate system (not CSS/iframe coordinates).
 * No Node-RED flow nodes, runtime grants, or code execution.
 * SPDX-License-Identifier: Apache-2.0
 */
import {CapsuleStudio,SIDES} from "./capsule-studio.mjs";

const BUDGET=128;
const DEFAULT_VISIBLE=4;
const INNER=14;
const SLOT=24;
const DIRECTIONS={north:[0,-1],east:[1,0],south:[0,1],west:[-1,0]};
const finite=(n,fallback,min,max)=>Number.isFinite(n)?Math.max(min,Math.min(max,n)):fallback;
const portKey=(id,tag)=>JSON.stringify([id,tag]);

function geometryPath(a,b){
  const dx=b.x-a.x,dy=b.y-a.y;
  const bend=Math.min(160,Math.max(35,Math.hypot(dx,dy)*.37));
  const fromX=a.x+a.normalX*bend,fromY=a.y+a.normalY*bend;
  const toX=b.x-b.normalX*bend,toY=b.y-b.normalY*bend;
  return "M "+a.x+" "+a.y+" C "+fromX+" "+fromY+" "+toX+" "+toY+" "+b.x+" "+b.y;
}
function inArray(a,id){return a.some(s=>s===id);}
export function layoutCapsuleCanvas(studio,graphId,positions={},expandedSides={}) {
  if(!(studio instanceof CapsuleStudio))throw new TypeError("invalid Capsule Studio");
  const graph=studio.graph(graphId);
  if(!positions||typeof positions!=="object"||Array.isArray(positions))throw new TypeError("invalid positions");
  if(!expandedSides||typeof expandedSides!=="object")throw new TypeError("invalid expansions");
  const cards=[],allPortAnchors=new Map(),visiblePortAnchors=new Map();
  let totalPorts=0;
  for(const [i,instance] of graph.instances.entries()){
    const raw=positions[instance.id]||{};
    const isCapsule=instance.kind==="capsule";
    const x=finite(raw.x,1100+(i%3)*340,0,8000);
    const y=finite(raw.y,180+Math.floor(i/3)*240,0,8000);
    const ports=studio.resolvePorts(graphId,instance.id);
    if(ports.length>BUDGET)throw new TypeError("capsule port budget exceeded");
    totalPorts+=ports.length;
    if(totalPorts>640000)throw new TypeError("canvas port budget exceeded");
    const bySide=Object.fromEntries(SIDES.map(s=>[s,[]]));
    for(const p of ports){
      if(!["input","output"].includes(p.direction))throw new TypeError("invalid direction");
      const side=isCapsule?p.side:(p.direction==="input"?"west":"east");
      if(!inArray(SIDES,side))throw new TypeError("invalid capsule port side");
      bySide[side].push({...p,side});
    }
    const visibleBySide={};
    let maxVertical=0,maxHorizontal=0,hiddenTotal=0;
    for(const side of SIDES) {
      const all=bySide[side];
      const expanded=expandedSides[JSON.stringify([instance.id,side])]===true;
      const visible=all.slice(0,expanded?BUDGET:DEFAULT_VISIBLE);
      const hiddenCount=all.length-visible.length;
      visibleBySide[side]={visible,hiddenCount,total:all.length,expanded};
      hiddenTotal+=hiddenCount;
    }
    maxVertical=Math.max(visibleBySide.west.visible.length,visibleBySide.east.visible.length);
    maxHorizontal=Math.max(visibleBySide.north.visible.length,visibleBySide.south.visible.length);
    const width=Math.max(isCapsule?280:220,INNER*2+Math.max(1,maxHorizontal)*SLOT);
    const height=Math.max(isCapsule?168:118,INNER*2+Math.max(1,maxVertical)*SLOT);
    const title=isCapsule?instance.title:studio.definitions[instance.definitionId]?.name||"Unknown definition";
    const card={id:instance.id,kind:instance.kind,title,childGraphId:isCapsule?instance.childGraphId:null,
      x,y,width,height,ports:[],sides:visibleBySide,hiddenTotal};
    for(const side of SIDES){
      const entry=visibleBySide[side],all=bySide[side];
      for(const [index,p] of all.entries()){
        const visible=index<entry.visible.length;
        // Collapsed anchors are laid out over the visible subset, not packed
        // into the first 4/128th of the rail. Hidden anchors retain separate
        // model identities but are deliberately not selectable or wired.
        const slots=visible?entry.visible.length:all.length;
        const fraction=(index+1)/(slots+1);
        let px,py,normalX=DIRECTIONS[side][0],normalY=DIRECTIONS[side][1];
        if(side==="north"||side==="south"){
          px=x+fraction*width;
          py=y+(side==="north"?0:height);
        }else {
          px=x+(side==="west"?0:width);
          py=y+fraction*height;
        }
        // A collapsed side is a visibility filter, never a port remapping.
        // Each hidden port keeps its own stable, distinct anchor geometry.
        const anchor={instanceId:instance.id,tag:p.tag,direction:p.direction,
          dataType:p.dataType,semantics:p.semantics,side,x:px,y:py,normalX,normalY,visible};
        allPortAnchors.set(portKey(instance.id,p.tag),anchor);
        if(visible){
          visiblePortAnchors.set(portKey(instance.id,p.tag),anchor);
          card.ports.push(anchor);
        }
      }
    }
    cards.push(card);
  }
  const wires=[];
  let hiddenLinks=0;
  for(const edge of graph.edges){
    const from=allPortAnchors.get(portKey(edge.fromId,edge.fromTag));
    const to=allPortAnchors.get(portKey(edge.toId,edge.toTag));
    if(!from||!to)throw new TypeError("missing typed edge endpoint");
    if(!from.visible||!to.visible){
      hiddenLinks++;continue;
    }
    if(from.direction!=="output"||to.direction!=="input"||
      from.dataType!==to.dataType||from.semantics!==to.semantics)
      throw new TypeError("typed edge mismatch");
    wires.push({id:edge.id,fromId:edge.fromId,fromTag:edge.fromTag,
      toId:edge.toId,toTag:edge.toTag,d:geometryPath(from,to),
      from:{x:from.x,y:from.y,side:from.side},
      to:{x:to.x,y:to.y,side:to.side}});
  }
  return {graphId,cards,wires,hiddenLinks,graphPath:studio.path(graphId),
    hasNestedView:graph.parent!==null,modelType:"editor-only",runtimeActivated:false};
}
