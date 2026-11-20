/**
 * Adamantium-node Capsule Studio R03: editor-only Graph IR proposal projection.
 *
 * The exported graph documents conform to the structural graph-ir-v1 contract
 * (ToolBox draft PR #143); the separately typed boundaryBindings retain UX
 * side/location semantics which cannot be expressed in the canonical v1 IR.
 *
 * No graph execution, authorization, persistence, hot swap or deployments.
 * SPDX-License-Identifier: Apache-2.0
 */
import { CapsuleStudio } from "./capsule-studio.mjs";
import { createReadOnlyProjection, SOURCE_SCHEMA } from "./editor-projection.mjs";

export const IR_PROPOSAL_VERSION = "adamantium.capsule-ir-proposal/1";
const DOMAINS = new Set(["general","program","genesis","neural","infrastructure","interface"]);
const SEMANTICS = new Set(["data","control","event","signal"]);
const OBJECT = value => value!==null && typeof value==="object" && !Array.isArray(value);
function ensure(ok,detail){if(!ok)throw new TypeError("Capsule IR proposal: "+detail);}
function clone(value){return JSON.parse(JSON.stringify(value));}
function exact(value,expected,context){
  ensure(OBJECT(value),context+" must be object");
  const actual=Object.keys(value).sort();
  const wanted=expected.slice().sort();
  ensure(JSON.stringify(actual)===JSON.stringify(wanted),context+" has unknown/missing fields");
}
const byId = (a,b)=>a.id.localeCompare(b.id);
function port(p) {
  ensure(OBJECT(p) && SEMANTICS.has(p.semantics),"forbidden port semantics");
  return {id:p.tag,dataType:p.dataType,direction:p.direction,semantics:p.semantics};
}
function checkCycles(graph) {
  // All capsule studio wires have delayTicks=0: a directed cycle is *not*
  // proof of schedulable feedback, even if it is a signal/event graph.
  const outgoing = new Map(graph.nodes.map(node=>[node.id,[]]));
  const indegree = new Map(graph.nodes.map(node=>[node.id,0]));
  for (const edge of graph.edges) {
    ensure(edge.delayTicks===0,"unexpected delayed edge");
    outgoing.get(edge.fromNode).push(edge.toNode);
    indegree.set(edge.toNode,indegree.get(edge.toNode)+1);
  }
  const queue=graph.nodes.filter(node=>indegree.get(node.id)===0).map(node=>node.id);
  let visited=0;
  for(let head=0;head<queue.length;head++){
    const current=queue[head];visited++;
    for(const target of outgoing.get(current)){
      const d=indegree.get(target)-1;indegree.set(target,d);
      if(d===0)queue.push(target);
    }
  }
  ensure(visited===graph.nodes.length,"zero-delay cycle in "+graph.id);
}
function validateReachable(studio) {
  const ids=Object.keys(studio.graphs);
  ensure(ids.length>0 && ids.length<=2000 && studio.rootGraphId,"invalid root and size budget");
  const seen=new Set(),stack=[studio.rootGraphId];
  while(stack.length) {
    const id=stack.pop();
    ensure(!seen.has(id),"duplicate/cyclic graph ownership at "+id);
    seen.add(id);
    const graph=studio.graph(id);
    for(const node of graph.instances) {
      if(node.kind==="capsule") {
        const child=studio.graph(node.childGraphId);
        ensure(child.parent?.graphId===id&&child.parent?.instanceId===node.id,"invalid child ownership");
        stack.push(child.id);
      }
    }
  }
  ensure(seen.size===ids.length,"unreachable/orphan graph detected");
}
function validateDefinitions(studio) {
  for(const [id,definition] of Object.entries(studio.definitions)){
    ensure(id===definition.id && typeof definition.language==="string","invalid definition");
    for(const [number,version] of Object.entries(definition.versions)){
      ensure(/^[1-9][0-9]*$/.test(number) && version.ports.length<=128,"invalid definition version");
    }
  }
}

/**
 * Export an inert multi-graph proposal compatible with the editor projection.
 * Returns separate canonical graphs and a noncanonical, inert visual sidecar.
 * revision must be a positive monotonic candidate revision provided by caller.
 */
