/**
 * Real browser acceptance of the inert R07 capsule overlay, run ONLY against a
 * disposable loopback fixture. No running Node-RED flows, Core, or MAS grants.
 *
 * ADAMANTIUM_CHROME_BIN=/absolute/path/to/chromium
 * ADAMANTIUM_CHROME_NO_SANDBOX=1 (only for explicitly disposable test hosts)
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import test from "node:test";
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {mkdtemp,readFile,rm,access} from "node:fs/promises";
import {tmpdir} from "node:os";
import {resolve,join} from "node:path";
import {fileURLToPath} from "node:url";
import {spawn} from "node:child_process";

const repo=resolve(fileURLToPath(new URL("../../",import.meta.url)));
const source=new Map([
  ["/adamantium/capsule-studio.mjs","adamantium/capsule-studio.mjs"],
  ["/adamantium/capsule-extract.mjs","adamantium/capsule-extract.mjs"],
  ["/adamantium/capsule-canvas-geometry.mjs","adamantium/capsule-canvas-geometry.mjs"],
  ["/adamantium/capsule-native-canvas.mjs","adamantium/capsule-native-canvas.mjs"]
]);
const fixture=resolve(repo,"test/browser/fixtures/capsule-native-svg.html");
async function findChrome(){
  const guesses=[process.env.ADAMANTIUM_CHROME_BIN,
    "/usr/bin/google-chrome","/usr/bin/google-chrome-stable",
    "/usr/bin/chromium","/usr/bin/chromium-browser",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"];
  for(const candidate of guesses){
    if(!candidate)continue;
    try{await access(candidate);return candidate;}catch{}
  }
  throw new Error("Chrome/Chromium required for R07 real-browser smoke (set ADAMANTIUM_CHROME_BIN)");
}
async function startServer(){
  const server=createServer(async(req,res)=>{
    try {
      const target=req.url==="/"?fixture:source.get(req.url);
      if(!target){res.writeHead(404);res.end();return;}
      if(req.method!=="GET"){res.writeHead(405);res.end();return;}
      const bytes=await readFile(req.url==="/"?target:resolve(repo,target));
      res.writeHead(200,{
        "content-type":req.url==="/"?"text/html; charset=utf-8":"text/javascript; charset=utf-8",
        "cache-control":"no-store","x-content-type-options":"nosniff"
      });res.end(bytes);
    }catch{
      res.writeHead(500);res.end("Local test fixture failed");
    }
  });
  await new Promise((ok,fail)=>{
    server.once("error",fail);
    server.listen(0,"127.0.0.1",()=>{server.off("error",fail);ok();});
  });
  return {server,url:"http://127.0.0.1:"+server.address().port+"/"};
}
async function runBrowser(chrome,url,profile){
  const args=[
    "--headless","--disable-gpu","--disable-dev-shm-usage",
    "--disable-extensions","--disable-background-networking",
    "--no-first-run","--disable-breakpad",
    "--virtual-time-budget=5000","--user-data-dir="+profile,
    "--dump-dom",url
  ];
  if(process.env.ADAMANTIUM_CHROME_NO_SANDBOX==="1")args.unshift("--no-sandbox");
  const child=spawn(chrome,args,{shell:false,windowsHide:true,env:{...process.env}});
  let stdout="",stderr="",settled=false;
  return await new Promise((resolveResult,reject)=>{
    const timeout=setTimeout(()=>child.kill("SIGKILL"),20000);
    child.stdout.on("data",chunk=>{
      stdout+=chunk.toString("utf8");
      if(stdout.length>3_000_000)child.kill("SIGKILL");
    });
    child.stderr.on("data",chunk=>{
      stderr+=chunk.toString("utf8");
      if(stderr.length>200_000)child.kill("SIGKILL");
    });
    child.on("error",error=>{
      if(settled)return;settled=true;clearTimeout(timeout);reject(error);
    });
    child.on("close",(code,signal)=>{
      if(settled)return;settled=true;clearTimeout(timeout);
      if(code!==0||signal)return reject(new Error(
        "Chrome exit "+code+" / "+signal+": "+stderr.slice(-1200)));
      resolveResult(stdout);
    });
  });
}
test("Chromium native SVG canvas: four rails, clickable typed ports, persisted wire, isolated native flow",async()=>{
  const chrome=await findChrome();
  const temp=await mkdtemp(join(tmpdir(),"adamantium-r07-browser-"));
  const {server,url}=await startServer();
  try {
    const page=await runBrowser(chrome,url,join(temp,"profile"));
    const indicator=/\bdata-result="([^"]+)"/.exec(page)?.[1];
    const pre=/<pre id="status">([^<]*)<\/pre>/.exec(page)?.[1]||"no fixture status";
    assert.equal(indicator,"pass","Browser SVG result: "+pre.slice(0,1600));
    const info=JSON.parse(pre.replaceAll("&quot;",'"').replaceAll("&amp;","&"));
    assert.equal(info.before.cards,3);
    assert.equal(info.before.wires,0);
    assert.deepEqual(info.before.sides,["east","north","south","west"]);
    assert.equal(info.after.wires,1);
    assert.equal(info.after.savedEdges,1);
    assert.equal(info.after.nativeNodePresent,true);
    assert.equal(info.after.nativeLinkPresent,true);
    assert.equal(info.after.sourceLeaked,false);
    assert.equal(info.after.runtimeActivated,false);
  } finally {
    await new Promise((ok,fail)=>server.close(err=>err?fail(err):ok()));
    await rm(temp,{recursive:true,force:true});
  }
});
