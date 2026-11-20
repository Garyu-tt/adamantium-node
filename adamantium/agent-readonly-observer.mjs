/**
 * Adamantium-node local AI graph observer R01.
 *
 * Read-only Node-RED v2 graph metadata to an atomic local snapshot, from a
 * dedicated read-scope identity delivered via a service credentials directory.
 * Never handles Graph Manager writes, flow deployment, runtime source or MAS keys.
 * SPDX-License-Identifier: Apache-2.0
 */
import {readFile,open,rename,unlink} from "node:fs/promises";
import {dirname,join} from "node:path";
import {randomBytes} from "node:crypto";
import {pathToFileURL} from "node:url";
import {inspect,difference,validateEndpoint} from "./ai-graph-inspect.mjs";

export const OBSERVER_SNAPSHOT="adamantium.node-red-observer/1";

function check(ok,message){if(!ok)throw new Error("observer: "+message);}
export function parseObserverCredentials(raw){
 check(typeof raw==="string" && raw.length<256 &&
  /^username=ai-observer\npassword=[A-Za-z0-9_-]{40,110}\n$/.test(raw),
  "malformed scoped credentials");
 return {username:"ai-observer",password:raw.split("\n")[1].slice("password=".length)};
}
export async function requestReadToken(origin,credentials,{fetchImpl=fetch}={}){
 const base=validateEndpoint(origin);
 const {username,password}=parseObserverCredentials(credentials);
 const body=new URLSearchParams({
  grant_type:"password",client_id:"node-red-admin",scope:"read",username,password
 });
 const response=await fetchImpl(base+"/auth/token",{
  method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},
  body,redirect:"error",signal:AbortSignal.timeout(7000)
 });
 check(response.status===200,"read-scope token request rejected: HTTP "+response.status);
 const result=await response.json();
 check(typeof result.access_token==="string" && result.access_token.length>16 &&
       result.access_token.length<10000 && result.token_type==="Bearer",
       "unexpected token response");
 return result.access_token;
}
/** An untrusted, non-authoritative metadata observation. Never a MAS receipt. */
export async function observe(origin,credentialText,{
 fetchImpl=fetch,previous=null,now=()=>new Date()
}={}){
 const token=await requestReadToken(origin,credentialText,{fetchImpl});
 const graph=await inspect(origin,token,{fetchImpl});
 let changed=null;
 if(previous!==null){
  check(previous && previous.format===OBSERVER_SNAPSHOT &&
        previous.graph?.format===graph.format,"invalid previous observation");
  changed=difference(previous.graph,graph);
 }
 const result={
  format:OBSERVER_SNAPSHOT,
  observedAt:now().toISOString(),
  identity:"ai-observer",
  readonly:true,
  authority:"none",
  masGranted:false,
  runtimeActivated:false,
  graph,
  change:changed
 };
 return result;
}
export async function persistObservation(path,observation){
 check(typeof path==="string" && path.startsWith("/") && !path.includes("\0"),
       "absolute output path required");
 check(observation?.format===OBSERVER_SNAPSHOT,"invalid output snapshot");
 const content=JSON.stringify(observation,null,2)+"\n";
 check(Buffer.byteLength(content)<2_000_000,"observation exceeds size budget");
 const candidate=join(dirname(path),".observer-"+randomBytes(12).toString("hex")+".tmp");
 const handle=await open(candidate,"wx",0o600);
 try {
  await handle.writeFile(content,"utf8");
  await handle.sync();
 } finally {await handle.close();}
 try {await rename(candidate,path);}
 catch(err){await unlink(candidate).catch(()=>{});throw err;}
}
function args(argv){
 const out={url:null,out:null};
 for(let i=0;i<argv.length;i++){
  if(argv[i]==="--url")out.url=argv[++i];
  else if(argv[i]==="--out")out.out=argv[++i];
  else throw new Error("usage: --url http://127.0.0.1:1885/ --out /var/lib/observer/snapshot.json");
 }
 out.url=validateEndpoint(out.url);
 check(out.out && out.out.startsWith("/") && !out.out.includes("\0"),"missing output");
 return out;
}
export async function main(argv=process.argv.slice(2)){
 const {url,out}=args(argv);
 const credDir=process.env.CREDENTIALS_DIRECTORY;
 check(typeof credDir==="string" && credDir.startsWith("/"),
       "systemd credentials directory required");
 const credentials=await readFile(join(credDir,"observer-login"),"utf8");
 let prior=null;
 try {
  prior=JSON.parse(await readFile(out,"utf8"));
 }catch(error){
  if(error.code!=="ENOENT")throw new Error("cannot verify existing snapshot");
 }
 const snap=await observe(url,credentials,{previous:prior});
 await persistObservation(out,snap);
 console.log("observer: read-only snapshot revision="+snap.graph.revision.slice(0,12)+
             " nodes="+snap.graph.summary.nodes+" edges="+snap.graph.summary.outboundEdges+
             " changed="+(snap.change?(
                snap.change.added.length+snap.change.removed.length+snap.change.changed.length
              ):"baseline"));
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){
 main().catch(error=>{console.error(error.message);process.exitCode=1;});
}
