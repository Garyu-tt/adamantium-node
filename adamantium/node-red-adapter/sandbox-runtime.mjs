// SPDX-License-Identifier: Apache-2.0
// Starts a fresh Node-RED 5 process. Never reuses ~/.node-red or production ports.
import {createServer} from 'node:net';
import {randomBytes,createHash} from 'node:crypto';
import {mkdir,copyFile,cp,writeFile,readFile,access} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {manufactureIsolated} from '../node-factory/manufacture.mjs';
import {FactorySandboxAdmin} from './sandbox-admin.mjs';

const entry=fileURLToPath(new URL('../../packages/node_modules/node-red/red.js',import.meta.url));
const settingsSource=fileURLToPath(new URL('./sandbox-settings.cjs',import.meta.url));
async function freePort(){
 const server=createServer();
 await new Promise((resolve,reject)=>server.once('error',reject)
  .listen(0,'127.0.0.1',resolve));
 const port=server.address().port;
 await new Promise(resolve=>server.close(resolve));
 return port;
}
const sha=b=>'sha256:'+createHash('sha256').update(b).digest('hex');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export async function startFactorySandbox({root,contract}){
 if(typeof root!=='string'||root.length<1)
  throw new TypeError('explicit_new_sandbox_parent_required');
 await access(entry);
 await mkdir(root,{recursive:false});
 const receipt=await manufactureIsolated(contract,join(root,'manufacture'));
 const userDir=join(root,'user-dir');
 await mkdir(userDir);
 const target=join(userDir,'node_modules',receipt.packageName);
 await mkdir(join(userDir,'node_modules'));
 await cp(receipt.palette,target,{recursive:true,force:false,errorOnExist:true});
 for(const [file,expected] of Object.entries(receipt.artifactHashes))
  if(sha(await readFile(join(target,file)))!==expected)
   throw new Error('sandbox_installed_package_hash_mismatch');
 await copyFile(settingsSource,join(userDir,'settings.js'));
 await writeFile(join(userDir,'flows.json'),'[]\n',{flag:'wx'});
 await writeFile(join(userDir,'package.json'),JSON.stringify({
  name:'adamantium-test-palette',version:'0.0.0',private:true
 },null,2)+'\n',{flag:'wx'});
 const port=await freePort();
 const sandboxId='factory-'+randomBytes(16).toString('hex');
 const token=randomBytes(32).toString('base64url');
 const lines=[];
 const childEnv={...process.env};
 delete childEnv.ADAMANTIUM_AGENT_API_TOKEN;
 const child=spawn(process.execPath,[entry,'--settings',join(userDir,'settings.js'),
  '--userDir',userDir,'--port',String(port),'--no-telemetry'],{
  cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe'],
  env:{...childEnv,ADAMANTIUM_NODE_SANDBOX_ID:sandboxId,
   ADAMANTIUM_NODE_SANDBOX_TOKEN:token}
 });
 const append=b=>{
  lines.push(String(b));
  if(lines.length>500)lines.splice(0,lines.length-500);
 };
 child.stdout.on('data',append);child.stderr.on('data',append);
 const admin=new FactorySandboxAdmin({
  baseUrl:'http://127.0.0.1:'+port+'/',token,sandboxId
 });
 async function close(){
  if(child.exitCode!==null||child.signalCode!==null)return;
  const stopped=new Promise(resolve=>child.once('exit',resolve));
  child.kill('SIGTERM');
  await Promise.race([stopped,pause(5000)]);
  if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');
 }
 async function waitForLog(fragment,limit=15000){
  const deadline=Date.now()+limit;
  while(Date.now()<deadline){
   if(lines.join('').includes(fragment))return true;
   if(child.exitCode!==null)throw new Error('node_red_exited_before_message');
   await pause(80);
  }
  throw new Error('node_red_output_not_observed');
 }
 try{
  const deadline=Date.now()+45000;
  let reason='startup_timeout';
  while(Date.now()<deadline){
   if(child.exitCode!==null)throw new Error('node_red_exited_'+child.exitCode);
   try{
    await admin.inspect();
    return {root,userDir,port,sandboxId,receipt,admin,child,close,
     waitForLog,logs:lines};
   }catch(e){reason=e.code||e.message;}
   await pause(150);
  }
  throw new Error('node_red_not_ready:'+reason);
 }catch(error){
  await close();
  throw error;
 }
}
