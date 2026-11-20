/**
 * Capsule Studio R02: extract a selection without breaking typed graph edges;
 * capture and reuse recursive graph templates with independently instantiated nodes.
 * Inert editor-only operations, no execution, no MAS grants.
 * SPDX-License-Identifier: Apache-2.0
 */
import { CapsuleStudio } from "./capsule-studio.mjs";

const isObj=v=>v!==null&&typeof v==="object"&&!Array.isArray(v);
const idRe=/^[a-z][a-z0-9_.-]{0,95}$/;
function demand(ok,message){if(!ok)throw new TypeError(message);}
function cleanTitle(title){demand(typeof title==="string"&&title.trim().length>0&&title.length<=128,"invalid capsule title");return title.trim();}
function clone(x){return JSON.parse(JSON.stringify(x));}
function rollback(studio,original){
  // Use the original deep JSON snapshot: rollback must remain possible even
  // if a definition was corrupted or removed before the failed operation.
  studio.seq=original.seq;
  studio.graphs=original.graphs;
  studio.definitions=original.definitions;
  studio.rootGraphId=original.rootGraphId;
  studio.favorites=original.favorites;
}
function transaction(studio,operation){
  const previous=studio.snapshot();
  try{return operation();}
  catch(error){rollback(studio,previous);throw error;}
}
function verifySelection(graph,ids){
  demand(Array.isArray(ids)&&ids.length>0&&ids.length<=128,"select 1..128 nodes");
  const set=new Set(ids);
  demand(set.size===ids.length,"duplicate selected instance");
  for(const id of set) demand(graph.instances.some(node=>node.id===id),"selected node missing: "+id);
  return set;
}
/**
 * Synchronously refactor the parent graph into a capsule. Cross-boundary links
 * retain their edge IDs and contracts. Same interior endpoint fans out through
 * one stable interface port; distinct endpoints remain independent channels.
 */
