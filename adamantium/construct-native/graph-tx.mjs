/**
 * R05: sandbox-only CPU-first revisioned graph transaction kernel.
 * No MAS rights, Node-RED deploy, host I/O or arbitrary code execution.
 * Existing Graph Manager is read-only; this proves transactional semantics
 * without inventing its unsupported write API.
 * SPDX-License-Identifier: Apache-2.0
 */
import {validateBlueprint} from "./core.mjs";
export const TX_FORMAT="adamantium.construct-transaction/1";
export const MAX_GRAPH_REVISIONS=16;
const RE=/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,95}$/;
const requireThat=(ok,message)=>{if(!ok)throw new TypeError(message);};
const id=(v,what)=>{requireThat(typeof v==="string"&&RE.test(v),"invalid "+what);return v;};
const clone=x=>JSON.parse(JSON.stringify(x));
const isObj=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
async function hash(value){
  requireThat(!!globalThis.crypto?.subtle,"SHA-256 unavailable");
  const bytes=new TextEncoder().encode(JSON.stringify(value));
  const sum=await globalThis.crypto.subtle.digest("SHA-256",bytes);
  return "sha256:"+Array.from(new Uint8Array(sum),x=>x.toString(16).padStart(2,"0")).join("");
}
function graph(raw){return validateBlueprint(raw);}
function payload(value){
  const encoded=JSON.stringify(value);
  requireThat(encoded!==undefined&&encoded.length<=32768,"invalid event payload");
  return JSON.parse(encoded);
}
function graphDiff(a,b){
  const old=new Map(a.nodes.map(n=>[n.id,JSON.stringify(n)]));
  const next=new Map(b.nodes.map(n=>[n.id,JSON.stringify(n)]));
  return {added:[...next.keys()].filter(k=>!old.has(k)).sort(),
    removed:[...old.keys()].filter(k=>!next.has(k)).sort(),
    modified:[...next.keys()].filter(k=>old.has(k)&&old.get(k)!==next.get(k)).sort()};
}
/**
 * The injected authorization callback defaults to deny. Test authorization
 * mocks DO NOT prove any MAS permissions. A production bridge requires an
 * existing signed and policy-verified write capability, which is absent.
 */
