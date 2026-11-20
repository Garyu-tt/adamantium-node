/**
 * Adamantium Construct R04: local versioned blueprint vault + deterministic
 * construction logistics. Source-only; no runtime, network, MAS or deployment.
 * SPDX-License-Identifier: Apache-2.0
 */
import {validateBlueprint,preparePlacement} from "./core.mjs";

export const VAULT_FORMAT="adamantium.construct-vault/1";
const ID=/^[a-z][a-z0-9_.-]{1,63}$/;
const MAX_ENTRIES=64,MAX_VERSIONS=12,MAX_DEPENDENCIES=8,MAX_NODES=64;
const isObj=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const ensure=(ok,msg)=>{if(!ok)throw new TypeError(msg);};
const clone=x=>JSON.parse(JSON.stringify(x));
const ref=(id,version)=>id+"@"+version;
function validId(x){ensure(typeof x==="string"&&ID.test(x),"invalid blueprint ID");return x;}
function validVersion(x){ensure(Number.isSafeInteger(x)&&x>=1&&x<=MAX_VERSIONS,"invalid blueprint version");return x;}
function validTitle(x){ensure(typeof x==="string"&&x.trim()&&x.length<=100,"invalid title");return x.trim();}
function validDependency(x){ensure(isObj(x),"invalid dependency");return {id:validId(x.id),version:validVersion(x.version)};}
function normalize(raw){
  ensure(isObj(raw),"invalid blueprint package");
  const id=validId(raw.id),version=validVersion(raw.version);
  const title=validTitle(raw.title);
  const sourceAccess=raw.sourceAccess||"closed";
  const distribution=raw.distribution||"free";
  ensure(["open","closed"].includes(sourceAccess),"invalid source visibility");
  ensure(["free","paid"].includes(distribution),"invalid distribution model");
  const publicListing=raw.publicListing===true;
  ensure(!publicListing||sourceAccess==="open","closed source cannot enter public catalog");
  ensure(Array.isArray(raw.dependencies)&&raw.dependencies.length<=MAX_DEPENDENCIES,"dependency budget exceeded");
  const deps=raw.dependencies.map(validDependency);
  const keys=new Set();
  for(const d of deps){
    const key=ref(d.id,d.version);
    ensure(!keys.has(key),"duplicate dependency");
    keys.add(key);
  }
  const bp=validateBlueprint(raw.blueprint);
  return {id,version,title,sourceAccess,distribution,publicListing,
    dependencies:deps,blueprint:bp};
}
function canonical(data){
  // Stable, explicitly ordered JSON. All source nodes are validated allowlisted
  // structures; untrusted extra fields are discarded by normalize.
  return JSON.stringify(data);
}
async function hash(data){
  ensure(!!globalThis.crypto?.subtle&&typeof TextEncoder==="function","SHA-256 Web Crypto unavailable");
  const bytes=new TextEncoder().encode(canonical(data));
  const digest=await globalThis.crypto.subtle.digest("SHA-256",bytes);
  return "sha256:"+Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,"0")).join("");
}
export async function sealPackage(raw){
  const normalized=normalize(raw);
  return {...normalized,digest:await hash(normalized)};
}
export async function verifyPackage(raw){
  const normalized=normalize(raw);
  ensure(typeof raw.digest==="string"&&raw.digest===await hash(normalized),"blueprint SHA-256 integrity failure");
  return {...normalized,digest:raw.digest};
}
export function emptyVault(){
  return {format:VAULT_FORMAT,revision:0,entries:[]};
}
export async function validateVault(raw){
  if(raw===undefined||raw===null)return emptyVault();
  ensure(isObj(raw)&&raw.format===VAULT_FORMAT&&Number.isSafeInteger(raw.revision)&&
    raw.revision>=0&&raw.revision<=1000000,"unsupported vault format/revision");
  ensure(Array.isArray(raw.entries)&&raw.entries.length<=MAX_ENTRIES,"vault entry budget exceeded");
  ensure(JSON.stringify(raw).length<=1500000,"vault size budget exceeded");
  const entries=[],unique=new Set(),count=new Map();
  for(const value of raw.entries){
    const entry=await verifyPackage(value);
    const key=ref(entry.id,entry.version);
    ensure(!unique.has(key),"duplicate package version");
    unique.add(key);
    count.set(entry.id,(count.get(entry.id)||0)+1);
    ensure(count.get(entry.id)<=MAX_VERSIONS,"version budget exceeded");
    entries.push(entry);
  }
  entries.sort((a,b)=>a.id.localeCompare(b.id)||a.version-b.version);
  return {format:VAULT_FORMAT,revision:raw.revision,entries};
}
export async function putPackage(vault,raw,{expectedRevision}={}){
  const current=await validateVault(vault);
  ensure(expectedRevision===current.revision,"stale vault revision");
  ensure(current.entries.length<MAX_ENTRIES,"vault full");
  const next=await sealPackage(raw);
  ensure(!current.entries.some(e=>e.id===next.id&&e.version===next.version),"package version already immutable");
  const versions=current.entries.filter(e=>e.id===next.id);
  ensure(versions.length<MAX_VERSIONS,"too many versions");
  if(versions.length){
    ensure(next.version>Math.max(...versions.map(v=>v.version)),"version must increase monotonically");
  }
  return validateVault({...current,revision:current.revision+1,entries:[...current.entries,next]});
}
export async function importVault(vault,other,{expectedRevision}={}){
  const current=await validateVault(vault),incoming=await validateVault(other);
  ensure(expectedRevision===current.revision,"stale vault revision");
  let updated=current;
  for(const entry of incoming.entries){
    const same=updated.entries.find(e=>e.id===entry.id&&e.version===entry.version);
    if(same){
      ensure(same.digest===entry.digest,"conflicting immutable version");
      continue;
    }
    updated=await putPackage(updated,entry,{expectedRevision:updated.revision});
  }
  return updated;
}
function byKey(vault){
  return new Map(vault.entries.map(v=>[ref(v.id,v.version),v]));
}
export async function planConstruction(vault,requests,{maxNodes=MAX_NODES,maxUnits=160}={}){
  const current=await validateVault(vault);
  ensure(Array.isArray(requests)&&requests.length>=1&&requests.length<=8,"request budget exceeded");
  ensure(Number.isSafeInteger(maxNodes)&&maxNodes>=1&&maxNodes<=64,"invalid node quota");
  ensure(Number.isSafeInteger(maxUnits)&&maxUnits>=1&&maxUnits<=160,"invalid cost quota");
  const packages=byKey(current),visited=new Set(),active=new Set(),order=[],depthLimit=16;
  function visit(key,depth){
    ensure(depth<=depthLimit,"dependency nesting too deep");
    ensure(!active.has(key),"dependency cycle: "+key);
    if(visited.has(key))return;
    const entry=packages.get(key);
    ensure(!!entry,"unresolved dependency: "+key);
    active.add(key);
    for(const d of entry.dependencies)visit(ref(d.id,d.version),depth+1);
    active.delete(key);visited.add(key);order.push(entry);
    ensure(order.length<=24,"dependency package budget exceeded");
  }
  for(const req of requests){
    const dep=validDependency(req);
    visit(ref(dep.id,dep.version),0);
  }
  const costs={inject:2,debug:1,change:3,switch:3,delay:2,comment:1,json:2,catch:1};
  const count=order.reduce((sum,e)=>sum+e.blueprint.nodes.length,0);
  const units=order.reduce((sum,e)=>sum+e.blueprint.nodes.reduce((acc,n)=>acc+costs[n.type],0),0);
  ensure(count<=maxNodes,"construction node quota exceeded");
  ensure(units<=maxUnits,"construction scheduling unit quota exceeded");
  const edges=order.reduce((sum,e)=>sum+e.blueprint.nodes.reduce((a,n)=>a+n.wires.reduce((s,w)=>s+w.length,0),0),0);
  ensure(edges<=256,"construction wire quota exceeded");
  const planId=await hash({
    revision:current.revision,requests:requests.map(validDependency),
    packageDigests:order.map(e=>e.digest)
  });
  return {format:"adamantium.construct-plan/1",vaultRevision:current.revision,
    planId,requests:requests.map(validDependency),
    steps:order.map((e,index)=>({id:e.id,version:e.version,digest:e.digest,
      dependsOn:e.dependencies.map(d=>ref(d.id,d.version)),stage:index+1,
      nodeCount:e.blueprint.nodes.length})),
    totals:{packages:order.length,nodes:count,edges,constructionUnits:units},
    // These are relative construction-budget tokens, NOT actual CPU/RAM forecasts.
    unitMeaning:"relative_editor_construction_cost_only"};
}
export async function compileConstruction(vault,plan,flowId,anchor={x:180,y:160}){
  const current=await validateVault(vault);
  ensure(isObj(plan)&&plan.format==="adamantium.construct-plan/1","invalid construction plan");
  ensure(plan.vaultRevision===current.revision,"stale construction plan");
  const checked=await planConstruction(current,plan.requests);
  ensure(checked.planId===plan.planId,"construction plan integrity conflict");
  const packages=byKey(current),nodes=[];
  for(let i=0;i<checked.steps.length;i++){
    const entry=packages.get(ref(checked.steps[i].id,checked.steps[i].version));
    const ids=new Map(entry.blueprint.nodes.map((n,j)=>[n.id,"r"+(i+1)+"_n"+(j+1)]));
    const row=Math.floor(i/3),column=i%3;
    for(const n of entry.blueprint.nodes){
      nodes.push({...clone(n),id:ids.get(n.id),
        x:n.x+column*540,y:n.y+row*320,
        wires:n.wires.map(w=>w.map(target=>ids.get(target)))});
    }
  }
  const normalized=validateBlueprint({nodes});
  return preparePlacement(normalized,flowId,anchor);
}
/**
 * Explicit export is not publishing. Public export requires BOTH
 * open source permissions AND per-package publicListing opt-in.
 * Paid/free are independent labels and do not grant publicity.
 * Closed/private packages cannot leak transitively as dependencies.
 */
