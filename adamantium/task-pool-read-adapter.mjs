/**
 * R06 — bounded read-only Task Pool projection, discovered via visible MAS
 * capability graph. Task Pool owns task state; Graph Manager only renders it.
 * No URLs, credentials, claim/submit/complete actions or raw private payloads.
 */
import {ORCHESTRATION_VIEW_SCHEMA,validateOrchestrationView} from './orchestration-view-contract.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OWNER=/^[a-z][a-z0-9_-]{1,63}$/;
const ACTION=/^[a-z][a-z0-9_-]{1,63}\.[a-z][a-z0-9._-]{0,127}$/;
const STATES=new Map([
 ['queued','queued'],['claimed','claimed'],['needs_review','needs-review'],
 ['completed','completed-unverified'],['failed','failed'],['cancelled','cancelled']
]);
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
function reject(message){throw new TypeError('Task Pool projection rejected: '+message);}
function cleaned(x,fallback){
 if(typeof x!=='string'||!x.trim())return fallback;
 const value=x.replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,300);
 return value||fallback;
}
/**
 * Discover only authorized read actions from an independently authenticated
 * permission-filtered Core graph. This does not prove graph authentication.
 *
 * No visible read resource => return null; never probe ports, enumerate files,
 * guess endpoints or try mutating actions.
 */
export function discoverTaskPoolReader(visibleGraph){
 if(!object(visibleGraph)||!Array.isArray(visibleGraph.nodes)||visibleGraph.nodes.length>4096){
  reject('invalid visible graph');
 }
 const actions=new Set(visibleGraph.nodes
  .filter(n=>object(n)&&n.type==='action'&&typeof n.id==='string')
  .map(n=>n.id));
 const candidates=[];
 for(const n of visibleGraph.nodes){
  if(!object(n)||n.type!=='resource'||n.provider?.schema!=='mas-task-provider-1')continue;
  if(typeof n.id!=='string')reject('invalid resource id');
  const owner=n.id.split('.')[0];
  if(!OWNER.test(owner))reject('invalid owner');
  const listAction=n.provider.listAction;
  if(typeof listAction!=='string'||!ACTION.test(listAction))continue;
  if(listAction!==owner+'.list'||!actions.has(listAction))continue;
  candidates.push({owner,action:listAction,resource:n.id});
 }
 if(candidates.length>1)reject('ambiguous Task Pool authority; select a pinned source');
 return candidates[0]?Object.freeze(candidates[0]):null;
}
function safeTask(row){
 if(!object(row)||typeof row.taskId!=='string'||!UUID.test(row.taskId)){
  reject('malformed task identity');
 }
 if(typeof row.title!=='string'||row.title.length<1||row.title.length>160){
  reject('invalid task title');
 }
 if(!STATES.has(row.status))reject('unknown task status');
 if(!Number.isSafeInteger(row.revision)||row.revision<1)reject('invalid task revision');
 if(!Array.isArray(row.requires)||row.requires.length>128||
    !row.requires.every(x=>typeof x==='string'&&x.length<128)){
  reject('invalid capability requirements');
 }
 if(row.status==='claimed'){
  if(!object(row.lease)||typeof row.lease.workerId!=='string')reject('missing claimed lease');
 }
 const status=STATES.get(row.status);
 const blockers=[];
 if(status==='needs-review'){
  blockers.push({code:'taskpool.needs_review',
   reason:cleaned(row.note,'Результат выполнения неизвестен: требуется независимая сверка'),
   recoveryTaskId:null});
 }
 return Object.freeze({
  id:'task:'+row.taskId.toLowerCase(),
  title:cleaned(row.title,'Задача без названия'),
  status,
  ownerProviderId:null,
  // Task Pool R01 requires describes CAPABILITY requirements,
  // NOT DAG predecessor task IDs. Never fabricate DAG edges from it.
  dependsOn:[],
  blockers
 });
}
/**
 * readAction must be the approved Core read callback. It must only invoke
 * the graph-discovered listAction with an explicit read permission.
 * A successful response does not establish live write capability.
 */
export async function readTaskPoolView({
 visibleGraph,readAction,graphRevision,observedAt
}={}){
 if(!Number.isSafeInteger(graphRevision)||graphRevision<1)reject('graph revision required');
 if(typeof observedAt!=='string'||!Number.isFinite(Date.parse(observedAt))){
  reject('trusted observation timestamp required');
 }
 const descriptor=discoverTaskPoolReader(visibleGraph);
 if(descriptor===null){
  return Object.freeze({status:'source-not-visible',view:null,source:null,
   partial:true,authorizedExecution:false});
 }
 if(typeof readAction!=='function')reject('approved Core read callback required');
 let rows;
 try{rows=await readAction(descriptor.action,Object.freeze({limit:200}));}
 catch{
  return Object.freeze({status:'source-read-failed',view:null,source:descriptor.owner,
   partial:true,authorizedExecution:false});
 }
 if(!Array.isArray(rows)||rows.length>200)reject('invalid bounded list reply');
 const seen=new Set();
 const tasks=rows.map(row=>{
  const projected=safeTask(row);
  if(seen.has(projected.id))reject('duplicate task');
  seen.add(projected.id);
  return projected;
 });
 const snapshot={
  schema:ORCHESTRATION_VIEW_SCHEMA,revision:graphRevision,observedAt,
  authorityProviderId:descriptor.owner,
  providers:[{
   id:descriptor.owner,label:'Task Pool (источник задач)',
   role:'graph-authority',connection:'read-only',observedAt,capabilities:[]
  }],
  tasks
 };
 const view=validateOrchestrationView(snapshot);
 return Object.freeze({
  status:'read-only',source:descriptor.owner,
  actionContract:'mas-task-provider-1',view,
  // Current Task Pool list is capped at 200; upstream store can hold 256.
  // Even a list shorter than 200 cannot prove entire universe is complete.
  partial:true,sourceLimit:200,
  caveats:Object.freeze([
   'Task Pool is task-state owner; Graph Manager is a view and not task-state storage',
   'TaskPool.requires are capabilities, not DAG dependencies',
   'Completed is shown as completed-unverified without independent QA receipt',
   'Claimed is not proof of worker execution',
   'Absent remote providers are not invented'
  ]),
  authorizedExecution:false
 });
}
