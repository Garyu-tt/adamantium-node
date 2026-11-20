import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,symlink,unlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {generateKeyPairSync,createHash,sign} from 'node:crypto';
import {HotWorkerSlot,HOT_MODULE_FORMAT,signedManifestBytes} from '../../adamantium/hot-worker-slot.mjs';

async function harness(callMs=2000){
 const root=await mkdtemp(join(tmpdir(),'ada-hot-worker-'));
 const {publicKey,privateKey}=generateKeyPairSync('ed25519');
 const fingerprint=createHash('sha256').update(publicKey.export({format:'der',type:'spki'})).digest('hex');
 const slot=new HotWorkerSlot({root,pinnedPublicKeyPem:publicKey.export({format:'pem',type:'spki'}),pinnedFingerprint:fingerprint,callMs});
 async function release(id,source){
  await mkdir(join(root,id));
  await writeFile(join(root,id,'entry.mjs'),source);
  const manifest={format:HOT_MODULE_FORMAT,abi:'node-esm-handle/1',moduleName:'diagnostic',releaseId:id,sourceSha256:createHash('sha256').update(source).digest('hex')};
  return {manifest,signature:sign(null,signedManifestBytes(manifest),privateKey).toString('base64')};
 }
 return {root,slot,release,cleanup:async()=>{await slot.close();await rm(root,{recursive:true,force:true});}};
}
const source=name=>"export async function handle(input){if(input.slow)await new Promise(ok=>setTimeout(ok,400));return {release:"+JSON.stringify(name)+",value:input.value}}";
const canary=name=>({canaryInput:{value:'test'},expectedCanary:{release:name,value:'test'}});

test('signed candidate passes canary and activates without Node-RED or MAS grants',async()=>{
 const h=await harness();try{
  const v1=await h.release('v1',source('v1'));
  await assert.rejects(h.slot.invoke({value:1}),/no active module/);
  assert.deepEqual(await h.slot.stage(v1,canary('v1')),{releaseId:'v1',canary:'passed',activeUnchanged:true});
  assert.equal(h.slot.status().active,null);
  assert.equal(h.slot.status().staged,'v1');
  const status=await h.slot.promote({expectedActiveReleaseId:null});
  assert.equal(status.active,'v1');
  assert.equal(status.authorizedMasActions,0);
  assert.equal(status.nativeNodeRedPluginInstalled,false);
  assert.deepEqual(await h.slot.invoke({value:7}),{release:'v1',value:7});
 }finally{await h.cleanup();}
});
test('in-flight call retains old worker through version switch and explicit rollback',async()=>{
 const h=await harness();try{
  await h.slot.stage(await h.release('v1',source('v1')),canary('v1'));
  await h.slot.promote({expectedActiveReleaseId:null});
  const pending=h.slot.invoke({slow:true,value:'old'});
  await h.slot.stage(await h.release('v2',source('v2')),canary('v2'));
  await assert.rejects(h.slot.promote({expectedActiveReleaseId:'stale'}),/stale active release CAS/);
  await h.slot.promote({expectedActiveReleaseId:'v1'});
  assert.deepEqual(await h.slot.invoke({value:'new'}),{release:'v2',value:'new'});
  assert.deepEqual(await pending,{release:'v1',value:'old'});
  assert.throws(()=>h.slot.rollback('stale'),/stale rollback CAS/);
  assert.equal(h.slot.rollback('v2').active,'v1');
  assert.deepEqual(await h.slot.invoke({value:'again'}),{release:'v1',value:'again'});
 }finally{await h.cleanup();}
});
test('tampered source, invalid Ed25519 proof and schema extensions fail closed',async()=>{
 const h=await harness();try{
  const r=await h.release('v1',source('v1'));
  await writeFile(join(h.root,'v1','entry.mjs'),'export const handle=()=>({bad:true})');
  await assert.rejects(h.slot.stage(r,canary('v1')),/source digest mismatch/);
  assert.equal(h.slot.status().active,null);
  assert.equal(h.slot.status().staged,null);
  await assert.rejects(h.slot.stage({...r,signature:r.signature.replace(/^./,r.signature[0]==='A'?'B':'A')},canary('v1')),/signature verification failed/);
  await assert.rejects(h.slot.stage({...r,manifest:{...r.manifest,admin:true}},canary('v1')),/unexpected manifest keys/);
 }finally{await h.cleanup();}
});
test('failed canary cannot overwrite already serving release',async()=>{
 const h=await harness();try{
  await h.slot.stage(await h.release('v1',source('v1')),canary('v1'));
  await h.slot.promote({expectedActiveReleaseId:null});
  await assert.rejects(h.slot.stage(await h.release('v2',source('v2')),canary('v1')),/canary mismatch/);
  assert.equal(h.slot.status().active,'v1');
  assert.equal(h.slot.status().staged,null);
  assert.deepEqual(await h.slot.invoke({value:22}),{release:'v1',value:22});
 }finally{await h.cleanup();}
});
test('unsafe release IDs, excessive input and recovery to valid traffic',async()=>{
 const h=await harness();try{
  const release=await h.release('v1',source('v1'));
  await assert.rejects(h.slot.stage({...release,manifest:{...release.manifest,releaseId:'../../escape'}},canary('v1')),/invalid release id/);
  await h.slot.stage(release,canary('v1'));
  await h.slot.promote({expectedActiveReleaseId:null});
  await assert.rejects(h.slot.invoke({value:'x'.repeat(70000)}),/message exceeds bounds/);
  assert.deepEqual(await h.slot.invoke({value:'valid'}),{release:'v1',value:'valid'});
 }finally{await h.cleanup();}
});
test('symlinked release file is denied before worker startup',async()=>{
 if(process.platform==='win32')return; // Windows symlink privileges differ.
 const h=await harness();try{
  const r=await h.release('v1',source('v1'));
  await unlink(join(h.root,'v1','entry.mjs'));
  await writeFile(join(h.root,'target.mjs'),source('v1'));
  await symlink(join(h.root,'target.mjs'),join(h.root,'v1','entry.mjs'));
  await assert.rejects(h.slot.stage(r,canary('v1')),/symlink release denied/);
 }finally{await h.cleanup();}
});
test('module exception is suppressed and active traffic survives failed candidate',async()=>{
 const h=await harness();try{
  await h.slot.stage(await h.release('v1',source('v1')),canary('v1'));
  await h.slot.promote({expectedActiveReleaseId:null});
  const bad=await h.release('v2','export async function handle(){throw new Error("PRIVATE_MODULE_ERROR_DETAILS")}');
  await assert.rejects(h.slot.stage(bad,canary('v2')),/module invocation failed/);
  assert.equal(h.slot.status().active,'v1');
  assert.deepEqual(await h.slot.invoke({value:32}),{release:'v1',value:32});
 }finally{await h.cleanup();}
});
test('timed-out candidate is discarded without affecting previous release',async()=>{
 const h=await harness(350);try{
  await h.slot.stage(await h.release('v1',source('v1')),canary('v1'));
  await h.slot.promote({expectedActiveReleaseId:null});
  const stalled=await h.release('v2','export async function handle(){await new Promise(()=>{})}');
  await assert.rejects(h.slot.stage(stalled,canary('v2')),/worker invocation timed out/);
  assert.equal(h.slot.status().active,'v1');
  assert.deepEqual(await h.slot.invoke({value:'alive'}),{release:'v1',value:'alive'});
 }finally{await h.cleanup();}
});