export function createCapsuleIRProposal(studio,{revision=1,domain="program"}={}) {
  ensure(studio instanceof CapsuleStudio,"studio must be CapsuleStudio");
  ensure(Number.isSafeInteger(revision)&&revision>=1,"invalid candidate revision");
  ensure(DOMAINS.has(domain),"invalid graph domain");
  // Revalidate imported/changed model (including nested boundaries) in full.
  const verified=CapsuleStudio.restore(studio.snapshot());
  validateReachable(verified);validateDefinitions(verified);
  const documents=[],boundaryBindings=[],definitions=new Map();
  for(const graphId of Object.keys(verified.graphs).sort()){
    const graph=verified.graph(graphId);
    const interfacePorts=graph.boundary.map(port).sort(byId);
    const nodes=graph.instances.map(instance=>{
      const id=instance.id;
      const ports=verified.resolvePorts(graphId,id).map(port).sort(byId);
      if(instance.kind==="capsule"){
        ensure(verified.graph(instance.childGraphId).parent?.graphId===graphId,"broken capsule graphRef");
        return {id,kind:"composite",typeRef:"",graphRef:instance.childGraphId,graphRefRevision:revision,ports};
      }
      ensure(instance.kind==="microprogram","unknown node kind");
      const d=verified.definitions[instance.definitionId];
      ensure(!!d && !!d.versions[instance.version],"unresolved definition version");
      const ref="adamantium.microprogram."+d.language+"."+d.id+"@"+instance.version;
      ensure(ref.length<=256,"typeRef exceeds native IR budget");
      const handle=d.id+"@"+instance.version;
      definitions.set(handle,{
        definitionId:d.id,version:instance.version,language:d.language,typeRef:ref,
        portCount:d.versions[instance.version].ports.length
      });
      return {id,kind:"service",typeRef:ref,graphRef:"",graphRefRevision:0,ports};
    }).sort(byId);
    const edges=graph.edges.map(e=>{
      ensure(SEMANTICS.has(e.semantics),"semantic-only connection forbidden");
      return {
        id:e.id,fromNode:e.fromId,fromPort:e.fromTag,toNode:e.toId,toPort:e.toTag,
        semantics:e.semantics,delayTicks:0
      };
    }).sort(byId);
    const ir={schema:SOURCE_SCHEMA,schemaVersion:1,id:graph.id,
      revision,domain,interfacePorts,nodes,edges};
    // Non-authoritative projection validation. Native validator remains required.
    createReadOnlyProjection(ir);
    checkCycles(ir);
    for(const b of graph.boundary) {
      const parent=graph.parent;
      ensure(parent && parent.instanceId,"nonroot boundary missing parent");
      boundaryBindings.push({
        graphId:graph.id,parentGraphId:parent.graphId,containerId:parent.instanceId,
        tag:b.tag,side:b.side,internalNode:b.instanceId,internalTag:b.internalTag,
        direction:b.direction,semantics:b.semantics,dataType:b.dataType
      });
    }
    documents.push(ir);
  }
  return clone({
    format:IR_PROPOSAL_VERSION,
    mode:"proposal-only",
    authority:"none",
    executable:false,
    approved:false,
    rootGraphId:verified.rootGraphId,
    revision,
    graphs:documents,
    boundaryBindings:boundaryBindings.sort((a,b)=>a.graphId.localeCompare(b.graphId)||a.tag.localeCompare(b.tag)),
    definitionHandles:Array.from(definitions.values()).sort((a,b)=>a.typeRef.localeCompare(b.typeRef))
  });
}

/** Strict shape and local semantic verification for untrusted imported bundles.
 * This does NOT verify a signed producer, CAS head or native Graph IR authority. */
