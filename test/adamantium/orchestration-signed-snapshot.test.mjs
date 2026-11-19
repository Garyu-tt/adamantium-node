import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign as edSign} from 'node:crypto';
import {ORCHESTRATION_VIEW_SCHEMA} from '../../adamantium/orchestration-view-contract.mjs';
import {createSnapshotEnvelope,verifySnapshotEnvelope,OrchestrationReadModel,SNAPSHOT_EVENT}
 from '../../adamantium/orchestration-signed-snapshot.mjs';

const owner=generateKeyPairSync('ed25519');
const attacker=generateKeyPairSync('ed25519');
const keyId='graph.manager.v1';
const trustedKeys=new Map([[keyId,owner.publicKey]]);
const now=Date.parse('2026-11-20T10:00:30Z');
const iso=delta=>new Date(now+delta).toISOString();
const opts={trustedKeys,expectedAuthorityProviderId:'manager',now};
const sample=(revision=5)=>({
 schema:ORCHESTRATION_VIEW_SCHEMA,revision,observedAt:iso(-10000),authorityProviderId:'manager',
 providers:[
  {id:'manager',label:'Graph Manager',role:'graph-authority',connection:'unknown',observedAt:iso(-10000),capabilities:[]},
  {id:'agentforge',label:'AgentForge',role:'execution-provider',connection:'reachable',observedAt:iso(-10000),capabilities:[]},
  {id:'cezar',label:'Cezar',role:'development-team',connection:'unknown',observedAt:iso(-10000),capabilities:[]}
 ],
 tasks:[
  {id:'task1',title:'Build UI',status:'complete',ownerProviderId:'agentforge',dependsOn:[],blockers:[],evidenceRef:'proof.1'},
  {id:'task2',title:'Fix worker',status:'blocked',ownerProviderId:'cezar',dependsOn:['task1'],
   blockers:[{code:'auth.pending',reason:'Credential not confirmed',recoveryTaskId:'task3'}]},
  {id:'task3',title:'Verify permission',status:'queued',ownerProviderId:null,dependsOn:['task1'],blockers:[]}
 ]
});
const signed=({revision=5,sequence=7,streamId='prod.tasks',
 issuedAt=iso(-500),expiresAt=iso(60000),privateKey=owner.privateKey}={})=>
 createSnapshotEnvelope(sample(revision),{privateKey,keyId,issuerProviderId:'manager',streamId,
  sequence,issuedAt,expiresAt});
const model=extra=>new OrchestrationReadModel({trustedKeys,expectedAuthorityProviderId:'manager',...extra});

test('authenticates the Graph Manager and creates a read-only R03 UI projection',()=>{
 const value=verifySnapshotEnvelope(signed(),opts);
 assert.equal(value.sequence,7);
 assert.equal(value.view.taskCounts.blocked,1);
 assert.equal(value.projection.document.screens.length,2);
 assert.equal(value.projection.backendMutationsAuthorized,false);
 assert.equal(value.graphMutationAuthorized,false);
 assert.equal(value.invocationAuthorized,false);
 assert.equal(Object.isFrozen(value.projection.document.screens[0].tree.children[0]),true);
});

test('rejects tampering, attacker Ed25519 keys, unknown signers and malformed envelope fields',()=>{
 const good=signed();
 const altered=JSON.parse(Buffer.from(good.payloadBase64,'base64').toString());
 altered.snapshot.tasks[0].title='Fake';
 assert.throws(()=>verifySnapshotEnvelope({...good,payloadBase64:Buffer.from(JSON.stringify(altered)).toString('base64')},opts),/signature/);
 assert.throws(()=>verifySnapshotEnvelope(signed({privateKey:attacker.privateKey}),opts),/signature/);
 assert.throws(()=>verifySnapshotEnvelope({...good,keyId:'unknown'},opts),/untrusted/);
 assert.throws(()=>verifySnapshotEnvelope({...good,canInvoke:true},opts),/unknown property/);
});

test('rejects expired, future, and overly long signed snapshots',()=>{
 assert.throws(()=>verifySnapshotEnvelope(signed({expiresAt:iso(-100)}),opts),/expired/);
 assert.throws(()=>signed({expiresAt:iso(600000)}),/expiry window/);
 assert.throws(()=>verifySnapshotEnvelope(signed({issuedAt:iso(60000),expiresAt:iso(90000)}),opts),/future/);
});

