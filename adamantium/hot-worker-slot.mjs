/**
 * Verified trusted-module hot-swap proof, independent of Node-RED's plugin API.
 * This does NOT sandbox malicious JavaScript or confer MAS permissions.
 * SPDX-License-Identifier: Apache-2.0
 */
import {createHash, createPublicKey, verify} from 'node:crypto';
import {readFile, realpath, lstat} from 'node:fs/promises';
import {isAbsolute, resolve, join} from 'node:path';
import {Worker} from 'node:worker_threads';
import {isDeepStrictEqual} from 'node:util';

export const HOT_MODULE_FORMAT = 'adamantium.hot-worker-module/1';
const NAME = /^[a-z][a-z0-9_-]{0,63}$/;
const RELEASE = /^[a-z0-9][a-z0-9._-]{0,95}$/;
const SHA = /^[0-9a-f]{64}$/;
const MAX_SOURCE_BYTES = 256 * 1024;
const MAX_MESSAGE_BYTES = 64 * 1024;

function ensure(ok, message) {if(!ok) throw new TypeError('HotWorker: '+message);}
function sha256(data) {return createHash('sha256').update(data).digest('hex');}
export function signedManifestBytes(m) {
  ensure(m && typeof m === 'object' && !Array.isArray(m), 'invalid manifest');
  const keys = Object.keys(m).sort();
  ensure(JSON.stringify(keys) === JSON.stringify(['abi','format','moduleName','releaseId','sourceSha256'].sort()), 'unexpected manifest keys');
  ensure(m.format === HOT_MODULE_FORMAT && m.abi === 'node-esm-handle/1', 'unsupported module ABI');
  ensure(typeof m.moduleName === 'string' && NAME.test(m.moduleName), 'invalid module name');
  ensure(typeof m.releaseId === 'string' && RELEASE.test(m.releaseId), 'invalid release id');
  ensure(typeof m.sourceSha256 === 'string' && SHA.test(m.sourceSha256), 'invalid source digest');
  return Buffer.from('ADAMANTIUM-TRUSTED-HOT-WORKER-R01\n'+
    JSON.stringify([m.format,m.abi,m.moduleName,m.releaseId,m.sourceSha256]));
}
export function verifySignedRelease({manifest,signature}, publicKey, fingerprint) {
  const bytes = signedManifestBytes(manifest);
  ensure(typeof signature === 'string' && /^[A-Za-z0-9+/]+={0,2}$/.test(signature), 'invalid signature');
  const decoded = Buffer.from(signature,'base64');
  ensure(decoded.length === 64 && decoded.toString('base64') === signature, 'noncanonical Ed25519 signature');
  ensure(sha256(publicKey.export({type:'spki',format:'der'})) === fingerprint, 'pinned identity mismatch');
  ensure(verify(null,bytes,publicKey,decoded), 'signature verification failed');
  return manifest;
}
function jsonSize(value) {
  let encoded;
  try {encoded=JSON.stringify(value);} catch {throw new TypeError('HotWorker: JSON-only payload required');}
  ensure(typeof encoded==='string' && Buffer.byteLength(encoded) <= MAX_MESSAGE_BYTES, 'message exceeds bounds');
  return JSON.parse(encoded);
}
class ReleaseWorker {
  constructor(manifest,source,limits){
    this.manifest=manifest;
    this.requests=new Map();this.seq=0;this.dead=false;
    this.worker=new Worker(new URL('./hot-worker-runner.mjs',import.meta.url),{
      workerData:{releaseId:manifest.releaseId,sourceBase64:source.toString('base64')},
      resourceLimits:{maxOldGenerationSizeMb:128,maxYoungGenerationSizeMb:16}
    });
    this.ready=new Promise((ok,fail)=>{
      const timer=setTimeout(()=>fail(new Error('worker startup timed out')),limits.startupMs);
      this.resolveReady=()=>{clearTimeout(timer);ok();};
      this.rejectReady=err=>{clearTimeout(timer);fail(err);};
    });
    this.worker.on('message',msg=>{
      if(msg?.type==='ready'){
        if(msg.releaseId===this.manifest.releaseId)this.resolveReady();
        else this.rejectReady(new Error('worker release mismatch'));
      }else if(msg?.type==='startup-error')this.rejectReady(new Error('worker startup failed'));
      else if(msg?.type==='response'){
        const job=this.requests.get(msg.id);if(!job)return;
        clearTimeout(job.timer);this.requests.delete(msg.id);
        if(msg.ok){
          try {job.ok(jsonSize(msg.output));}catch(e){job.fail(e);}
        }else job.fail(new Error('module invocation failed'));
      }
    });
    this.worker.on('error',e=>this.failAll(e));
    this.worker.on('exit',code=>this.failAll(new Error('worker exited '+code)));
    this.limits=limits;
  }
  failAll(err){this.dead=true;this.rejectReady(err);
    for(const job of this.requests.values()){clearTimeout(job.timer);job.fail(err);}
    this.requests.clear();
  }
  async invoke(input){
    ensure(!this.dead,'worker unavailable');
    ensure(this.requests.size<this.limits.maxPending,'worker overloaded');
    const payload=jsonSize(input);
    const id=++this.seq;
    return await new Promise((ok,fail)=>{
      const timer=setTimeout(()=>{
        this.requests.delete(id);fail(new Error('worker invocation timed out'));
      },this.limits.callMs);
      this.requests.set(id,{ok,fail,timer});
      try{this.worker.postMessage({type:'invoke',id,input:payload});}
      catch(e){clearTimeout(timer);this.requests.delete(id);fail(e);}
    });
  }
  async stop(){
    this.dead=true;
    for(const job of this.requests.values()){clearTimeout(job.timer);job.fail(new Error('worker retired'));}
    this.requests.clear();
    await this.worker.terminate();
  }
}
export class HotWorkerSlot {
  constructor({root,pinnedPublicKeyPem,pinnedFingerprint,startupMs=5000,callMs=2000,maxPending=32}){
    ensure(typeof root==='string' && isAbsolute(root),'absolute source root required');
    ensure(typeof pinnedPublicKeyPem==='string' && pinnedPublicKeyPem.length<4096,'pinned Ed25519 key required');
    ensure(typeof pinnedFingerprint==='string' && SHA.test(pinnedFingerprint),'invalid fingerprint');
    ensure(Number.isInteger(startupMs)&&startupMs>=100&&startupMs<=15000,'invalid startup timeout');
    ensure(Number.isInteger(callMs)&&callMs>=100&&callMs<=10000,'invalid call timeout');
    ensure(Number.isInteger(maxPending)&&maxPending>=1&&maxPending<=64,'invalid pending limit');
    this.root=resolve(root);
    this.key=createPublicKey(pinnedPublicKeyPem);
    ensure(this.key.asymmetricKeyType==='ed25519','Ed25519 public key required');
    this.fingerprint=pinnedFingerprint;
    this.limits={startupMs,callMs,maxPending};
    this.active=null;this.standby=null;this.candidate=null;this.staging=false;this.promoting=false;this.closed=false;
  }
  async stage(envelope,{canaryInput,expectedCanary}){
    ensure(!this.closed && !this.staging && !this.promoting && !this.candidate,'stage already pending');
    this.staging=true;
    let candidate;
    try{
      const m=verifySignedRelease(envelope,this.key,this.fingerprint);
      ensure(!this.active || m.releaseId!==this.active.manifest.releaseId,'release already active');
      const directory=join(this.root,m.releaseId);
      const file=join(directory,'entry.mjs');
      ensure(!(await lstat(directory)).isSymbolicLink() && !(await lstat(file)).isSymbolicLink(),'symlink release denied');
      ensure(await realpath(directory)===directory && await realpath(file)===file,'noncanonical release path');
      const source=await readFile(file);
      ensure(source.length>=1&&source.length<=MAX_SOURCE_BYTES,'source size budget exceeded');
      ensure(sha256(source)===m.sourceSha256,'source digest mismatch');
      candidate=new ReleaseWorker(m,source,this.limits);
      await candidate.ready;
      const output=await candidate.invoke(canaryInput);
      ensure(isDeepStrictEqual(output,expectedCanary),'canary mismatch');
      this.candidate=candidate;
      return {releaseId:m.releaseId,canary:'passed',activeUnchanged:true};
    }catch(error){if(candidate)await candidate.stop();throw error;}
    finally{this.staging=false;}
  }
  async promote({expectedActiveReleaseId}){
    ensure(!this.closed && !this.staging && !this.promoting && this.candidate,'no verified candidate');
    this.promoting=true;
    try {
      const actual=this.active?.manifest.releaseId??null;
      ensure(expectedActiveReleaseId===actual,'stale active release CAS');
      const retiring=this.standby;
      this.standby=this.active;this.active=this.candidate;this.candidate=null;
      if(retiring){
        const start=Date.now();
        while(retiring.requests.size && Date.now()-start<this.limits.callMs+100){
          await new Promise(ok=>setTimeout(ok,10));
        }
        await retiring.stop();
      }
      return this.status();
    } finally {this.promoting=false;}
  }
  rollback(expectedActiveReleaseId){
    ensure(!this.closed && !this.staging && !this.promoting && !this.candidate && this.active && this.standby,'no rollback target');
    ensure(this.active.manifest.releaseId===expectedActiveReleaseId,'stale rollback CAS');
    const previous=this.active;
    this.active=this.standby;this.standby=previous;
    return this.status();
  }
  async invoke(input){
    ensure(!this.closed && this.active,'no active module');
    return this.active.invoke(input);
  }
  status(){return {format:'adamantium.hot-worker-slot/1',
    active:this.active?.manifest.releaseId??null,
    rollback:this.standby?.manifest.releaseId??null,
    staged:this.candidate?.manifest.releaseId??null,
    authorizedMasActions:0,
    nativeNodeRedPluginInstalled:false};}
  async close(){if(this.closed)return;
    ensure(!this.staging && !this.promoting,'slot operation in progress');
    this.closed=true;
    await Promise.allSettled([this.active,this.standby,this.candidate].filter(Boolean).map(w=>w.stop()));
    this.active=null;this.standby=null;this.candidate=null;
  }
}
