/**
 * Local-only, dependency-free Capsule Studio preview. Does not execute node sources,
 * install packages or touch a running Node-RED instance.
 * node adamantium/capsule-preview-server.mjs [port]
 * SPDX-License-Identifier: Apache-2.0
 */
import {createServer} from "node:http";
import {readFile} from "node:fs/promises";
const PORT=Number(process.argv[2] || 1886);
if(!Number.isSafeInteger(PORT)||PORT<0||PORT>65535)throw new Error("port must be 0..65535 (0 = ephemeral test port)");
const fileMap={
  "/":new URL("./capsule-preview/index.html",import.meta.url),
  "/index.html":new URL("./capsule-preview/index.html",import.meta.url),
  "/app.mjs":new URL("./capsule-preview/app.mjs",import.meta.url),
  "/capsule-studio.mjs":new URL("./capsule-studio.mjs",import.meta.url),
  "/capsule-extract.mjs":new URL("./capsule-extract.mjs",import.meta.url),
  "/capsule-ir-proposal.mjs":new URL("./capsule-ir-proposal.mjs",import.meta.url),
  "/editor-projection.mjs":new URL("./editor-projection.mjs",import.meta.url)
};
const server=createServer(async(req,res)=>{
  res.setHeader("Cache-Control","no-store");
  res.setHeader("X-Content-Type-Options","nosniff");
  res.setHeader("Content-Security-Policy","default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'; img-src 'self' blob:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'");
  if(req.method!=="GET"&&req.method!=="HEAD"){res.writeHead(405,{"Allow":"GET, HEAD"});res.end();return;}
  const file=fileMap[req.url];
  if(!file){res.writeHead(404);res.end("Not Found");return;}
  try{
    const bytes=await readFile(file);
    res.writeHead(200,{"Content-Type":req.url.endsWith(".mjs")?"text/javascript; charset=utf-8":"text/html; charset=utf-8"});
    res.end(req.method==="HEAD"?undefined:bytes);
  }catch{res.writeHead(500);res.end("Preview file unavailable");}
});
server.listen(PORT,"127.0.0.1",()=>console.log("Capsule Studio R01 (inert preview) http://127.0.0.1:"+server.address().port));