test('rejects incorrect issuer and forbidden action/capability fields',()=>{
 assert.throws(()=>verifySnapshotEnvelope(signed(),{...opts,expectedAuthorityProviderId:'cezar'}),/authority identity/);
 const extra=sample();
 extra.providers[1].bearerToken='secret';
 assert.throws(()=>createSnapshotEnvelope(extra,{privateKey:owner.privateKey,keyId,
  issuerProviderId:'manager',streamId:'prod.tasks',sequence:7,
  issuedAt:iso(-500),expiresAt:iso(60000)}),/forbidden property/);
});

test('rejects stale status, an invalid DAG, and complete tasks without proof',()=>{
 const old=sample();old.providers[1].observedAt=iso(-600000);
 const params={privateKey:owner.privateKey,keyId,issuerProviderId:'manager',streamId:'prod.tasks',
   sequence:7,issuedAt:iso(-500),expiresAt:iso(60000)};
 assert.throws(()=>createSnapshotEnvelope(old,params),/stale or future provider/);
 const cyclic=sample();cyclic.tasks[0].dependsOn=['task3'];
 assert.throws(()=>createSnapshotEnvelope(cyclic,params),/cycle/);
 const falseProof=sample();falseProof.tasks[0].evidenceRef=null;
 assert.throws(()=>createSnapshotEnvelope(falseProof,params),/needs evidence/);
});

test('rejects alternate JSON serialization even if operator signs it',()=>{
 const good=signed();const p=JSON.parse(Buffer.from(good.payloadBase64,'base64').toString());
 const bytes=Buffer.from(JSON.stringify(p,null,2));
 const signedPretty={...good,payloadBase64:bytes.toString('base64'),
  signatureBase64:edSign(null,bytes,owner.privateKey).toString('base64')};
 assert.throws(()=>verifySnapshotEnvelope(signedPretty,opts),/noncanonical/);
});

test('enforces monotonic sequence, graph revision, and one signed stream',()=>{
 const cache=model({expectedStreamId:'prod.tasks'});
 assert.equal(cache.ingestSigned(signed(),{now}).status,'verified-snapshot');
 assert.throws(()=>cache.ingestSigned(signed(),{now}),/replayed sequence/);
 assert.throws(()=>cache.ingestSigned(signed({sequence:8}),{now}),/graph revision/);
 assert.throws(()=>cache.ingestSigned(signed({sequence:8,revision:6,streamId:'other'}),{now}),/stream identity/);
 assert.equal(cache.ingestSigned(signed({sequence:8,revision:6}),{now}).revision,6);
 assert.equal(cache.inspect({now:now+100000}).status,'offline-stale');
 assert.equal(cache.inspect({now:now+100000}).displayOnly,true);
});

test('restores last-known-good in offline read-only mode, never overwriting a newer high-water mark',()=>{
 const saved=signed();
 assert.equal(model({lastAcceptedSequence:7}).restoreSigned(saved,{now:now+100000}).status,'offline-stale');
 assert.throws(()=>model({lastAcceptedSequence:8}).restoreSigned(saved,{now:now+100000}),/high-water/);
 const view=model();
 view.ingestSigned(saved,{now});
 assert.throws(()=>view.restoreSigned(saved,{now}),/restore over active/);
});

test('SSE frames require an authenticated signed payload with a matching ID',()=>{
 const raw=signed();
 const frame=['event: '+SNAPSHOT_EVENT,'id: 7','data: '+JSON.stringify(raw),'',''].join('\n');
 assert.equal(model().ingestSSEFrame(frame,{now}).revision,5);
 assert.throws(()=>model().ingestSSEFrame(frame.replace('id: 7','id: 8'),{now}),/id\/sequence/);
 assert.throws(()=>model().ingestSSEFrame(frame.replace(SNAPSHOT_EVENT,'work.execute'),{now}),/unexpected SSE event/);
 assert.throws(()=>model().ingestSSEFrame('event: orchestration.snapshot\nid: 7\ndata: not-json\n\n',{now}),/invalid SSE JSON/);
});

test('validation never returns a privileged invocation or an executor endpoint',()=>{
 const view=model().ingestSigned(signed(),{now});
 assert.equal(view.invocationAuthorized,false);
 assert.equal(view.graphMutationAuthorized,false);
 assert.equal(Object.hasOwn(view,'endpoint'),false);
 assert.equal(Object.hasOwn(view,'authToken'),false);
});
