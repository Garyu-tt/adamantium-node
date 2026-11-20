/**
 * Adamantium R07 — native Node-RED SVG canvas lens, editor-only.
 *
 * This module PAINTS IN the real main Node-RED workspace's SVG node/link
 * layers, without creating Node-RED runtime nodes or touching /flows.
 * Port hit-testing is tied to a stable tag and a concrete SVG circle.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  validateNativeCanvas,positionNativePort,pathNativeWire
} from "./capsule-native-canvas.mjs";

const NS="http://www.w3.org/2000/svg";
const LIMIT_TITLE=38;
function child(parent,tag,attrs={},text){
  const element=parent.ownerDocument.createElementNS(NS,tag);
  for(const [key,value] of Object.entries(attrs))element.setAttribute(key,String(value));
  if(text!==undefined)element.textContent=String(text);
  parent.appendChild(element);
  return element;
}
function shortTitle(value){
  return value.length>LIMIT_TITLE?value.slice(0,LIMIT_TITLE-1)+"…":value;
}
function toLocal(layer,event){
  const svg=layer.ownerSVGElement;
  const matrix=layer.getScreenCTM();
  if(!svg || !matrix)throw new Error("SVG viewport matrix unavailable");
  const point=svg.createSVGPoint();
  point.x=event.clientX;point.y=event.clientY;
  const mapped=point.matrixTransform(matrix.inverse());
  if(!Number.isFinite(mapped.x)||!Number.isFinite(mapped.y))
    throw new Error("SVG coordinates are not finite");
  return mapped;
}
/**
 * @param {object} options
 * RED.view.capsuleCanvas.layers() is patched by the fork's view.js in R07.
 * Callbacks contain intents only: the iframe's CapsuleStudio is authoritative
 * about validating node moves and typed connections.
 */
