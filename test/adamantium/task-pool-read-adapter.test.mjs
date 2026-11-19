import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {discoverTaskPoolReader,readTaskPoolView} from '../../adamantium/task-pool-read-adapter.mjs';
import {createSnapshotEnvelope,verifySnapshotEnvelope} from '../../adamantium/orchestration-signed-snapshot.mjs';
import {projectOrchestrationMobileUI} from '../../adamantium/orchestration-mobile-projection.mjs';
const at='2026-11-20T10:00:00Z';
const uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const graph=()=>({nodes:[
  {id:'task_pool.list',type:'action'},
  {id:'task_pool.get',type:'action'},
  {id:'task_pool.index',type:'resource',
   provider:{schema:'mas-task-provider-1',listAction:'task_pool.list',getAction:'task_pool.get'}},
  {id:'task_pool.claim',type:'action'}
]});
const item=(num,status,more={})=>({
 taskId:uuid(num),title:'Task #'+num,revision:num,requires:['android.camera.read'],
 status,lease:null,...more
});
const rows=()=>[
 item(1,'queued'),
 item(2,'claimed',{lease:{workerId:'worker1',expiresAt:Date.now()+100000}}),
 item(3,'needs_review',{note:'lease_expired_execution_unknown'}),
 item(4,'completed',{outcome:{result:'done, no independent QA'}}),
 item(5,'failed'),
 item(6,'cancelled')
];
const request=(override={})=>({visibleGraph:graph(),graphRevision:42,observedAt:at,
 readAction:async()=>rows(),...override});

test('discover only a visible matching same-owner list action',()=>{
 assert.equal(discoverTaskPoolReader(graph()).action,'task_pool.list');
 const g=graph();g.nodes=g.nodes.filter(n=>n.id!=='task_pool.list');
 assert.equal(discoverTaskPoolReader(g),null);
 const forged=graph();forged.nodes[2].provider.listAction='task_pool.claim';
 assert.equal(discoverTaskPoolReader(forged),null);
 const wrong=graph();wrong.nodes[2].provider.listAction='other.list';
 assert.equal(discoverTaskPoolReader(wrong),null);
});

test('missing reader is explicitly unavailable without backend calls',async()=>{
 let called=0;
 const result=await readTaskPoolView(request({visibleGraph:{nodes:[]},
  readAction:async()=>{called++;throw Error('must never be invoked');}}));
 assert.equal(called,0);
 assert.equal(result.status,'source-not-visible');
 assert.equal(result.view,null);
 assert.equal(result.authorizedExecution,false);
});

test('reads only task_pool.list, preserves statuses without invented evidence or dependency edges',async()=>{
 const observed=[];
 const result=await readTaskPoolView(request({
  readAction:async(action,params)=>{observed.push([action,params]);return rows();}
 }));
 assert.equal(observed.length,1);
 assert.equal(observed[0][0],'task_pool.list');
 assert.deepEqual(observed[0][1],{limit:200});
 assert.equal(result.status,'read-only');
 assert.equal(result.snapshot.authorityProviderId,'task_pool');
 const items=result.view.tasks;
 assert.deepEqual(items.map(x=>x.status),[
  'queued','claimed','needs-review','completed-unverified','failed','cancelled'
 ]);
 assert.equal(items[2].blockers[0].reason,'lease_expired_execution_unknown');
 assert.equal(items[3].evidenceRef,undefined);
 assert.deepEqual(items[0].dependsOn,[]);
 assert.equal(result.view.taskCounts.complete,0);
 assert.equal(result.view.taskCounts['completed-unverified'],1);
 assert.equal(result.partial,true);
 assert.equal(result.authorizedExecution,false);
});

test('Task Pool completed with arbitrary result cannot silently become accepted QA',async()=>{
 const result=await readTaskPoolView(request({readAction:async()=>[
  item(7,'completed',{outcome:{evidenceRef:'model-generated-but-not-independently-checked'}})
 ]}));
 assert.equal(result.view.tasks[0].status,'completed-unverified');
 assert.equal(result.view.tasks[0].evidenceRef,undefined);
});

test('a failed Core read returns absent data, not a made-up empty queue',async()=>{
 const result=await readTaskPoolView(request({readAction:async()=>{throw Error('denied or unavailable');}}));
 assert.equal(result.status,'source-read-failed');
 assert.equal(result.view,null);
 assert.equal(result.authorizedExecution,false);
});

test('malformed and ambiguous input fails closed',async()=>{
 const duplicateGraph=graph();duplicateGraph.nodes.push({
  id:'task_pool.index2',type:'resource',
  provider:{schema:'mas-task-provider-1',listAction:'task_pool.list'}
 });
 assert.throws(()=>discoverTaskPoolReader(duplicateGraph),/ambiguous/);
 await assert.rejects(()=>readTaskPoolView(request({readAction:async()=>[item(1,'queued'),item(1,'queued')]})),/duplicate task/);
 await assert.rejects(()=>readTaskPoolView(request({readAction:async()=>[item(1,'magic')]})),/unknown task status/);
 await assert.rejects(()=>readTaskPoolView(request({readAction:async()=>[item(1,'claimed')]})),/claimed lease/);
 await assert.rejects(()=>readTaskPoolView(request({readAction:async()=>new Array(201).fill(null)})),/invalid bounded list/);
});

test('requires a trusted revision and observation timestamp',async()=>{
 await assert.rejects(()=>readTaskPoolView(request({graphRevision:0})),/revision/);
 await assert.rejects(()=>readTaskPoolView(request({observedAt:'invalid'})),/timestamp/);
});

test('R06 raw snapshot fits signed R05 envelope and read-only R03 UI without any writes',async()=>{
 const pair=generateKeyPairSync('ed25519');
 const result=await readTaskPoolView(request());
 const payload=createSnapshotEnvelope(result.snapshot,{
  privateKey:pair.privateKey,keyId:'taskpool.signer',
  issuerProviderId:'task_pool',streamId:'taskpool.workorders',
  sequence:7,issuedAt:'2026-11-20T10:00:05Z',expiresAt:'2026-11-20T10:01:05Z'
 });
 const verified=verifySnapshotEnvelope(payload,{
  trustedKeys:new Map([['taskpool.signer',pair.publicKey]]),
  expectedAuthorityProviderId:'task_pool',now:Date.parse('2026-11-20T10:00:10Z')
 });
 const mobile=projectOrchestrationMobileUI(result.snapshot);
 assert.equal(verified.projection.document.screens.length,2);
 assert.equal(mobile.backendMutationsAuthorized,false);
 assert.equal(verified.invocationAuthorized,false);
 assert.equal(verified.view.taskCounts['needs-review'],1);
 assert.equal(verified.view.taskCounts['completed-unverified'],1);
});

test('view is partial and the callback never receives submit, claim or complete',async()=>{
 const seen=[];
 await readTaskPoolView(request({readAction:async(a,p)=>{seen.push(a);return [];}}));
 assert.deepEqual(seen,['task_pool.list']);
 const source=await readTaskPoolView(request({readAction:async()=>[]}));
 assert.equal(source.partial,true);
 assert.equal(source.sourceLimit,200);
 assert.equal(source.view.tasks.length,0);
});
