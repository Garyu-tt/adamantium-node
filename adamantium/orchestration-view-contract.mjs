/**
 * Adamantium-node R04 — purely read-only projection of an externally verified
 * Graph Manager orchestration snapshot. No actions, URLs or credentials.
 */
export const ORCHESTRATION_VIEW_SCHEMA = "mechanicus.orchestration-view/1";
const ID=/^[a-z][a-z0-9._:-]{0,127}$/;
const ROLES=new Set(["graph-authority","execution-provider","development-team","scheduler","tool-adapter","observer"]);
const STATES=new Set(["reachable","read-only","degraded","unknown","offline"]);
const TASKS=new Set(["new","queued","running","blocked","waiting-approval","testing","complete","failed"]);
const obj=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const error=msg=>{throw new TypeError("Orchestration view rejected: "+msg);};
function fields(value,keys,required=keys){
  if(!obj(value))error("expected object");
  for(const k of Object.keys(value))if(!keys.includes(k))error("forbidden property "+k);
  for(const k of required)if(!Object.hasOwn(value,k))error("missing "+k);
}
function identifier(x){
  if(typeof x!=="string"||!ID.test(x))error("invalid identifier");
  return x;
}
function label(x){
  if(typeof x!=="string"||x.length<1||x.length>320||/[\u0000-\u001f]/.test(x))error("invalid label");
  return x;
}
function instant(x){
  if(typeof x!=="string"||x.length>40||!Number.isFinite(Date.parse(x))||
   !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(x))error("invalid timestamp");
}
function ids(values,limit){
  if(!Array.isArray(values)||values.length>limit)error("invalid ID collection");
  const seen=new Set();
  for(const v of values){const key=identifier(v);if(seen.has(key))error("duplicate identifier");seen.add(key);}
  return seen;
}
function graphCheck(byTask){
  const done=new Set(),visiting=new Set();
  function walk(key){
    if(visiting.has(key))error("dependency cycle");
    if(done.has(key))return;
    visiting.add(key);
    for(const dep of byTask.get(key).dependsOn)walk(dep);
    visiting.delete(key);done.add(key);
  }
  for(const key of byTask.keys())walk(key);
}
/**
 * Shape validation only. The caller must authenticate the source separately;
 * this return value never grants a backend operation or capability.
 */
export function validateOrchestrationView(view){
  fields(view,["schema","revision","observedAt","authorityProviderId","providers","tasks"]);
  if(view.schema!==ORCHESTRATION_VIEW_SCHEMA)error("schema mismatch");
  if(!Number.isSafeInteger(view.revision)||view.revision<1)error("revision");
  instant(view.observedAt);
  if(!Array.isArray(view.providers)||view.providers.length>128)error("provider limit");
  if(!Array.isArray(view.tasks)||view.tasks.length>1000)error("task limit");
  const providers=new Map();
  for(const p of view.providers){
    fields(p,["id","label","role","connection","observedAt","capabilities"]);
    identifier(p.id);label(p.label);instant(p.observedAt);
    if(!ROLES.has(p.role)||!STATES.has(p.connection))error("unknown provider role or connection");
    ids(p.capabilities,128);
    if(providers.has(p.id))error("duplicate provider");
    providers.set(p.id,p);
  }
  const auth=identifier(view.authorityProviderId);
  if(!providers.has(auth)||providers.get(auth).role!=="graph-authority")error("invalid authority");
  if([...providers.values()].filter(p=>p.role==="graph-authority").length!==1)error("exactly one graph authority required");
  const tasks=new Map();
  for(const t of view.tasks){
    fields(t,["id","title","status","ownerProviderId","dependsOn","blockers","evidenceRef"],
     ["id","title","status","ownerProviderId","dependsOn","blockers"]);
    identifier(t.id);label(t.title);
    if(!TASKS.has(t.status))error("invalid task status");
    if(t.ownerProviderId!==null&&(!providers.has(t.ownerProviderId)||t.ownerProviderId===auth))
      error("invalid task owner");
    ids(t.dependsOn,40);
    if(!Array.isArray(t.blockers)||t.blockers.length>16)error("invalid blockers");
    if(t.status==="blocked"&&t.blockers.length===0)error("blocker diagnosis missing");
    for(const b of t.blockers){
      fields(b,["code","reason","recoveryTaskId"]);
      identifier(b.code);label(b.reason);
      if(b.recoveryTaskId!==null)identifier(b.recoveryTaskId);
    }
    if(t.status==="complete"&&!Object.hasOwn(t,"evidenceRef"))error("completed task missing evidence");
    if(Object.hasOwn(t,"evidenceRef")&&t.evidenceRef!==null)identifier(t.evidenceRef);
    if(tasks.has(t.id))error("duplicate task");
    tasks.set(t.id,t);
  }
  for(const t of tasks.values()){
    for(const dep of t.dependsOn){
      if(dep===t.id||!tasks.has(dep))error("unknown or self dependency");
    }
    for(const b of t.blockers){
      if(b.recoveryTaskId!==null&&!tasks.has(b.recoveryTaskId))error("missing recovery task");
    }
  }
  graphCheck(tasks);
  const taskCounts=Object.fromEntries([...TASKS].map(key=>[key,0]));
  for(const t of tasks.values())taskCounts[t.status]++;
  return Object.freeze({
    schema:ORCHESTRATION_VIEW_SCHEMA,revision:view.revision,
    authorityProviderId:auth,
    providers:Object.freeze([...providers.values()].map(p=>Object.freeze({...p,capabilities:Object.freeze([...p.capabilities])}))),
    tasks:Object.freeze([...tasks.values()].map(t=>Object.freeze({...t,dependsOn:Object.freeze([...t.dependsOn]),
      blockers:Object.freeze(t.blockers.map(b=>Object.freeze({...b})))}))),
    taskCounts:Object.freeze(taskCounts),
    executionAuthorized:false,graphMutationAuthorized:false,invocationAuthorized:false
  });
}