export function createNativeCanvasLens({
  RED,onNavigate=()=>{},onMove=()=>{},onConnect=()=>{},onWarning=()=>{}
}={}) {
  if(!RED?.view?.capsuleCanvas?.layers || !RED?.workspaces?.active)
    throw new TypeError("Adamantium R07 native view extension unavailable");
  let data=null,active=false,workspace=null,selected=null;
  const startedOn=()=>RED.workspaces.active();
  function syncVisibility(){
    const layers=RED.view.capsuleCanvas.layers();
    if(!layers)return false;
    const visible=active && !!data && workspace===startedOn();
    for(const name of ["nodes","links"]){
      if(layers[name]){
        layers[name].style.display=visible?"":"none";
        layers[name].setAttribute("data-capsule-active",String(visible));
      }
    }
    return visible;
  }
  function render(){
    const layers=RED.view.capsuleCanvas.layers();
    if(!layers)return;
    layers.nodes.replaceChildren();layers.links.replaceChildren();
    if(!syncVisibility())return;
    const nodes=new Map(data.nodes.map(n=>[n.id,n]));
    for(const edge of data.edges){
      const wire=child(layers.links,"path",{
        "class":"red-ui-capsule-native-wire",
        "data-capsule-edge-id":edge.id,
        "d":pathNativeWire(data,edge),
        "fill":"none","stroke":"var(--red-ui-primary-text-color, currentColor)",
        "stroke-width":2,"stroke-opacity":"0.62",
        "vector-effect":"non-scaling-stroke","pointer-events":"none"
      });
      const title=child(wire,"title",{},edge.fromTag+" → "+edge.toTag);
      void title;
    }
    for(const node of data.nodes){
      const group=child(layers.nodes,"g",{
        "class":"red-ui-capsule-native-node",
        "data-capsule-node-id":node.id,
        "transform":"translate("+node.x+","+node.y+")",
        "role":"group",
        "aria-label":node.title
      });
      const background=child(group,"rect",{
        "class":"red-ui-capsule-native-background",
        "width":node.width,"height":node.height,"rx":7,"ry":7,
        "fill":"var(--red-ui-secondary-background-color, var(--red-ui-primary-background-color))",
        "stroke":"var(--red-ui-primary-text-color, currentColor)",
        "stroke-width":1.5
      });
      background.style.cursor="move";
      const header=child(group,"rect",{
        "class":"red-ui-capsule-native-heading",
        "width":node.width,"height":36,"rx":7,"ry":7,
        "fill":"var(--red-ui-primary-background-color)",
        "pointer-events":"none"
      });
      header.style.opacity="0.9";
      child(group,"text",{
        "class":"red-ui-capsule-native-title","x":12,"y":24,
        "font-size":13,"fill":"var(--red-ui-primary-text-color)",
        "pointer-events":"none"
      },shortTitle(node.title));
      child(group,"text",{
        "class":"red-ui-capsule-native-subtitle","x":12,"y":node.height-13,
        "font-size":10,"fill":"var(--red-ui-secondary-text-color, currentColor)",
        "pointer-events":"none"
      },shortTitle(node.subtitle));
      if(node.kind==="capsule"){
        child(group,"text",{
          "class":"red-ui-capsule-native-enter",
          "x":node.width/2,"y":node.height/2+5,
          "text-anchor":"middle","font-size":12,
          "fill":"var(--red-ui-primary-text-color)",
          "pointer-events":"none"
        },"↳ Double-click to enter");
      }
      background.addEventListener("dblclick",event=>{
        event.preventDefault();event.stopPropagation();
        if(node.kind==="capsule")onNavigate({
          graphId:data.graphId,childGraphId:node.childGraphId,nodeId:node.id
        });
      });
      background.addEventListener("pointerdown",event=>{
        // This overlay is not part of Node-RED runtime link creation and must
        // never trigger native node movement/deployment handlers.
        if(event.button!==0||!active)return;
        event.stopPropagation();event.preventDefault();
        let start;
        try{start=toLocal(layers.nodes,event);}
        catch(error){onWarning(error.message);return;}
        const original={x:node.x,y:node.y},view=group;
        function moving(e){
          let current;
          try{current=toLocal(layers.nodes,e);}catch{return;}
          const x=Math.max(0,Math.min(4000,Math.round(original.x+current.x-start.x)));
          const y=Math.max(0,Math.min(4000,Math.round(original.y+current.y-start.y)));
          view.setAttribute("transform","translate("+x+","+y+")");
          view.dataset.pendingX=String(x);
          view.dataset.pendingY=String(y);
        }
        function finish(){
          const win=layers.nodes.ownerDocument.defaultView;
          win.removeEventListener("pointermove",moving);
          win.removeEventListener("pointerup",finish);
          const x=Number(view.dataset.pendingX),y=Number(view.dataset.pendingY);
          if(Number.isFinite(x)&&Number.isFinite(y)&&
            (Math.abs(x-original.x)>1||Math.abs(y-original.y)>1)){
            onMove({graphId:data.graphId,nodeId:node.id,x,y});
          }
          else view.setAttribute("transform","translate("+node.x+","+node.y+")");
          delete view.dataset.pendingX;delete view.dataset.pendingY;
        }
        const win=layers.nodes.ownerDocument.defaultView;
        win.addEventListener("pointermove",moving);
        win.addEventListener("pointerup",finish,{once:true});
      });
      for(const port of node.ports){
        const p=positionNativePort(node,port.tag);
        const cx=p.x-node.x,cy=p.y-node.y;
        const circle=child(group,"circle",{
          "class":"red-ui-capsule-native-port",
          "data-capsule-port-tag":port.tag,
          "data-capsule-side":port.side,
          "data-capsule-direction":port.direction,
          "cx":cx,"cy":cy,"r":7,
          "fill":"var(--red-ui-primary-background-color)",
          "stroke":"var(--red-ui-primary-text-color, currentColor)",
          "stroke-width":2,
          "tabindex":0,"role":"button",
          "aria-label":port.tag+" "+port.direction+" "+port.dataType
        });
        circle.style.cursor="crosshair";
        child(circle,"title",{},port.tag+" · "+port.dataType+" · "+port.semantics);
        function selectPort(event){
          event.stopPropagation();event.preventDefault();
          if(!selected){
            if(port.direction!=="output"){
              onWarning("Choose a source output port first");
              return;
            }
            selected={graphId:data.graphId,nodeId:node.id,tag:port.tag,
              semantics:port.semantics,dataType:port.dataType};
            circle.setAttribute("data-capsule-selected","true");
            return;
          }
          if(selected.graphId!==data.graphId){
            selected=null;onWarning("Graph changed: select source again");render();return;
          }
          if(selected.nodeId===node.id&&selected.tag===port.tag){
            selected=null;render();return;
          }
          if(port.direction!=="input"||
            selected.dataType!==port.dataType||
            selected.semantics!==port.semantics){
            selected=null;render();
            onWarning("Typed port contracts do not match");
            return;
          }
          const intent={graphId:data.graphId,fromId:selected.nodeId,
            fromTag:selected.tag,toId:node.id,toTag:port.tag};
          selected=null;
          onConnect(intent);
        }
        circle.addEventListener("click",selectPort);
        circle.addEventListener("keydown",e=>{
          if(e.key==="Enter"||e.key===" " )selectPort(e);
        });
      }
    }
  }
  function setProjection(next){
    if(next!==null)validateNativeCanvas(next);
    data=next?JSON.parse(JSON.stringify(next)):null;
    selected=null;
    render();
  }
  function show(enabled){
    active=!!enabled;
    if(active)workspace=startedOn();
    selected=null;render();
    return active;
  }
  function refresh(){render();}
  if(RED.events?.on)RED.events.on("workspace:change",()=>{
    selected=null;syncVisibility();
  });
  return {
    show,setProjection,refresh,
    isVisible:()=>syncVisibility(),
    status:()=>({active,workspace,graphId:data?.graphId??null,
      nodes:data?.nodes.length??0,edges:data?.edges.length??0,
      deployable:false,executable:false}),
    clear:()=>{data=null;active=false;selected=null;render();}
  };
}