export async function exportVault(vault,{publicOnly=true}={}){
  const current=await validateVault(vault);
  if(!publicOnly)return current;
  const ids=new Map(current.entries.filter(e=>e.publicListing&&e.sourceAccess==="open")
    .map(e=>[ref(e.id,e.version),e]));
  // Do not expose a public plan with a hidden dependency, including indirectly.
  const allowed=new Set();
  const visiting=new Set();
  function publishable(key){
    if(allowed.has(key))return true;
    if(visiting.has(key))return false;
    const entry=ids.get(key);
    if(!entry)return false;
    visiting.add(key);
    const yes=entry.dependencies.every(d=>publishable(ref(d.id,d.version)));
    visiting.delete(key);
    if(yes)allowed.add(key);
    return yes;
  }
  for(const key of ids.keys())publishable(key);
  const visible=current.entries.filter(e=>allowed.has(ref(e.id,e.version)));
  return {...current,entries:visible};
}
export class ConstructionQueue {
  constructor(){this.pending=[];this.active=new Map();this.seen=new Set();this.receipts=[];}
  enqueue({ticket,flowId,planId,expectedStamp}){
    ensure(typeof ticket==="string"&&/^[a-zA-Z0-9_.-]{1,90}$/.test(ticket),"invalid work ticket");
    ensure(typeof flowId==="string"&&/^[a-zA-Z0-9_.:-]{1,128}$/.test(flowId),"invalid target flow");
    ensure(typeof planId==="string"&&/^sha256:[0-9a-f]{64}$/.test(planId),"invalid plan digest");
    ensure(typeof expectedStamp==="string"&&expectedStamp.length<=600,"invalid flow signature");
    ensure(!this.seen.has(ticket),"duplicate work ticket");
    ensure(this.pending.length<16,"construction queue is full");
    this.seen.add(ticket);
    this.pending.push({ticket,flowId,planId,expectedStamp});
    return this.status();
  }
  acquire(flowId,currentStamp){
    ensure(typeof flowId==="string","invalid flow");
    ensure(!this.active.has(flowId),"flow already has construction lease");
    const index=this.pending.findIndex(x=>x.flowId===flowId);
    if(index===-1)return null;
    const next=this.pending[index];
    ensure(next.expectedStamp===currentStamp,"stale flow snapshot / CAS mismatch");
    this.pending.splice(index,1);
    this.active.set(flowId,next);
    return clone(next);
  }
  settle(flowId,ticket,{ok,createdIds=[]}={}){
    const item=this.active.get(flowId);
    ensure(item?.ticket===ticket,"construction lease ownership mismatch");
    ensure(typeof ok==="boolean"&&Array.isArray(createdIds)&&createdIds.length<=64,"invalid work receipt");
    for(const id of createdIds)ensure(typeof id==="string"&&id.length<=128,"invalid created node ID");
    const receipt={ticket,flowId,ok,created:createdIds.length};
    this.active.delete(flowId);
    this.receipts=[...this.receipts.slice(-127),receipt];
    return clone(receipt);
  }
  cancel(ticket){
    const i=this.pending.findIndex(x=>x.ticket===ticket);
    if(i<0)return false;
    this.pending.splice(i,1);return true;
  }
  status(){return {queued:this.pending.length,active:this.active.size,receipts:this.receipts.length};}
}