export class RevisionedGraphKernel{
  static async create({flowId,blueprint,authorize}){
    id(flowId,"flow ID");
    const initial=graph(blueprint),digest=await hash(initial);
    const kernel=new RevisionedGraphKernel(flowId,authorize);
    kernel.revisions.set(1,{revision:1,digest,blueprint:initial,previous:null,kind:"bootstrap"});
    return kernel;
  }
  constructor(flowId,authorize){
    this.flowId=flowId;
    this.authorize=typeof authorize==="function"?authorize:async()=>false;
    this.revisions=new Map();this.activeRevision=1;
    this.proposals=new Map();this.events=new Map();this.receipts=[];
    this.sequence=0;this.commitLock=false;this.eventSeq=0;this.nextRevision=2;
  }
  status(){return {format:TX_FORMAT,flowId:this.flowId,
    activeRevision:this.activeRevision,activeDigest:this.revisions.get(this.activeRevision).digest,
    revisions:this.revisions.size,proposals:this.proposals.size,
    inFlight:this.events.size,receipts:this.receipts.length,locked:this.commitLock};}
  snapshot(revision=this.activeRevision){
    const record=this.revisions.get(revision);
    requireThat(!!record,"unknown graph revision");
    return clone(record);
  }
  describe(proposalId){
    const p=this.proposals.get(id(proposalId,"proposal ID"));
    requireThat(!!p,"unknown proposal");
    return clone({format:TX_FORMAT,id:p.id,flowId:this.flowId,
      expectedRevision:p.expectedRevision,digest:p.digest,author:p.author,
      status:p.status,reason:p.reason,diff:p.diff,approvals:p.approvals.size,
      quorum:2,reviewers:p.reviewers});
  }
  listProposals(){return [...this.proposals.keys()].map(k=>this.describe(k));}
  async submit({proposalId,author,expectedRevision,blueprint,reason=""}){
    id(proposalId,"proposal ID");id(author,"author");
    requireThat(!this.proposals.has(proposalId),"duplicate proposal");
    requireThat(this.proposals.size<24,"proposal budget exceeded");
    requireThat(typeof reason==="string"&&reason.length<=280,"invalid reason");
    requireThat(Number.isSafeInteger(expectedRevision)&&expectedRevision===this.activeRevision,
      "graph revision CAS conflict");
    const candidate=graph(blueprint),base=this.revisions.get(expectedRevision);
    const digest=await hash(candidate);
    requireThat(expectedRevision===this.activeRevision,"graph revision changed during proposal validation");
    this.proposals.set(proposalId,{
      id:proposalId,author,expectedRevision,reason,digest,blueprint:candidate,
      diff:graphDiff(base.blueprint,candidate),status:"proposed",
      reviewers:[],approvals:new Set(),rejection:null
    });
    return this.describe(proposalId);
  }
  review(proposalId,{reviewer,decision}){
    const p=this.proposals.get(id(proposalId,"proposal ID"));
    requireThat(!!p,"unknown proposal");id(reviewer,"reviewer");
    requireThat(reviewer!==p.author,"author cannot review own change");
    requireThat(["approve","reject"].includes(decision),"invalid review decision");
    requireThat(["proposed","reviewed"].includes(p.status),"proposal no longer reviewable");
    requireThat(!p.reviewers.includes(reviewer),"duplicate reviewer");
    requireThat(p.reviewers.length<8,"review budget exceeded");
    p.reviewers.push(reviewer);
    if(decision==="reject"){p.status="rejected";p.rejection=reviewer;}
    else{p.approvals.add(reviewer);if(p.approvals.size>=2)p.status="reviewed";}
    return this.describe(proposalId);
  }
  async commit({proposalId,expectedRevision,expectedDigest}){
    const p=this.proposals.get(id(proposalId,"proposal ID"));
    requireThat(!!p,"unknown proposal");
    requireThat(!this.commitLock,"another graph mutation is in progress");
    this.commitLock=true;
    try{
      requireThat(p.status==="reviewed"&&p.approvals.size>=2,"independent QA quorum missing");
      requireThat(expectedRevision===this.activeRevision&&p.expectedRevision===this.activeRevision,
        "graph revision CAS conflict");
      requireThat(p.digest===expectedDigest,"proposal digest mismatch");
      requireThat(this.revisions.size<MAX_GRAPH_REVISIONS,"history retention budget exceeded");
      requireThat(await this.authorize({
        op:"commit",flowId:this.flowId,proposalId,from:expectedRevision,
        to:this.nextRevision,digest:p.digest})===true,"operator or MAS capability denied");
      requireThat(expectedRevision===this.activeRevision,"graph revision changed during authorization");
      const next=this.nextRevision++;
      this.revisions.set(next,{revision:next,digest:p.digest,
        blueprint:clone(p.blueprint),previous:expectedRevision,kind:"commit",proposalId});
      this.activeRevision=next;p.status="committed";
      return this.record({operation:"commit",proposalId,from:expectedRevision,to:next,digest:p.digest});
    }finally{this.commitLock=false;}
  }
  async rollback({expectedRevision,targetRevision,reason}){
    requireThat(!this.commitLock,"another graph mutation is in progress");
    this.commitLock=true;
    try{
      requireThat(expectedRevision===this.activeRevision,"rollback CAS conflict");
      requireThat(Number.isSafeInteger(targetRevision)&&targetRevision>=1&&
        targetRevision<expectedRevision,"rollback target must be an older revision");
      requireThat(typeof reason==="string"&&reason.length>=3&&reason.length<=280,
        "rollback needs a reason");
      requireThat(this.revisions.has(targetRevision),"unknown rollback target");
      requireThat(await this.authorize({
        op:"rollback",flowId:this.flowId,from:expectedRevision,to:targetRevision,reason})===true,
        "rollback capability denied");
      requireThat(expectedRevision===this.activeRevision,"graph revision changed during rollback authorization");
      this.activeRevision=targetRevision;
      return this.record({operation:"rollback",from:expectedRevision,to:targetRevision,reason});
    }finally{this.commitLock=false;}
  }
  record(receipt){
    const row={sequence:++this.sequence,flowId:this.flowId,...receipt};
    this.receipts=[...this.receipts.slice(-127),clone(row)];
    return clone(row);
  }
  beginEvent({entryId,value}){
    id(entryId,"entry ID");
    requireThat(this.events.size<32,"in-flight event budget exceeded");
    const revision=this.activeRevision,entry=this.revisions.get(revision);
    const nodes=new Map(entry.blueprint.nodes.map(n=>[n.id,n]));
    requireThat(nodes.has(entryId),"entry node not present in active revision");
    requireThat(nodes.get(entryId).type==="inject","R05 sandbox only accepts passive Inject entry");
    const ticket="event_"+(++this.eventSeq);
    this.events.set(ticket,{revision,digest:entry.digest,nodes,
      queue:[{nodeId:entryId,value:payload(value)}],debug:[],steps:0});
    return {ticket,revision,digest:entry.digest};
  }
  advance(ticket,maxSteps=1){
    requireThat(typeof ticket==="string"&&this.events.has(ticket),"unknown event ticket");
    requireThat(Number.isSafeInteger(maxSteps)&&maxSteps>=1&&maxSteps<=32,"invalid step count");
    const e=this.events.get(ticket);
    let count=0;
    try{
      while(e.queue.length&&count<maxSteps){
        requireThat(e.steps<128,"event traversal budget exceeded");
      const next=e.queue.shift(),node=e.nodes.get(next.nodeId);
      requireThat(!!node,"graph link target disappeared");
      requireThat(["inject","debug","comment"].includes(node.type),
        "node type has no sandbox execution semantics");
      if(node.type==="debug"){e.debug.push({nodeId:node.id,value:clone(next.value)});}
      else if(node.type==="inject"){
        const outgoing=node.wires?.flat()||[];
        requireThat(e.queue.length+outgoing.length<=128,"event fan-out budget exceeded");
        for(const target of outgoing)e.queue.push({nodeId:target,value:clone(next.value)});
      }
        e.steps++;count++;
      }
    }catch(failure){
      // A failed or unsupported sandbox node must never leave a zombie ticket
      // that blocks a future revision, or implicitly attempt another step.
      this.events.delete(ticket);
      this.record({operation:"event-failed",ticket,revision:e.revision,
        steps:e.steps,reason:String(failure?.message||"sandbox execution failed").slice(0,180)});
      throw failure;
    }
    const result={ticket,revision:e.revision,digest:e.digest,done:e.queue.length===0,
      steps:e.steps,pending:e.queue.length,debug:clone(e.debug)};
    if(result.done){
      this.events.delete(ticket);
      this.record({operation:"event-complete",ticket,revision:e.revision,steps:e.steps});
    }
    return result;
  }
  inspectGraphManagerSnapshot(raw){
    requireThat(isObj(raw)&&Array.isArray(raw.nodes)&&Array.isArray(raw.edges),
      "permission-filtered Graph Manager snapshot required");
    requireThat(raw.nodes.length<=250&&raw.edges.length<=800,"Graph Manager graph budget exceeded");
    const readable=raw.nodes.some(n=>n.id==="graph_manager.view"&&
      Array.isArray(n.requires)&&n.requires.includes("graph_manager.read"));
    return {schema:"adamantium.graph-manager-handoff/1",flowId:this.flowId,
      mode:"read_only",readable,canCommit:false,canRollback:false,
      reason:"Graph Manager 0.1 has GET /graph but no authenticated graph mutation capability"};
  }
  handoff(proposalId){
    const p=this.describe(proposalId);
    return {schema:"adamantium.graph-manager-review/1",
      proposalId:p.id,flowId:this.flowId,digest:p.digest,
      baseRevision:p.expectedRevision,status:p.status,
      reviewers:p.reviewers,diff:p.diff,
      requestedAction:"review_only",noExecution:true};
  }
}