export function extractSelection(studio,graphId,instanceIds,title="Extracted component"){
  return transaction(studio,()=>{
    const graph=studio.graph(graphId);
    const selected=verifySelection(graph,instanceIds);
    const incoming=graph.edges.filter(e=>!selected.has(e.fromId)&&selected.has(e.toId));
    const outgoing=graph.edges.filter(e=>selected.has(e.fromId)&&!selected.has(e.toId));
    const crossing=[...incoming,...outgoing];
    const distinct=new Set(crossing.map(e=>selected.has(e.toId)?"in:"+e.toId+":"+e.toTag:"out:"+e.fromId+":"+e.fromTag));
    demand(distinct.size<=128,"capsule boundary would exceed 128 ports");
    for(const node of graph.instances.filter(n=>selected.has(n.id)&&n.kind==="capsule")){
      // The moved subtree gains exactly one level of nesting.
      const todo=[node.childGraphId],seen=new Set();
      while(todo.length){
        const next=todo.shift();
        demand(!seen.has(next),"cyclic child graph");seen.add(next);
        demand(studio.path(next).length<32,"nested capsule depth exceeded");
        todo.push(...studio.graph(next).instances.filter(i=>i.kind==="capsule").map(i=>i.childGraphId));
      }
    }
    const result=studio.createCapsule(graphId,cleanTitle(title));
    const child=studio.graph(result.graphId);
    const moved=graph.instances.filter(i=>selected.has(i.id));
    graph.instances=graph.instances.filter(i=>!selected.has(i.id));
    child.instances=moved;
    for(const instance of moved){
      if(instance.kind==="capsule"){
        studio.graph(instance.childGraphId).parent={graphId:child.id,instanceId:instance.id};
      }
    }
    const oldEdges=graph.edges;
    child.edges=oldEdges.filter(e=>selected.has(e.fromId)&&selected.has(e.toId));
    graph.edges=oldEdges.filter(e=>!selected.has(e.fromId)&&!selected.has(e.toId));
    const portByKey=new Map();
    for(const edge of crossing){
      const inwards=selected.has(edge.toId);
      const insideId=inwards?edge.toId:edge.fromId;
      const insideTag=inwards?edge.toTag:edge.fromTag;
      const portKey=(inwards?"in:":"out:")+insideId+":"+insideTag;
      let boundary=portByKey.get(portKey);
      if(!boundary){
        boundary=studio.expose(child.id,{
          side:inwards?"west":"east",
          instanceId:insideId,
          tag:insideTag,
          externalTag:"channel_"+(portByKey.size+1)
        });
        portByKey.set(portKey,boundary);
      }
      graph.edges.push(inwards
        ?{...edge,toId:result.instanceId,toTag:boundary}
        :{...edge,fromId:result.instanceId,fromTag:boundary});
    }
    return {...result,selectedIds:instanceIds.slice(),inboundChannels:incoming.length,outboundChannels:outgoing.length,interfacePorts:portByKey.size};
  });
}
function captureGraph(studio,graphId,depth=0){
  demand(depth<32,"graph template nesting depth exceeded");
  const graph=studio.graph(graphId);
  demand(graph.instances.length<=5000&&graph.edges.length<=20000,"template graph budget exceeded");
  const mappings=new Map(graph.instances.map((node,index)=>[node.id,"n"+index]));
  const nodes=graph.instances.map(node=>{
    if(node.kind==="microprogram"){
      return {kind:"microprogram",localId:mappings.get(node.id),definitionId:node.definitionId,version:node.version,config:clone(node.config)};
    }
    demand(node.kind==="capsule","unknown graph instance kind");
    return {kind:"capsule",localId:mappings.get(node.id),title:node.title,graph:captureGraph(studio,node.childGraphId,depth+1)};
  });
  return {
    title:graph.title,
    nodes,
    boundary:graph.boundary.map(b=>({...clone(b),instanceId:mappings.get(b.instanceId)})),
    edges:graph.edges.map(e=>({...clone(e),fromId:mappings.get(e.fromId),toId:mappings.get(e.toId)}))
  };
}
function materializeGraph(studio,graphId,template,depth=0){
  demand(depth<32,"graph template nesting depth exceeded");
  demand(isObj(template)&&Array.isArray(template.nodes)&&Array.isArray(template.boundary)&&Array.isArray(template.edges),"invalid template graph");
  demand(template.nodes.length<=5000&&template.edges.length<=20000&&template.boundary.length<=128,"template graph budget exceeded");
  const ids=new Map();
  for(const node of template.nodes){
    demand(isObj(node)&&typeof node.localId==="string"&&/^n[0-9]+$/.test(node.localId)&&!ids.has(node.localId),"invalid template local node");
    if(node.kind==="microprogram"){
      const instanceId=studio.place(graphId,node.definitionId,node.version,node.config);
      ids.set(node.localId,instanceId);
    }else{
      demand(node.kind==="capsule"&&isObj(node.graph),"invalid template node");
      const nested=studio.createCapsule(graphId,node.title);
      ids.set(node.localId,nested.instanceId);
      materializeGraph(studio,nested.graphId,node.graph,depth+1);
    }
  }
  for(const b of template.boundary){
    demand(isObj(b)&&ids.has(b.instanceId),"template has missing boundary owner");
    const tag=studio.expose(graphId,{side:b.side,instanceId:ids.get(b.instanceId),tag:b.internalTag,externalTag:b.tag});
    demand(tag===b.tag,"template boundary tag mismatch");
    const actual=studio.graph(graphId).boundary.find(port=>port.tag===tag);
    demand(actual.dataType===b.dataType&&actual.semantics===b.semantics&&actual.direction===b.direction,"template boundary contract mismatch");
  }
  for(const e of template.edges){
    demand(isObj(e)&&ids.has(e.fromId)&&ids.has(e.toId),"template has missing edge endpoint");
    const fromId=ids.get(e.fromId),toId=ids.get(e.toId);
    studio.connect(graphId,{fromId,fromTag:e.fromTag,toId,toTag:e.toTag});
  }
}
function validId(x){demand(typeof x==="string"&&idRe.test(x),"invalid template identifier");return x;}
export class CapsuleTemplateLibrary {
  constructor(){this.seq=0;this.templates={};this.placed=[];}
  capture(studio,graphId,name){
    const graph=studio.graph(graphId);
    demand(graph.parent!==null,"capture a nested graph, not the root");
    const graphCopy=captureGraph(studio,graphId);
    const fingerprint=JSON.stringify(graphCopy);
    for(const entry of Object.values(this.templates)){
      if(entry.fingerprint===fingerprint)return {id:entry.id,reused:true};
    }
    demand(Object.keys(this.templates).length<512,"template registry budget exceeded");
    const id="template_"+(++this.seq).toString(36);
    this.templates[id]={id,name:cleanTitle(name),fingerprint,graph:graphCopy};
    return {id,reused:false};
  }
  place(studio,parentGraphId,templateId){
    const template=this.templates[templateId];
    demand(!!template,"template not found");
    return transaction(studio,()=>{
      const c=studio.createCapsule(parentGraphId,template.name);
      materializeGraph(studio,c.graphId,template.graph);
      this.placed.push({templateId,graphId:c.graphId});
      return c;
    });
  }
  palette(query=""){
    demand(typeof query==="string"&&query.length<=128,"invalid template search");
    return Object.values(this.templates).filter(t=>t.name.toLowerCase().includes(query.toLowerCase()))
      .map(t=>({id:t.id,name:t.name,kind:"capsule",used:this.placed.filter(p=>p.templateId===t.id).length}));
  }
  snapshot(){return clone({format:"adamantium.capsule-templates/1",seq:this.seq,templates:this.templates,placed:this.placed});}
  static restore(raw){
    if(raw===undefined||raw===null)return new CapsuleTemplateLibrary();
    demand(isObj(raw)&&raw.format==="adamantium.capsule-templates/1","invalid template format");
    demand(Number.isSafeInteger(raw.seq)&&raw.seq>=0&&raw.seq<=1000000,"invalid template sequence");
    demand(isObj(raw.templates)&&Object.keys(raw.templates).length<=512&&Array.isArray(raw.placed)&&raw.placed.length<=10000,"invalid template store");
    demand(JSON.stringify(raw).length<=5000000,"template store is too large");
    const l=new CapsuleTemplateLibrary();l.seq=raw.seq;
    for(const [id,t] of Object.entries(raw.templates)){
      validId(id);
      demand(isObj(t)&&t.id===id&&isObj(t.graph)&&typeof t.fingerprint==="string","invalid template entry");
      cleanTitle(t.name);
      demand(JSON.stringify(t.graph)===t.fingerprint,"template fingerprint mismatch");
      l.templates[id]=clone(t);
    }
    for(const p of raw.placed){
      demand(isObj(p)&&l.templates[p.templateId]&&typeof p.graphId==="string"&&idRe.test(p.graphId),"invalid placed template");
      l.placed.push(clone(p));
    }
    return l;
  }
}