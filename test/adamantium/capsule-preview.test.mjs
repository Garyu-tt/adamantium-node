import test from "node:test";
import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {fileURLToPath} from "node:url";

test("Capsule Studio preview serves only static editor assets on loopback",async()=>{
  const program=fileURLToPath(new URL("../../adamantium/capsule-preview-server.mjs",import.meta.url));
  const child=spawn(process.execPath,[program,"0"],{stdio:["ignore","pipe","pipe"],windowsHide:true});
  let stderr="";
  child.stderr.on("data",chunk=>{stderr+=chunk.toString();});
  try{
    const port=await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error("server start timeout: "+stderr)),8000);
      child.on("error",error=>{clearTimeout(timer);reject(error);});
      child.on("exit",code=>{clearTimeout(timer);reject(new Error("server exited "+code+": "+stderr));});
      child.stdout.on("data",chunk=>{
        const match=chunk.toString().match(/http:\/\/127\.0\.0\.1:(\d+)/);
        if(match){clearTimeout(timer);resolve(Number(match[1]));}
      });
    });
    const base="http://127.0.0.1:"+port;
    const index=await fetch(base+"/");
    assert.equal(index.status,200);
    assert.match(await index.text(),/Палитра переиспользуемых нод/);
    assert.equal(index.headers.get("x-content-type-options"),"nosniff");
    assert.match(index.headers.get("content-security-policy"),/connect-src 'none'/);
    const model=await fetch(base+"/capsule-studio.mjs");
    assert.equal(model.status,200);
    assert.match(await model.text(),/export class CapsuleStudio/);
    const construct=await fetch(base+"/construct-engine.mjs");
    assert.equal(construct.status,200);
    assert.match(await construct.text(),/export class ConstructEngine/);
    const app=await fetch(base+"/app.mjs");
    assert.equal(app.status,200);
    assert.match(await app.text(),/new CapsuleStudio/);
    for(const route of ["/capsule-ir-proposal.mjs","/editor-projection.mjs"]){
      const response=await fetch(base+route);
      assert.equal(response.status,200);
      assert.match(response.headers.get("content-type"),/javascript/);
    }
    assert.equal((await fetch(base+"/server/private")).status,404);
    assert.equal((await fetch(base+"/",{method:"POST"})).status,405);
  } finally {
    child.kill();
  }
});
