/**
 * Adamantium-node R05 — durable, single-writer proposal inbox reference.
 *
 * NOT the production Core/Graph Manager. Not a network listener, MAS policy,
 * signer provisioner, native IR compiler, graph promoter or runtime activator.
 * All trust-critical callbacks are required and injected by an authenticated
 * Core integration; there is no permissive fallback.
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from "node:fs/promises";
import path from "node:path";
import {constants as fsConstants} from "node:fs";
import {createHash,createPrivateKey,createPublicKey,randomBytes,sign,verify} from "node:crypto";
import {inspectCapsuleIRProposal} from "./capsule-ir-proposal.mjs";
import {signedPayloadBytes,canonicalJSONString,OFFER_VERSION,RECEIPT_VERSION,REQUEST_VERSION} from "./capsule-signed-proposal-bridge.mjs";

export const INBOX_VERSION="adamantium.core-graph-inbox/1";
export const SNAPSHOT_VERSION="adamantium.core-graph-inbox-signed-snapshot/1";
function snapshotBytes(state){
  return Buffer.from("ADAMANTIUM-GRAPH-INBOX-SNAPSHOT-R05\n"+canonicalJSONString(state),"utf8");
}
function sealSnapshot(state,key){
  return {format:SNAPSHOT_VERSION,state,
    signature:sign(null,snapshotBytes(state),key).toString("base64")};
}
function openSnapshot(snapshot,key){
  exact(snapshot,["format","state","signature"],"signed snapshot");
  insist(snapshot.format===SNAPSHOT_VERSION,"unsupported signed snapshot format");
  insist(typeof snapshot.signature==="string" &&
    /^[A-Za-z0-9+/]+={0,2}$/.test(snapshot.signature),"invalid snapshot signature encoding");
  const signature=Buffer.from(snapshot.signature,"base64");
  insist(signature.length===64&&signature.toString("base64")===snapshot.signature,
    "invalid snapshot signature bytes");
  insist(verify(null,snapshotBytes(snapshot.state),createPublicKey(key),signature),
    "invalid snapshot signature");
  return snapshot.state;
}
const CONTRACT="mechanicus.graph.propose/1";
const ID=/^[a-z][a-z0-9_.-]{0,127}$/;
const SHA=/^[a-f0-9]{64}$/;
const object=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const clone=x=>JSON.parse(JSON.stringify(x));
const hash=x=>createHash("sha256").update(typeof x==="string"?x:JSON.stringify(x)).digest("hex");
function insist(ok,message){if(!ok)throw new TypeError("Capsule inbox: "+message);}
function checkID(x,what){insist(typeof x==="string"&&ID.test(x),"invalid "+what);return x;}
function checkHash(x,what){insist(typeof x==="string"&&SHA.test(x),"invalid "+what);return x;}
function exact(o,keys,name){
  insist(object(o)&&JSON.stringify(Object.keys(o).sort())===JSON.stringify(keys.slice().sort()),
    "invalid "+name+" fields");
}
function auditEvent(state,{kind,principalId,requestId,now}){
  const previous=state.audit.length?state.audit[state.audit.length-1].hash:"0".repeat(64);
  const row={seq:state.audit.length+1,kind,principalId,requestId,at:now,previous};
  row.hash=hash(row);
  state.audit.push(row);
}
function verifyAudit(state){
  insist(Array.isArray(state.audit)&&state.audit.length<=100000,"invalid audit size");
  let prev="0".repeat(64);
  for(const [i,row] of state.audit.entries()){
    insist(object(row)&&row.seq===i+1&&row.previous===prev&&row.hash===hash({
      seq:row.seq,kind:row.kind,principalId:row.principalId,
      requestId:row.requestId,at:row.at,previous:row.previous
    }),"corrupt audit chain");
    prev=row.hash;
  }
}
function verifyStored(state) {
  insist(object(state)&&state.format===INBOX_VERSION,"unknown state format");
  insist(object(state.current)&&Number.isSafeInteger(state.revision)&&state.revision>=1,
    "malformed current revision");
  const inspection=inspectCapsuleIRProposal(state.current);
  insist(inspection.revision===state.revision&&inspection.rootGraphId===state.graphId,
    "stored graph revision/scope drift");
  insist(state.headSha256===hash(state.current),"stored CAS digest mismatch");
  insist(object(state.offers)&&Object.keys(state.offers).length<=512,"invalid stored offers");
  insist(object(state.requests)&&Object.keys(state.requests).length<=10000,"invalid idempotency records");
  insist(Array.isArray(state.queue)&&state.queue.length<=512,"invalid review queue");
  verifyAudit(state);
}
async function saveAtomic(dir,state,privateKey){
  const target=path.join(dir,"inbox.json");
  const tmp=path.join(dir,".inbox-"+randomBytes(12).toString("hex")+".tmp");
  const text=JSON.stringify(sealSnapshot(state,privateKey))+"\n";
  insist(text.length<=24_000_000,"state snapshot exceeds 24 MB budget");
  let file;
  try{
    file=await fs.open(tmp,fsConstants.O_WRONLY|fsConstants.O_CREAT|fsConstants.O_EXCL|
      (fsConstants.O_NOFOLLOW||0),0o600);
    await file.writeFile(text,"utf8");
    await file.sync();
    await file.close();file=null;
    await fs.rename(tmp,target);
    // Directory fsync provides rename durability on Linux. On Windows the
    // directory may be unopenable: see the documented weaker crash guarantee.
    try{
      const dirHandle=await fs.open(dir,"r");
      try{await dirHandle.sync();}finally{await dirHandle.close();}
    }catch(error){
      if(!["EPERM","EINVAL","EISDIR","ENOTSUP","EACCES"].includes(error.code))throw error;
    }
  }finally{
    if(file)await file.close().catch(()=>{});
    await fs.unlink(tmp).catch(e=>{if(e.code!=="ENOENT")throw e;});
  }
}
export class DurableCapsuleProposalInbox {
  #directory;#lock;#state;#key;#node;#policy;
  #authenticate;#authorize;#nativeValidate;#isPrimary;#now;#tail=Promise.resolve();
  constructor({directory,lock,state,privateKey,nodeId,policySha256,
    authenticate,authorize,nativeValidate,isPrimary,now}){
    this.#directory=directory;this.#lock=lock;this.#state=state;this.#key=privateKey;
    this.#node=nodeId;this.#policy=policySha256;
    this.#authenticate=authenticate;this.#authorize=authorize;
    this.#nativeValidate=nativeValidate;this.#isPrimary=isPrimary;this.#now=now;
  }
  /**
   * Exclusive local writer lock: existing locks (including after crashes)
   * require manual operator reconciliation. No automatic lock stealing.
   */
  static async open({directory,baseline,privateKeyPem,nodeId,policySha256,
    authenticate,authorize,nativeValidate,isPrimary,now=()=>Date.now()}){
    insist(typeof directory==="string"&&path.isAbsolute(directory),"absolute state directory required");
    checkID(nodeId,"nodeId");checkHash(policySha256,"policy digest");
    insist(typeof privateKeyPem==="string"&&privateKeyPem.length<=8192,"invalid signing key");
    const privateKey=createPrivateKey(privateKeyPem);
    insist(privateKey.asymmetricKeyType==="ed25519","signer must be Ed25519");
    for(const [fn,name] of [[authenticate,"authenticate"],[authorize,"authorize"],
      [nativeValidate,"nativeValidate"],[isPrimary,"isPrimary"],[now,"clock"]]){
      insist(typeof fn==="function","missing mandatory "+name+" gate");
    }
    const d=path.resolve(directory);
    await fs.mkdir(d,{recursive:true,mode:0o700});
    const stat=await fs.lstat(d);
    insist(stat.isDirectory()&&!stat.isSymbolicLink(),"inbox directory must be a real directory");
    const lock=await fs.open(path.join(d,".writer.lock"),
      fsConstants.O_WRONLY|fsConstants.O_CREAT|fsConstants.O_EXCL|
      (fsConstants.O_NOFOLLOW||0),0o600);
    try {
      const file=path.join(d,"inbox.json");
      let state;
      try {
        state=openSnapshot(JSON.parse(await fs.readFile(file,"utf8")),privateKey);
      }catch(error){
        if(error.code!=="ENOENT")throw error;
        insist(baseline,"new inbox requires explicit verified baseline");
        const info=inspectCapsuleIRProposal(baseline);
        state={format:INBOX_VERSION,graphId:info.rootGraphId,
          revision:info.revision,current:clone(baseline),headSha256:hash(baseline),
          offers:{},requests:{},queue:[],audit:[]};
        await saveAtomic(d,state,privateKey);
      }
      verifyStored(state);
      return new DurableCapsuleProposalInbox({directory:d,lock,state,privateKey,
        nodeId,policySha256,authenticate,authorize,nativeValidate,isPrimary,now});
    }catch(error){
      await lock.close().catch(()=>{});
      await fs.unlink(path.join(d,".writer.lock")).catch(()=>{});
      throw error;
    }
  }
  #serialize(callback){
    const work=this.#tail.then(callback);
    this.#tail=work.catch(()=>{});
    return work;
  }
  #signed(payload){
    return {payload,signature:sign(null,signedPayloadBytes(payload),this.#key).toString("base64")};
  }
  async #identity(context,action){
    const claimant=await this.#authenticate(context);
    insist(object(claimant)&&claimant.verified===true,"authentication failed");
    const principalId=checkID(claimant.principalId,"authenticated principal");
    insist((await this.#authorize({
      principalId,graphId:this.#state.graphId,nodeId:this.#node,
      policySha256:this.#policy,action
    }))===true,"Core authorization denied");
    insist((await this.#isPrimary())===true,"Core is not verified primary");
    return principalId;
  }
  async #commit(next){
    verifyStored(next);
    await saveAtomic(this.#directory,next,this.#key);
    this.#state=next;
  }
  summary(){
    return {format:INBOX_VERSION,mode:"review-inbox-only",
      graphId:this.#state.graphId,revision:this.#state.revision,
      headSha256:this.#state.headSha256,reviewQueue:this.#state.queue.length,
      auditEntries:this.#state.audit.length,authoritative:false,
      runtimeActivated:false,graphPromoted:false};
  }
  preflight(query,context){
    return this.#serialize(async()=>{
      exact(query,["nodeId","graphId","contract"],"preflight");
      insist(query.nodeId===this.#node&&query.graphId===this.#state.graphId&&
        query.contract===CONTRACT,"preflight scope mismatch");
      const principalId=await this.#identity(context,CONTRACT);
      const now=this.#now();
      insist(Number.isSafeInteger(now)&&now>=0,"invalid timestamp");
      const next=clone(this.#state);
      // Expired offers are never valid. Idempotent receipts live in the
      // independent request ledger and remain available after offer GC.
      for(const [id,entry] of Object.entries(next.offers)){
        if(entry.expiresAt<=now)delete next.offers[id];
      }
      insist(Object.keys(next.offers).length<512,"offer registry at capacity");
      const offerId="offer_"+randomBytes(16).toString("hex");
      const actionId="propose_"+randomBytes(12).toString("hex");
      const offer={
        format:OFFER_VERSION,nodeId:this.#node,graphId:this.#state.graphId,
        policySha256:this.#policy,issuedAt:now,expiresAt:now+60_000,
        offerId,revision:next.revision,headSha256:next.headSha256,
        actionContract:CONTRACT,actionId
      };
      next.offers[offerId]={principalId,actionId,expiresAt:offer.expiresAt,
        revision:offer.revision,headSha256:offer.headSha256,used:false};
      auditEvent(next,{kind:"offer",principalId,requestId:offerId,now});
      await this.#commit(next);
      return {status:"reachable",mode:"primary",canInvoke:true,
        nodeId:this.#node,signedOffer:this.#signed(offer)};
    });
  }
  invoke(query,context){
    return this.#serialize(async()=>{
      exact(query,["nodeId","actionId","payload"],"invoke");
      insist(query.nodeId===this.#node,"Core node mismatch");
      const principalId=await this.#identity(context,CONTRACT);
      const p=query.payload;
      exact(p,["format","requestId","nodeId","graphId","policySha256","offerId",
        "expectedRevision","expectedHeadSha256","proposedRevision","proposalSha256",
        "proposal"],"request");
      insist(p.format===REQUEST_VERSION,"unsupported request format");
      checkID(p.requestId,"requestId");checkID(p.offerId,"offerId");
      checkID(query.actionId,"actionId");
      checkHash(p.expectedHeadSha256,"expectedHeadSha256");
      checkHash(p.proposalSha256,"proposalSha256");
      insist(p.nodeId===this.#node&&p.graphId===this.#state.graphId&&
        p.policySha256===this.#policy,"request scope/policy mismatch");
      insist(JSON.stringify(p).length<=2_000_000,"proposal request too large");
      const info=inspectCapsuleIRProposal(p.proposal);
      insist(info.rootGraphId===this.#state.graphId &&
        info.revision===p.proposedRevision,"proposal graph mismatch");
      insist(hash(p.proposal)===p.proposalSha256,"proposal SHA256 mismatch");
      // Tuple encoding avoids principal/request collisions when IDs contain dots.
      const requestKey=JSON.stringify([principalId,p.requestId]);
      const requestHash=hash({query,principalId});
      const existing=this.#state.requests[requestKey];
      if(existing){
        insist(existing.requestHash===requestHash,"idempotency key reused with different payload");
        return clone(existing.signedReceipt);
      }
      const offer=this.#state.offers[p.offerId];
      insist(!!offer&&offer.principalId===principalId&&offer.actionId===query.actionId,
        "unknown or foreign signed offer");
      insist(!offer.used && this.#now()<offer.expiresAt,"expired/used offer");
      insist(offer.revision===p.expectedRevision&&offer.headSha256===p.expectedHeadSha256,
        "offer CAS parameters mismatch");
      insist(p.proposedRevision===p.expectedRevision+1,"candidate must increase revision by one");
      insist(p.expectedRevision===this.#state.revision&&
        p.expectedHeadSha256===this.#state.headSha256,"stale authoritative baseline");
      insist(Object.keys(this.#state.requests).length<10000 &&
        this.#state.queue.length<512,"review queue full");
      // The native compiler/validator is provided by *trusted Core*, never
      // by the editor. A test stub is not a real G0 validation receipt.
      const result=await this.#nativeValidate({
        graphId:this.#state.graphId,proposal:clone(p.proposal),
        expectedRevision:p.expectedRevision,principalId
      });
      const graphsHash=hash(p.proposal.graphs);
      insist(object(result)&&typeof result.accepted==="boolean" &&
        result.graphsSha256===graphsHash,"native validation contract mismatch");
      // Policy and leadership can change while native validation is running.
      // Re-authenticate immediately before the durable acceptance boundary.
      const stillAuthorized=await this.#identity(context,CONTRACT);
      insist(stillAuthorized===principalId,"transport principal changed during validation");
      const now=this.#now();
      const status=result.accepted?"accepted-for-review":"rejected";
      const receipt={
        format:RECEIPT_VERSION,nodeId:this.#node,graphId:this.#state.graphId,
        policySha256:this.#policy,issuedAt:now,expiresAt:now+60_000,
        offerId:p.offerId,requestId:p.requestId,proposalSha256:p.proposalSha256,
        expectedRevision:p.expectedRevision,expectedHeadSha256:p.expectedHeadSha256,
        status,receiptId:"receipt_"+randomBytes(16).toString("hex")
      };
      const signedReceipt=this.#signed(receipt);
      const next=clone(this.#state);
      next.offers[p.offerId].used=true;
      next.requests[requestKey]={principalId,requestHash,status,signedReceipt};
      if(result.accepted){
        next.queue.push({requestId:p.requestId,principalId,
          proposalSha256:p.proposalSha256,proposedRevision:p.proposedRevision,
          proposal:clone(p.proposal),acceptedAt:now,status:"awaiting-independent-review"});
      }
      auditEvent(next,{kind:status,principalId,requestId:p.requestId,now});
      await this.#commit(next);
      return signedReceipt;
    });
  }
  /** Close releases the exclusive local lock. Stale lock after crash must be
   * operator-reconciled; never silently steal it. */
  async close(){
    await this.#tail;
    const lock=this.#lock;
    if(!lock)return;
    this.#lock=null;
    await lock.close();
    await fs.unlink(path.join(this.#directory,".writer.lock"));
  }
}
