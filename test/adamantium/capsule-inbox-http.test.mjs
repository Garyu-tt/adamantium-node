import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {createHash,generateKeyPairSync,randomBytes} from "node:crypto";
import {CapsuleStudio} from "../../adamantium/capsule-studio.mjs";
import {createCapsuleIRProposal} from "../../adamantium/capsule-ir-proposal.mjs";
import {DurableCapsuleProposalInbox} from "../../adamantium/capsule-durable-inbox.mjs";
import {createCapsuleInboxHttpHarness} from "../../adamantium/capsule-inbox-http.mjs";
import {SignedGraphProposalBridge} from "../../adamantium/capsule-signed-proposal-bridge.mjs";

const POLICY="a".repeat(64),NODE="core_test";
const NOW=1795180000000;
function setupGraph(){
  const studio=new CapsuleStudio(),root=studio.createGraph("Main");
  const def=studio.createDefinition({name:"Rust",language:"rust",
    source:"secret NEVER_HTTP_SOURCE",
    ports:[{tag:"input",direction:"input",semantics:"data",dataType:"core.json@1"},
      {tag:"output",direction:"output",semantics:"data",dataType:"core.json@1"}]});
  studio.place(root,def.id);
  return {root,baseline:createCapsuleIRProposal(studio,{revision:1}),
    candidate:createCapsuleIRProposal(studio,{revision:2})};
}
async function fixture(){
  const graph=setupGraph();
  const pair=generateKeyPairSync("ed25519");
  const pem=pair.publicKey.export({type:"spki",format:"pem"}).toString();
  const privateKeyPem=pair.privateKey.export({type:"pkcs8",format:"pem"}).toString();
  const fingerprint=createHash("sha256").update(
    pair.publicKey.export({type:"spki",format:"der"})).digest("hex");
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),"capsules-r05-http-"));
  const token=randomBytes(32).toString("hex");
  const inbox=await DurableCapsuleProposalInbox.open({
    directory,baseline:graph.baseline,privateKeyPem,nodeId:NODE,policySha256:POLICY,
    authenticate:async context=>context?.peer==="test-authorized"
      ?{principalId:"peer_1",verified:true}:null,
    authorize:async()=>true,isPrimary:async()=>true,
    nativeValidate:async ({proposal})=>({accepted:true,
      graphsSha256:createHash("sha256").update(JSON.stringify(proposal.graphs)).digest("hex")}),
    now:()=>NOW
  });
  let credentialsChecked=0;
  const http=createCapsuleInboxHttpHarness({
    inbox,authenticateHttp:async req=>{
      credentialsChecked++;
      const value=req.headers.authorization;
      return typeof value==="string"&&value===("Bearer "+token)
        ?{peer:"test-authorized"}:null;
    }
  });
  const info=await http.listen(0);
  const headers={"Content-Type":"application/json","Authorization":"Bearer "+token};
  const transport={
    async preflight(query){
      const r=await fetch(info.url+"/api/proposals/preflight",{
        method:"POST",headers,body:JSON.stringify(query)
      });
      if(!r.ok)throw new Error("preflight rejected HTTP "+r.status);
      return r.json();
    },
    async invoke(query){
      const r=await fetch(info.url+"/api/proposals/invoke",{
        method:"POST",headers,body:JSON.stringify(query)
      });
      if(!r.ok)throw new Error("invoke rejected HTTP "+r.status);
      return r.json();
    }
  };
  const bridge=new SignedGraphProposalBridge({transport,
    nodeId:NODE,graphId:graph.root,policySha256:POLICY,
    pinnedPublicKeyPem:pem,pinnedFingerprint:fingerprint,now:()=>NOW});
  return {...graph,http,info,inbox,bridge,headers,
    getChecks:()=>credentialsChecked,
    async close(){await http.close();await inbox.close();await fs.rm(directory,{recursive:true,force:true});}};
}
test("real HTTP→R05 disk→signed receipt exchange over loopback works without activation",async()=>{
  const h=await fixture();
  try {
    assert.equal(h.info.loopbackOnly,true);
    assert.equal(h.info.authorizedCore,false);
    const result=await h.bridge.submit({requestId:"http_disk_1",proposal:h.candidate});
    assert.equal(result.status,"accepted-for-review");
    assert.equal(result.receiptVerified,true);
    assert.equal(result.graphApproved,false);
    assert.equal(result.runtimeActivated,false);
    assert.equal(h.inbox.summary().reviewQueue,1);
    assert.equal(h.inbox.summary().revision,1);
    assert.equal(h.getChecks(),2);
    const health=await fetch(h.info.url+"/healthz");
    const json=await health.json();
    assert.equal(json.authoritative,false);
    assert.equal(json.execution,false);
    assert.equal(health.headers.get("access-control-allow-origin"),null);
  }finally{await h.close();}
});
test("HTTP transport must authenticate before preflight, must not leak scope or bypass allowed methods",async()=>{
  const h=await fixture();
  try {
    const query={nodeId:NODE,graphId:h.root,contract:"mechanicus.graph.propose/1"};
    const noAuth=await fetch(h.info.url+"/api/proposals/preflight",{
      method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(query)
    });
    assert.equal(noAuth.status,403);
    assert.deepEqual(await noAuth.json(),{error:"request-rejected"});
    const wrongMethod=await fetch(h.info.url+"/api/proposals/preflight");
    assert.equal(wrongMethod.status,405);
    const route=await fetch(h.info.url+"/api/flows");
    assert.equal(route.status,404);
    const invalid=await fetch(h.info.url+"/api/proposals/preflight",{
      method:"POST",headers:h.headers,body:"{bad-json"
    });
    assert.equal(invalid.status,400);
    const wrongType=await fetch(h.info.url+"/api/proposals/preflight",{
      method:"POST",headers:{"Content-Type":"text/plain",Authorization:h.headers.Authorization},
      body:JSON.stringify(query)
    });
    assert.equal(wrongType.status,415);
    assert.equal(h.inbox.summary().auditEntries,0);
  }finally{await h.close();}
});
test("HTTP server refuses oversize body and never forwards it to Core inbox",async()=>{
  const h=await fixture();
  try{
    const response=await fetch(h.info.url+"/api/proposals/preflight",{
      method:"POST",headers:h.headers,body:JSON.stringify({payload:"X".repeat(2_050_000)})
    });
    assert.equal(response.status,413);
    assert.equal(h.inbox.summary().auditEntries,0);
  }finally{await h.close();}
});
