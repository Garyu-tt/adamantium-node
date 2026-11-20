/**
 * Adamantium-node R03: IN-MEMORY LOCAL DRAFT ledger for CAS/revision previews.
 *
 * This is NOT a durable service, MAS authority, Graph Manager, signing witness,
 * deployment endpoint, runtime hot swap, or permission gate. It exercises
 * optimistic concurrency and rollback state transitions before native adapters.
 * SPDX-License-Identifier: Apache-2.0
 */
import {createHash} from "node:crypto";
import {inspectCapsuleIRProposal} from "./capsule-ir-proposal.mjs";

export const DRAFT_FORMAT = "adamantium.capsule-draft-ledger/1";
const safeId=/^[a-z][a-z0-9_.-]{0,95}$/;
function ensure(ok,text){if(!ok)throw new TypeError("Capsule draft ledger: "+text);}
function obj(o){return o!==null&&typeof o==="object"&&!Array.isArray(o);}
function json(o){return JSON.parse(JSON.stringify(o));}
function digest(value){return createHash("sha256").update(JSON.stringify(value)).digest("hex");}
function checkId(value,field){ensure(typeof value==="string"&&safeId.test(value),"invalid "+field);return value;}
function receipt(action,seq,details){
  return Object.freeze({
    format:DRAFT_FORMAT,sequence:seq,action,authoritative:false,
    masApproved:false,runtimeActivated:false,externalSideEffects:false,...details
  });
}
function incrementRevision(bundle,revision) {
  const output=json(bundle);
  output.revision=revision;
  for(const graph of output.graphs){
    graph.revision=revision;
    for(const node of graph.nodes)if(node.kind==="composite")node.graphRefRevision=revision;
  }
  inspectCapsuleIRProposal(output);
  return output;
}

/**
 * Local immutable baseline and pending draft queue, never an authoritative CAS.
 * In-process sync methods avoid concurrent mutation within this one JS isolate.
 */
export class InMemoryCapsuleDraftLedger {
  #head;#revision;#current;#pending;#history;#sequence;#requests;
  constructor(baseline) {
    inspectCapsuleIRProposal(baseline);
    const graph=json(baseline);
    this.#current=graph;
    this.#head=digest(graph);
    this.#revision=graph.revision;
    this.#pending=new Map();
    this.#requests=new Map();
    this.#history=[];
    this.#sequence=0;
  }
  status() {
    return Object.freeze({
      format:DRAFT_FORMAT,
      scope:"local-demo-only",revision:this.#revision,head:this.#head,
      graphCount:this.#current.graphs.length,
      pendingCount:this.#pending.size,
      authoritative:false,masApproved:false,runtimeActivated:false
    });
  }
  current(){return json(this.#current);}
  /**
   * A draft is staged ONLY if the user-provided local head/revision match.
   * requestId retries are idempotent for identical bytes; changing payload
   * under the same requestId fails closed.
   */
  propose({requestId,expectedRevision,expectedHead,candidate}) {
    checkId(requestId,"requestId");
    ensure(obj(candidate),"candidate must be a proposal bundle");
    const candidateCopy=json(candidate);
    inspectCapsuleIRProposal(candidateCopy);
    ensure(candidateCopy.rootGraphId===this.#current.rootGraphId,"cannot change root identity");
    const candidateHash=digest(candidateCopy);
    const seen=this.#requests.get(requestId);
    if(seen){
      ensure(seen.candidateHash===candidateHash &&
        seen.expectedRevision===expectedRevision && seen.expectedHead===expectedHead,
        "idempotency key reused with different payload");
      return seen.result;
    }
    ensure(Number.isSafeInteger(expectedRevision)&&expectedRevision===this.#revision,"stale expectedRevision");
    ensure(typeof expectedHead==="string"&&expectedHead===this.#head,"stale expectedHead");
    ensure(candidateCopy.revision===this.#revision+1,"candidate revision must increase by one");
    ensure(this.#pending.size<32,"pending draft budget exceeded");
    const next=++this.#sequence;
    const result=receipt("proposed",next,{
      requestId,expectedRevision,expectedHead,candidateHash,
      status:"staged-unverified-authority"
    });
    this.#pending.set(requestId,{
      expectedRevision,expectedHead,candidate:candidateCopy,candidateHash,result
    });
    this.#requests.set(requestId,{
      expectedRevision,expectedHead,candidateHash,result
    });
    return result;
  }
  /**
   * Simulated activation of the LOCAL DRAFT ONLY. Not native Graph IR approval.
   * Authoritative external CAS/hot swap must use a separate authenticated API.
   */
  applyLocal({requestId,expectedRevision,expectedHead}) {
    checkId(requestId,"requestId");
    const staged=this.#pending.get(requestId);
    ensure(!!staged,"no pending draft");
    ensure(staged.expectedHead===expectedHead&&staged.expectedRevision===expectedRevision,
      "proposal preconditions differ");
    ensure(expectedRevision===this.#revision&&expectedHead===this.#head,"stale local CAS head");
    inspectCapsuleIRProposal(staged.candidate);
    const previous=this.#current;
    const previousHead=this.#head;
    this.#history.push({bundle:previous,head:previousHead});
    this.#current=staged.candidate;
    this.#head=staged.candidateHash;
    this.#revision=staged.candidate.revision;
    this.#pending.delete(requestId);
    const response=receipt("applied-local-draft",++this.#sequence,{
      requestId,previousHead,currentHead:this.#head,revision:this.#revision,status:"local-preview"
    });
    const recorded=this.#requests.get(requestId);
    if(recorded)this.#requests.set(requestId,{...recorded,result:response});
    return response;
  }
  rollbackLocal({requestId,expectedRevision,expectedHead}) {
    checkId(requestId,"requestId");
    ensure(expectedRevision===this.#revision&&expectedHead===this.#head,"stale rollback CAS head");
    ensure(this.#history.length>0,"no prior local revision");
    const previous=this.#history[this.#history.length-1];
    const candidate=incrementRevision(previous.bundle,this.#revision+1);
    const priorHead=this.#head;
    this.#history.pop();
    this.#current=candidate;
    this.#revision=candidate.revision;
    this.#head=digest(candidate);
    // A pending draft based on the old head must never be implicitly promoted.
    this.#pending.clear();
    return receipt("rolled-back-local-draft",++this.#sequence,{
      requestId,previousHead:priorHead,currentHead:this.#head,revision:this.#revision,status:"local-preview"
    });
  }
  discardLocal(requestId) {
    checkId(requestId,"requestId");
    ensure(this.#pending.has(requestId),"no pending draft");
    this.#pending.delete(requestId);
    return receipt("discarded-local-draft",++this.#sequence,{requestId,status:"discarded"});
  }
}