/**
 * R07 isolated real-browser acceptance runner. Runs source-only SVG fixture in
 * a disposable 127.0.0.1 server. No production Node-RED or user browser use.
 * Run with ADAMANTIUM_CHROMIUM_BIN=/absolute/path/to/chromium node test/adamantium/capsule-browser-smoke.mjs
 * SPDX-License-Identifier: Apache-2.0
 */
import {createServer} from "node:http";
import {readFile,mkdtemp,rm} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {spawn} from "node:child_process";
import {fileURLToPath} from "node:url";
import assert from "node:assert/strict";

const repo=path.resolve(fileURLToPath(new URL("../..",import.meta.url)));
const allowed=new Set([
  "/adamantium/capsule-native-canvas.mjs",
  "/adamantium/capsule-native-layout.mjs",
  "/adamantium/capsule-studio.mjs",
  "/adamantium/capsule-extract.mjs"
]);
async function chromium(binary,uri,profile){
  const args=[
    "--headless=new","--disable-gpu","--no-first-run",
    "--disable-background-networking","--disable-dev-shm-usage",
    "--disable-extensions","--virtual-time-budget=6500",
    "--user-data-dir="+profile,"--dump-dom",uri
  ];
  return new Promise((resolve,reject)=>{
    const child=spawn(binary,args,{shell:false,windowsHide:true,env:process.env});
    let output="",error="";
    child.stdout.on("data",chunk=>{
      output+=chunk.toString("utf8");
      if(output.length>2000000)child.kill("SIGKILL");
    });
    child.stderr.on("data",chunk=>{
      error+=chunk.toString("utf8");
      if(error.length>30000)error=error.slice(-30000);
    });
    child.on("error",reject);
    child.on("close",(code,signal)=>{
      if(code!==0||signal)return reject(new Error("Chromium exited "+code+" "+signal+" "+error.slice(-950)));
      resolve(output);
    });
  });
}
async function main(){
  const executable=process.env.ADAMANTIUM_CHROMIUM_BIN;
  assert.ok(executable&&path.isAbsolute(executable),"absolute ADAMANTIUM_CHROMIUM_BIN is required");
  const stat=await import("node:fs/promises").then(fs=>fs.lstat(executable));
  assert.ok(stat.isFile()&&!stat.isSymbolicLink(),"Chromium executable must be a regular file");
  const server=createServer(async(req,res)=>{
    if(req.url==="/"){
      try{
        const fixture=await readFile(path.join(repo,"test/adamantium/capsule-browser-fixture.html"));
        res.writeHead(200,{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store"});
        res.end(fixture);
      }catch{res.writeHead(500);res.end();}
      return;
    }
    if(!allowed.has(req.url)){
      res.writeHead(404);res.end();return;
    }
    try{
      const source=await readFile(path.join(repo,req.url.slice(1)));
      res.writeHead(200,{"Content-Type":"text/javascript; charset=utf-8",
        "Cache-Control":"no-store","X-Content-Type-Options":"nosniff"});
      res.end(source);
    }catch{res.writeHead(404);res.end();}
  });
  const profile=await mkdtemp(path.join(os.tmpdir(),"capsule-chromium-"));
  try{
    await new Promise((resolve,reject)=>{
      server.once("error",reject);
      server.listen(0,"127.0.0.1",()=>{
        server.off("error",reject);resolve();
      });
    });
    const addr=server.address();
    assert.equal(addr.address,"127.0.0.1");
    const dom=await chromium(executable,"http://127.0.0.1:"+addr.port+"/",profile);
    const body=/<body\b([^>]*)>/i.exec(dom)?.[1]||"";
    const err=/data-error="([^"]*)"/.exec(body)?.[1]||"unknown browser state";
    assert.match(body,/data-smoke="pass"/,"Chromium native SVG smoke failed: "+err);
    console.log("CAPSULE_NATIVE_BROWSER_OK: four SVG rails, typed hitboxes, wire creation, navigation, original flow untouched");
  }finally{
    if(server.listening)await new Promise(resolve=>server.close(resolve));
    await rm(profile,{recursive:true,force:true});
  }
}
await main();