export function inspectCapsuleIRProposal(proposal) {
  ensure(OBJECT(proposal) && proposal.format===IR_PROPOSAL_VERSION,"unsupported proposal format");
  exact(proposal,["format","mode","authority","executable","approved","rootGraphId","revision","graphs","boundaryBindings","definitionHandles"],"proposal");
  ensure(proposal.mode==="proposal-only" && proposal.authority==="none" &&
    proposal.executable===false && proposal.approved===false,"forbidden authority flags");
  ensure(Number.isSafeInteger(proposal.revision)&&proposal.revision>=1,"invalid revision");
  ensure(typeof proposal.rootGraphId==="string","missing rootGraphId");
  ensure(Array.isArray(proposal.graphs)&&proposal.graphs.length>0&&proposal.graphs.length<=2000,"invalid graph count");
  ensure(Array.isArray(proposal.boundaryBindings)&&Array.isArray(proposal.definitionHandles),"invalid sidecars");
  ensure(proposal.boundaryBindings.length<=256000&&proposal.definitionHandles.length<=2000,"sidecar budget exceeded");
  const graphs=new Map();
  let nodeCount=0,edgeCount=0;
  for(const graph of proposal.graphs){
    exact(graph,["schema","schemaVersion","id","revision","domain","interfacePorts","nodes","edges"],"IR graph");
    nodeCount+=graph.nodes?.length||0;edgeCount+=graph.edges?.length||0;
    ensure(nodeCount<=100000&&edgeCount<=200000,"total node/edge budget exceeded");
    for(const p of graph.interfacePorts||[])exact(p,["id","dataType","direction","semantics"],"IR interface port");
    for(const n of graph.nodes||[]){
      exact(n,["id","kind","typeRef","graphRef","graphRefRevision","ports"],"IR node");
      for(const p of n.ports||[])exact(p,["id","dataType","direction","semantics"],"IR node port");
    }
    for(const edge of graph.edges||[])exact(edge,
      ["id","fromNode","fromPort","toNode","toPort","semantics","delayTicks"],"IR edge");
    ensure(OBJECT(graph)&&!graphs.has(graph.id),"duplicate/bad graph");
    ensure(graph.revision===proposal.revision,"stale graph within proposal");
    createReadOnlyProjection(graph);
    checkCycles(graph);
    graphs.set(graph.id,graph);
  }
  ensure(graphs.has(proposal.rootGraphId),"missing proposal root");
  const childToParent=new Map();
  for(const graph of graphs.values()){
    for(const node of graph.nodes){
      if(node.kind!=="composite")continue;
      const child=graphs.get(node.graphRef);
      ensure(!!child&&node.graphRefRevision===child.revision,"unresolved graph revision");
      ensure(!childToParent.has(child.id),"multiply owned child graph");
      childToParent.set(child.id,{graphId:graph.id,containerId:node.id});
      const visible=node.ports.slice().sort(byId);
      const expected=child.interfacePorts.slice().sort(byId);
      ensure(JSON.stringify(visible)===JSON.stringify(expected),"composite interface drift");
    }
  }
  ensure(!childToParent.has(proposal.rootGraphId),"root graph has a parent");
  ensure(childToParent.size===graphs.size-1,"orphan graph in bundle");
  for(const id of graphs.keys()){
    const seen=new Set();let curr=id;
    while(childToParent.has(curr)){
      ensure(!seen.has(curr),"cyclic composite graphRef");seen.add(curr);
      curr=childToParent.get(curr).graphId;
    }
    ensure(curr===proposal.rootGraphId,"invalid composite ownership");
  }
  const bindings=new Map();
  for(const b of proposal.boundaryBindings) {
    exact(b,["graphId","parentGraphId","containerId","tag","side","internalNode","internalTag","direction","semantics","dataType"],"boundary binding");
    ensure(OBJECT(b)&&graphs.has(b.graphId)&&["north","east","south","west"].includes(b.side),"invalid boundary binding");
    const parent=childToParent.get(b.graphId);
    ensure(!!parent&&parent.graphId===b.parentGraphId&&parent.containerId===b.containerId,"mismatched boundary owner");
    const graph=graphs.get(b.graphId);
    const interfacePort=graph.interfacePorts.find(p=>p.id===b.tag);
    const node=graph.nodes.find(n=>n.id===b.internalNode);
    const inner=node?.ports?.find(p=>p.id===b.internalTag);
    ensure(!!interfacePort&&!!inner,"missing boundary endpoint");
    ensure(JSON.stringify([interfacePort.dataType,interfacePort.direction,interfacePort.semantics])===
      JSON.stringify([b.dataType,b.direction,b.semantics]),"boundary interface mismatch");
    ensure(JSON.stringify([inner.dataType,inner.direction,inner.semantics])===
      JSON.stringify([b.dataType,b.direction,b.semantics]),"boundary internal mismatch");
    const key=b.graphId+"."+b.tag;
    ensure(!bindings.has(key),"duplicate boundary binding");bindings.set(key,true);
  }
  const expected=proposal.graphs.reduce((count,graph)=>count+graph.interfacePorts.length,0);
  ensure(bindings.size===expected,"unbound composite interface");
  const typeRefs=new Map();
  for(const d of proposal.definitionHandles) {
    exact(d,["definitionId","version","language","typeRef","portCount"],"definition handle");
    ensure(OBJECT(d)&&typeof d.definitionId==="string"&&Number.isSafeInteger(d.version)&&d.version>=1,"invalid definition handle");
    ensure(typeof d.typeRef==="string"&&!typeRefs.has(d.typeRef),"duplicate/bad definition handle");
    ensure(Number.isSafeInteger(d.portCount)&&d.portCount>=0&&d.portCount<=128,"invalid definition port count");
    typeRefs.set(d.typeRef,d);
    ensure(d.typeRef==="adamantium.microprogram."+d.language+"."+d.definitionId+"@"+d.version,
      "definition typeRef mismatch");
  }
  for(const graph of graphs.values()){
    for(const node of graph.nodes){
      if(node.kind!=="composite"){
        ensure(typeRefs.has(node.typeRef),"unregistered microprogram typeRef");
        ensure(node.ports.length===typeRefs.get(node.typeRef).portCount,"definition port count mismatch");
      }
    }
  }
  // No source code, privileges or token material should appear in this bundle.
  return {valid:true,rootGraphId:proposal.rootGraphId,graphCount:graphs.size,
    boundaryCount:bindings.size,definitionCount:typeRefs.size,revision:proposal.revision,
    authority:"none",executable:false};
}
